/**
 * Google Gemini provider — OpenAI-compatible endpoint via Google AI Studio.
 *
 * Env vars:
 *   GEMINI_API_KEY   - API key from aistudio.google.com
 *   GEMINI_MODEL     - model name (default: gemini-2.0-flash)
 */

import { OpenAICompatibleProvider } from "./openai-compatible.ts";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

export class GeminiProvider extends OpenAICompatibleProvider {
  readonly name = "gemini";

  constructor(opts?: { apiKey?: string; model?: string }) {
    super({
      apiKey: opts?.apiKey ?? process.env["GEMINI_API_KEY"],
      baseURL: GEMINI_BASE_URL,
      model: opts?.model ?? process.env["GEMINI_MODEL"] ?? "gemini-2.0-flash",
    });
  }
}
