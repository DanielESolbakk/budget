import { defineConfig } from "@playwright/test";

const outputDir = process.env["PLAYWRIGHT_OUTPUT_DIR"] ?? "test-results";
const reportDir = process.env["PLAYWRIGHT_REPORT_DIR"] ?? "playwright-report";

/**
 * Playwright configuration for Electron runtime and browser preview tests.
 *
 * Electron tests launch the built application (from `out/`); browser preview tests
 * use the local Vite server.
 *
 * Framework boundaries:
 *   Vitest  — unit, integration, and Vitest e2e smoke tests (no Electron binary required)
 *   Playwright — Electron runtime flow validation (requires built app and Electron binary)
 */
export default defineConfig({
  testDir: "tests/playwright",
  outputDir,
  snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/{arg}{ext}",
  // Keep scenarios within each file serial; the Electron fixture creates an
  // isolated application and database for every test.
  fullyParallel: false,
  workers: 2,
  forbidOnly: !!process.env["CI"],
  timeout: process.env["CI"] ? 60_000 : 30_000,
  retries: process.env["CI"] ? 2 : 0,
  reporter: [
    ["html", { outputFolder: reportDir, open: "never" }],
    ["list"],
    ...(process.env["CI"] ? [["github"] as ["github"]] : []),
  ],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run start:browser -- --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env["CI"],
  },
});
