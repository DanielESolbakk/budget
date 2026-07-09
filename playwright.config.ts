import { defineConfig } from "@playwright/test";

/**
 * Playwright configuration for Electron runtime smoke tests.
 *
 * These tests launch the built Electron application (from `out/`) and assert
 * on window startup, root render, preload bridge availability, and forecast
 * section output.  Run `npm run build` before executing these tests.
 *
 * Framework boundaries:
 *   Vitest  — unit, integration, and Vitest e2e smoke tests (no Electron binary required)
 *   Playwright — Electron runtime flow validation (requires built app and Electron binary)
 */
export default defineConfig({
  testDir: "tests/playwright",
  outputDir: "test-results",
  // Electron smoke tests share one app instance across all scenarios.
  // fullyParallel: false prevents concurrent Electron launches and ensures
  // the shared instance pattern in beforeAll/afterAll works reliably.
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: [
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["list"],
  ],
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
});
