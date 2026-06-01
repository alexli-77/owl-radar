import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      LLM_INTER_REQUEST_MS: "0",
    },
    globals: true,
    include: ["src/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/__tests__/**", "src/weekly.ts", "src/monthly.ts"],
    },
  },
});
