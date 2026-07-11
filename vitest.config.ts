import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["dist/**", "node_modules/**"],
    fileParallelism: false,
    globalSetup: ["src/test/vitest-global-setup.ts"],
    setupFiles: ["src/test/vitest-setup.ts"],
  },
});
