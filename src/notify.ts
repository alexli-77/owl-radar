/**
 * Notification delivery — reads manifest.json and sends a message
 * with links to the latest reports. Skips silently if secrets are not set.
 *
 * Telegram env vars:
 *   TELEGRAM_BOT_TOKEN  — bot token from @BotFather
 *   TELEGRAM_CHAT_ID    — channel/group/user chat ID
 * Discord env vars:
 *   DISCORD_BOT_TOKEN   — Discord bot token
 *   DISCORD_CHANNEL_ID  — target Discord channel ID
 * Optional:
 *   PAGES_URL           — GitHub Pages base URL (defaults to the public deployment)
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { NOTIFY_LABELS } from "./i18n.ts";
import type { ReportHighlights } from "./prompts-data.ts";

dotenv.config({
  path: path.join(process.env["HOME"] ?? "", ".hermes", "secrets", "discord.env"),
  quiet: true,
});
dotenv.config({
  path: path.join(process.env["HOME"] ?? "", ".openclaw", "secrets", "discord.env"),
  quiet: true,
});
dotenv.config({ path: ".env", override: true, quiet: true });

export interface Highlights {
  zh: ReportHighlights;
  en: ReportHighlights;
}

const PAGES_URL_DEFAULT = "https://duanyytop.github.io/agents-radar";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendTelegram(text: string): Promise<void> {
  const BOT_TOKEN = process.env["TELEGRAM_BOT_TOKEN"] ?? "";
  const CHAT_ID = process.env["TELEGRAM_CHAT_ID"] || "@agents_radar";
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Telegram API ${res.status}: ${body}`);
  }
}

export function toDiscordMarkdown(html: string): string {
  return html
    .replace(/<b>(.*?)<\/b>/g, "**$1**")
    .replace(/<a href="([^"]+)">([^<]+)<\/a>/g, "[$2]($1)")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function splitDiscordMessage(text: string): string[] {
  const maxLen = 1900;
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen * 0.5) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

async function sendDiscord(text: string): Promise<void> {
  const BOT_TOKEN = process.env["DISCORD_BOT_TOKEN"] ?? "";
  const CHANNEL_ID = process.env["DISCORD_CHANNEL_ID"] ?? "";
  const chunks = splitDiscordMessage(toDiscordMarkdown(text));

  for (const chunk of chunks) {
    await postDiscordMessage(BOT_TOKEN, CHANNEL_ID, chunk);
  }
}

async function postDiscordMessage(botToken: string, channelId: string, content: string): Promise<void> {
  const url = `https://discord.com/api/v10/channels/${channelId}/messages`;
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bot ${botToken}`,
        },
        body: JSON.stringify({
          content,
          allowed_mentions: { parse: [] },
        }),
      });

      if (res.ok) return;

      const body = await res.text();
      const retryAfter = Number(res.headers.get("retry-after") ?? "");
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt === maxAttempts) {
        throw new Error(`Discord API ${res.status}: ${body}`);
      }

      await delay(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : attempt * 1000);
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      await delay(attempt * 1000);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildMessage(
  date: string,
  reports: string[],
  pagesUrl?: string,
  highlights?: Highlights | null,
): string {
  const PAGES_URL = (pagesUrl ?? process.env["PAGES_URL"] ?? PAGES_URL_DEFAULT).replace(/\/$/, "");
  const baseReports = reports.filter((r) => !r.endsWith("-en"));
  const isWeekly = baseReports.includes("ai-weekly");
  const isMonthly = baseReports.includes("ai-monthly");

  const icon = isMonthly ? "📆" : isWeekly ? "📅" : "📡";
  const suffix = isMonthly ? " 月报" : isWeekly ? " 周报" : "";
  const lines: string[] = [`${icon} <b>agents-radar${suffix} · ${date}</b>`];

  // Daily reports first, then rollups
  const ordered = [
    ...baseReports.filter((r) => !r.includes("weekly") && !r.includes("monthly")),
    ...baseReports.filter((r) => r.includes("weekly") || r.includes("monthly")),
  ];

  const zhHighlights = highlights?.zh ?? {};

  for (const r of ordered) {
    const zhLabel = NOTIFY_LABELS[r]?.zh ?? r;
    const zhUrl = `${PAGES_URL}/#${date}/${r}`;
    const enKey = `${r}-en`;

    lines.push(""); // blank line before each report section
    if (reports.includes(enKey)) {
      const enLabel = NOTIFY_LABELS[r]?.en ?? "EN";
      const enUrl = `${PAGES_URL}/#${date}/${enKey}`;
      lines.push(`• <a href="${zhUrl}">${zhLabel}</a>  ·  <a href="${enUrl}">${enLabel}</a>`);
    } else {
      lines.push(`• <a href="${zhUrl}">${zhLabel}</a>`);
    }

    // Add highlights as indented sub-items
    const items = zhHighlights[r];
    if (items?.length) {
      for (const h of items) {
        lines.push(`  ◦ ${escapeHtml(h)}`);
      }
    }
  }

  lines.push(`\n<a href="${PAGES_URL}">🌐 Web UI</a>  ·  <a href="${PAGES_URL}/feed.xml">⊕ RSS</a>`);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const hasTelegram = Boolean(process.env["TELEGRAM_BOT_TOKEN"]);
  const hasDiscord = Boolean(process.env["DISCORD_BOT_TOKEN"] && process.env["DISCORD_CHANNEL_ID"]);

  if (!hasTelegram && !hasDiscord) {
    console.log("[notify] No notification credentials set — skipping.");
    return;
  }

  if (!fs.existsSync("manifest.json")) {
    console.log("[notify] manifest.json not found — skipping.");
    return;
  }

  const { dates } = JSON.parse(fs.readFileSync("manifest.json", "utf-8")) as {
    dates: { date: string; reports: string[] }[];
  };

  const latest = dates?.[0];
  if (!latest) {
    console.log("[notify] manifest is empty — skipping.");
    return;
  }
  const { date, reports } = latest;

  // Load highlights if available
  let highlights: Highlights | null = null;
  const highlightsPath = path.join("digests", date, "highlights.json");
  if (fs.existsSync(highlightsPath)) {
    try {
      highlights = JSON.parse(fs.readFileSync(highlightsPath, "utf-8")) as Highlights;
    } catch {
      console.log("[notify] Failed to parse highlights.json — sending without highlights.");
    }
  }

  const text = buildMessage(date, reports, undefined, highlights);

  if (hasTelegram) {
    console.log(`[notify] Sending Telegram message for ${date} (${reports.length} reports)...`);
    await sendTelegram(text);
  }

  if (hasDiscord) {
    console.log(`[notify] Sending Discord message for ${date} (${reports.length} reports)...`);
    await sendDiscord(text);
  }

  console.log("[notify] Done!");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error("[notify]", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
