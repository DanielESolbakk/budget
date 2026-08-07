import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage/unit",
      reporter: ["text-summary", "json-summary", "html"],
      include: [
        "src/domain/import/**/*.ts",
        "src/domain/merchant/**/*.ts",
        "src/domain/forecast/**/*.ts",
        "src/domain/aggregation/**/*.ts",
        "src/app/**/*.ts"
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        statements: 70,
        branches: 60
      }
    }
  }
});