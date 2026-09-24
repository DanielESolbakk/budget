import { test, expect } from "./fixtures/electron.js";
import type { ElectronApplication } from "@playwright/test";
import { resolve } from "node:path";

const CSV_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv");
const PDF_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-binary.pdf");

test.describe("Main-process transaction privacy", () => {
  async function installFetchProbe(electronApp: ElectronApplication): Promise<void> {
    await electronApp.evaluate(() => {
      const state = globalThis as typeof globalThis & {
        __budgetMainFetchRequests?: string[];
      };
      state.__budgetMainFetchRequests = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        state.__budgetMainFetchRequests?.push(String(input));
        return originalFetch(input, init);
      };
    });
  }

  test("CSV import does not invoke main-process fetch", async ({ electronApp, csvImport }) => {
    await installFetchProbe(electronApp);
    await csvImport.submitImport(CSV_FIXTURE_PATH);
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });

    const requests = await electronApp.evaluate(() =>
      (globalThis as typeof globalThis & { __budgetMainFetchRequests?: string[] }).__budgetMainFetchRequests ?? []
    );
    expect(requests).toEqual([]);
  });

  test("binary PDF import does not invoke main-process fetch", async ({ electronApp, pdfImport }) => {
    await installFetchProbe(electronApp);
    await pdfImport.submitImport(PDF_FIXTURE_PATH);
    await expect(pdfImport.successStatus).toBeVisible({ timeout: 20_000 });

    const requests = await electronApp.evaluate(() =>
      (globalThis as typeof globalThis & { __budgetMainFetchRequests?: string[] }).__budgetMainFetchRequests ?? []
    );
    expect(requests).toEqual([]);
  });

  test("rejects malformed ledger and restore payloads at the IPC boundary", async ({ window }) => {
    const responses = await window.evaluate(async () => {
      const api = (globalThis as unknown as { budgetApi: unknown }).budgetApi as {
        ledger: { list: (query: unknown) => Promise<unknown> };
        backup: { restore: (input: unknown) => Promise<unknown> };
      };
      const results: string[] = [];

      await api.ledger.list(null).then(
        () => results.push("ledger-accepted"),
        (error: unknown) => results.push(error instanceof Error ? error.message : String(error))
      );
      await api.backup.restore(null).then(
        () => results.push("restore-accepted"),
        (error: unknown) => results.push(error instanceof Error ? error.message : String(error))
      );

      return results;
    });

    expect(responses[0]).toContain("Transaction query must be an object.");
    expect(responses[1]).toContain("Restore input must be an object.");
  });

  test("rejects privileged IPC calls from a second window at the same app URL", async ({ electronApp, window }) => {
    await expect(window.getByRole("heading", { name: "Budget Planner" })).toBeVisible();
    const response = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const primaryWindow = BrowserWindow.getAllWindows()[0]!;
      const otherWindow = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: `${process.cwd()}/out/preload/index.cjs`,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });

      try {
        await otherWindow.loadURL(primaryWindow.webContents.getURL());
        return await otherWindow.webContents.executeJavaScript(
          "window.budgetApi.ledger.list({}).then(() => 'allowed', (error) => error.message)"
        ) as string;
      } finally {
        otherWindow.close();
      }
    });

    expect(response).toContain("Untrusted renderer sender.");
  });
});
