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
import type { Page } from "@playwright/test";
import { closeServer, startBlockedLoopbackServer } from "./helpers/blockedLoopbackServer.js";

async function expectGuardBlocksFetch(window: Page, protocol: "http:" | "https:"): Promise<void> {
  const blockedServer = await startBlockedLoopbackServer();
  const target = new URL(blockedServer.url);
  target.protocol = protocol;
  const url = target.href;

  try {
    const [request, rejected] = await Promise.all([
      window.waitForEvent("requestfailed", (failed) => failed.url() === url),
      window.evaluate(async (requestUrl) => {
        try {
          await fetch(requestUrl);
          return false;
        } catch {
          return true;
        }
      }, url),
    ]);

    expect(rejected).toBe(true);
    expect(request.failure()?.errorText).toBe("net::ERR_BLOCKED_BY_CLIENT");
  } finally {
    await closeServer(blockedServer.server);
  }
}

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

  test("Scenario 3: disallowed loopback HTTPS fetch is blocked by the guard", async ({ window }) => {
    await expectGuardBlocksFetch(window, "https:");
  });

  test("Scenario 4: disallowed loopback HTTP fetch is blocked by the guard", async ({ window }) => {
    await expectGuardBlocksFetch(window, "http:");
  });
});
