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
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
  // Keep scenarios within each file serial; the Electron fixture creates an
  // isolated application and database for every test.
  fullyParallel: false,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  reporter: [
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["list"],
    ...(process.env["CI"] ? [["github"] as ["github"]] : []),
  ],
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
});
