/**
 * Playwright runtime smoke tests for the local-first planning shell.
 *
 * These tests verify that the packaged desktop shell starts with its local
 * household and on-device status visible, and that startup does not issue
 * external HTTP(S) requests.
 */

import { createServer } from "node:http";
import type { AddressInfo, Server } from "node:net";
import { test, expect } from "./fixtures/electron.js";

async function startBlockedLoopbackServer(): Promise<{ server: Server; url: string }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/plain" });
    response.end("network guard test endpoint");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.2", resolve);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Unable to determine the blocked loopback server address.");
  }

  const { port } = address as AddressInfo;
  return { server, url: `http://127.0.0.2:${port}/guard-test` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

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

      const blocked = await window.evaluate(async (url) => {
        try {
          const response = await fetch(url);
          return !response.ok;
        } catch {
          return true;
        }
      }, blockedServer.url);
      expect(blocked).toBe(true);
    } finally {
      await closeServer(blockedServer.server);
    }
  });
});
