import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/nonetwork/**/*.test.ts"],
    environment: "node"
  }
});