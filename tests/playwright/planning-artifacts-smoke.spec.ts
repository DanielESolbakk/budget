/**
 * Playwright runtime smoke tests for the local-first planning shell.
 *
 * These tests verify that the packaged desktop shell starts with its local
 * household and on-device status visible, and that startup does not issue
 * external HTTP(S) requests.
 */

import type { Request } from "@playwright/test";
import { test, expect } from "./fixtures/electron.js";

test.describe("Planning artifact availability", () => {
  test("Scenario 1: desktop shell presents the local household planning context", async ({ appShell, dashboard }) => {
    await expect(appShell.heading).toBeVisible();
    await expect(appShell.localLedgerLabel).toBeVisible();
    await expect(appShell.onDeviceLabel).toBeVisible();
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
  });

  test("Scenario 2: shell reload completes without external network requests", async ({ appShell, dashboard, window }) => {
    const outboundRequests: string[] = [];
    const onRequest = (request: Request): void => {
      const requestUrl = new URL(request.url());
      const isExternalHttpRequest =
        (requestUrl.protocol === "http:" || requestUrl.protocol === "https:") &&
        requestUrl.hostname !== "localhost" &&
        requestUrl.hostname !== "127.0.0.1";

      if (isExternalHttpRequest) {
        outboundRequests.push(requestUrl.href);
      }
    };

    window.on("request", onRequest);
    try {
      await window.reload();
      await expect(appShell.heading).toBeVisible();
      await expect(appShell.onDeviceLabel).toBeVisible();
      await expect(dashboard.monthlyTotalsSection).toBeVisible();
    } finally {
      window.off("request", onRequest);
    }

    expect(outboundRequests).toHaveLength(0);
  });
});
