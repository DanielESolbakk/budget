/**
 * Playwright runtime smoke tests for the local-first planning shell.
 *
 * These tests verify that the packaged desktop shell starts with its local
 * household and on-device status visible, and that startup does not issue
 * external HTTP(S) requests.
 */

import { test, expect } from "./fixtures/electron.js";
import { closeServer, startBlockedLoopbackServer } from "./helpers/blockedLoopbackServer.js";

test.describe("Planning artifact availability", () => {
  test("Scenario 1: desktop shell presents the local household planning context", async ({ appShell, dashboard }) => {
    await expect(appShell.heading).toBeVisible();
    await expect(appShell.localLedgerLabel).toBeVisible();
    await expect(appShell.onDeviceLabel).toBeVisible();
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
  });

  test("Scenario 2: shell reload completes and the network guard blocks disallowed loopback", async ({ appShell, dashboard, window }) => {
    const blockedServer = await startBlockedLoopbackServer();
    try {
      await window.reload();
      await expect(appShell.heading).toBeVisible();
      await expect(appShell.onDeviceLabel).toBeVisible();
      await expect(dashboard.monthlyTotalsSection).toBeVisible();

      const [blockedRequest, blocked] = await Promise.all([
        window.waitForEvent("requestfailed", (request) => request.url() === blockedServer.url),
        window.evaluate(async (url) => {
          try {
            const response = await fetch(url);
            return !response.ok;
          } catch {
            return true;
          }
        }, blockedServer.url),
      ]);

      expect(blocked).toBe(true);
      expect(blockedRequest.failure()?.errorText).toBe("net::ERR_BLOCKED_BY_CLIENT");
    } finally {
      await closeServer(blockedServer.server);
    }
  });
});
