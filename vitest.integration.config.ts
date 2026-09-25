import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage/integration",
      reporter: ["text-summary", "json-summary", "html"],
      include: ["src/app/**/*.ts", "src/domain/**/*.ts"]
    }
  }
});