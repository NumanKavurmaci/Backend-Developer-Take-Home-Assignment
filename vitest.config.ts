import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      all: true,
      exclude: [
        "dist/**",
        "node_modules/**",
        "src/**/*.test.ts",
        "src/test/**",
        "src/docs/**",
        "src/server.ts",
        "src/db/check.ts",
      ],
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: {
        lines: 90,
      },
    },
    exclude: ["dist/**", "node_modules/**"],
    fileParallelism: false,
    globalSetup: ["src/test/vitest-global-setup.ts"],
    setupFiles: ["src/test/vitest-setup.ts"],
  },
});
