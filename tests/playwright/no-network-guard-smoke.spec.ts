/**
 * Playwright runtime smoke tests for the main-process outbound network guard.
 *
 * These tests launch the built Electron app and assert on:
 *   - App startup and dashboard render work correctly with the guard active (F5.3 AC-1)
 *   - External HTTP/HTTPS fetch requests from the renderer are blocked by the guard (F5.3 AC-2)
 *   - Local IPC flows (dashboard, forecast, category targets) continue to work (F5.3 AC-3)
 *
 * Framework boundary:
 *   Vitest   -- unit tests for guard URL permission logic (tests/nonetwork/networkGuard.test.ts)
 *   Playwright -- Electron runtime guard validation (this file)
 *
 * Prerequisites: `npm run test:e2e:playwright` runs `npm run build` automatically via the
 * pretest script. To run manually first: `npm run build && npm run test:e2e:playwright`.
 */

import { test, expect } from "./fixtures/electron.js";

test.describe("No-network guard smoke", () => {
  test("Scenario 1: app shell renders correctly with the network guard active", async ({ appShell }) => {
    // F5.3 AC-1: the guard does not break the local renderer startup path.
    await expect(appShell.heading).toBeVisible();
    await expect(appShell.banner).toBeVisible();
  });

  test("Scenario 2: dashboard IPC flow works under the network guard", async ({ dashboard }) => {
    // F5.3 AC-3: local IPC flows are not affected by the guard; dashboard data loads.
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    await expect(dashboard.monthlyTotalsHeading).toBeVisible();
    await expect(dashboard.categoryBreakdownSection).toBeVisible();
  });

  test("Scenario 3: external HTTPS fetch from the renderer is blocked by the guard", async ({ window }) => {
    // F5.3 AC-2: the session-level network guard cancels outbound external requests.
    // The fetch is expected to reject with a network error because the guard
    // calls callback({ cancel: true }) for any non-local URL.
    const blocked = await window.evaluate(async () => {
      try {
        await fetch("https://example.com/");
        return false;
      } catch {
        return true;
      }
    });

    expect(blocked).toBe(true);
  });

  test("Scenario 4: external HTTP fetch from the renderer is blocked by the guard", async ({ window }) => {
    // F5.3 AC-2: HTTP (non-TLS) external requests are also blocked.
    const blocked = await window.evaluate(async () => {
      try {
        await fetch("http://example.com/");
        return false;
      } catch {
        return true;
      }
    });

    expect(blocked).toBe(true);
  });
});
