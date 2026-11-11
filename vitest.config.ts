import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { testTimeout: 10_000, include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"] },
});
