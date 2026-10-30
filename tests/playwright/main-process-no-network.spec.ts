import { test, expect } from "./fixtures/electron.js";
import { basename, resolve } from "node:path";
import { ImportReviewPage } from "./pom/ImportReviewPage.js";
import {
  installMainProcessNetworkProbe,
  mainProcessNetworkRequests,
} from "./helpers/networkProbe.js";
import {
  installRendererNetworkAttemptBlocker,
  installRendererNetworkAttemptObserver,
  rendererNetworkAttempts,
  rendererNetworkBlockedAttempts,
} from "./helpers/rendererNetworkProbe.js";

const CSV_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv");
const PDF_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-binary.pdf");
const REVIEW_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/import-review/import-review-two-unresolved.csv");

test.describe("Main-process transaction privacy", () => {
  test("network probe fails closed and blocks main-process network transports", async ({ electronApp }) => {
    const missingProbeMessage = await mainProcessNetworkRequests(electronApp).then(
      () => "probe unexpectedly returned",
      (error: unknown) => error instanceof Error ? error.message : String(error)
    );
    expect(missingProbeMessage).toContain("probe was not installed");

    await installMainProcessNetworkProbe(electronApp);
    const blockedMessages = await electronApp.evaluate(async () => {
      const capture = async (operation: () => unknown): Promise<string> => {
        try {
          await operation();
          return "request unexpectedly succeeded";
        } catch (error: unknown) {
          return error instanceof Error ? error.message : String(error);
        }
      };
      const fetchMessage = await capture(() => fetch("https://network-probe.invalid"));
      const http = process.getBuiltinModule("node:http");
      const https = process.getBuiltinModule("node:https");
      const net = process.getBuiltinModule("node:net");
      const moduleApi = process.getBuiltinModule("node:module");
      const entryPoint = process.argv[1];
      if (
        http === undefined ||
        https === undefined ||
        net === undefined ||
        moduleApi === undefined ||
        entryPoint === undefined
      ) {
        throw new Error("A Node network module is unavailable in the Electron main process.");
      }
      const httpMessage = await capture(() => http.request("http://network-probe.invalid"));
      const httpGetMessage = await capture(() => http.get("http://network-probe.invalid"));
      const httpsMessage = await capture(() => https.request("https://network-probe.invalid"));
      const httpsGetMessage = await capture(() => https.get("https://network-probe.invalid"));
      const socketMessage = await capture(() => net.connect({ host: "127.0.0.1", port: 9 }));
      const requireMain = moduleApi.createRequire(entryPoint);
      const electronNet = (requireMain("electron") as typeof import("electron")).net;
      const electronNetMessage = await capture(() =>
        electronNet.request({ url: "https://network-probe.invalid" })
      );
      return [
        fetchMessage,
        httpMessage,
        httpGetMessage,
        httpsMessage,
        httpsGetMessage,
        socketMessage,
        electronNetMessage,
      ];
    });

    expect(blockedMessages).toEqual([
      "Main-process fetch is blocked in local-only tests.",
      "Main-process node:http.request is blocked in local-only tests.",
      "Main-process node:http.get is blocked in local-only tests.",
      "Main-process node:https.request is blocked in local-only tests.",
      "Main-process node:https.get is blocked in local-only tests.",
      "Main-process node:net.Socket.connect is blocked in local-only tests.",
      "Main-process electron.net.request is blocked in local-only tests.",
    ]);
    const requests = await mainProcessNetworkRequests(electronApp);
    expect(requests.slice(0, 5)).toEqual([
      "fetch: https://network-probe.invalid",
      "node:http.request: http://network-probe.invalid",
      "node:http.get: http://network-probe.invalid",
      "node:https.request: https://network-probe.invalid",
      "node:https.get: https://network-probe.invalid",
    ]);
    expect(requests).toHaveLength(7);
    expect(requests[5]).toMatch(/^node:net\.Socket\.connect: /);
    expect(requests[6]).toMatch(/^electron\.net\.request: /);
  });

  test("CSV import does not use main-process network transports after startup", async ({ electronApp, csvImport }) => {
    await installMainProcessNetworkProbe(electronApp);
    await csvImport.submitImport(CSV_FIXTURE_PATH);
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });

    expect(await mainProcessNetworkRequests(electronApp)).toEqual([]);
  });

  test("binary PDF import does not use main-process network transports after startup", async ({ electronApp, pdfImport }) => {
    await installMainProcessNetworkProbe(electronApp);
    await pdfImport.submitImport(PDF_FIXTURE_PATH);
    await expect(pdfImport.successStatus).toBeVisible({ timeout: 20_000 });

    expect(await mainProcessNetworkRequests(electronApp)).toEqual([]);
  });

  test("correcting and dismissing import-review rows stays on device", async ({
    appShell,
    csvImport,
    electronApp,
    window,
  }) => {
    await installMainProcessNetworkProbe(electronApp);
    await installRendererNetworkAttemptBlocker(window);
    const rendererObservation = await installRendererNetworkAttemptObserver(window);
    await appShell.openWorkspace("Import");
    await csvImport.enterFilePath(REVIEW_FIXTURE_PATH);
    await csvImport.importButton.click();
    await expect(csvImport.previewRegion).toBeVisible();
    await expect(csvImport.confirmImportButton).toBeEnabled();
    await csvImport.confirmImportButton.click();
    await expect(csvImport.successStatus).toContainText("No new transactions were added.");

    const importReview = new ImportReviewPage(window);
    await importReview.openReviewQueue();
    const reviewItems = importReview.reviewQueue
      .getByRole("list", { name: "Import review items" })
      .getByRole("listitem");
    await expect(reviewItems.filter({ hasText: basename(REVIEW_FIXTURE_PATH) })).toHaveCount(2);
    await importReview.correctRow(2, {
      date: "2026-05-19",
      amount: "-9.99",
      merchant: "REVIEW CORRECTED LOCALLY",
      accountId: "sample-acc",
      currency: "NOK",
    });
    await importReview.dismissRow(1, "Not a household transaction");
    await importReview.reviewedHistoryDisclosure.click();
    await expect(importReview.reviewRow(2)).toContainText("Corrected");
    await expect(importReview.reviewRow(1)).toContainText("Dismissed");

    expect(await mainProcessNetworkRequests(electronApp)).toEqual([]);
    expect(await rendererNetworkAttempts(window)).toEqual([]);
    expect(await rendererNetworkBlockedAttempts(window)).toEqual([]);
    expect(rendererObservation.httpRequests).toEqual([]);
    expect(rendererObservation.webSocketRequests).toEqual([]);
  });

  test("rejects malformed ledger filters, saved views, and restore payloads at the IPC boundary", async ({ window }) => {
    const responses = await window.evaluate(async () => {
      const api = (globalThis as unknown as { budgetApi: unknown }).budgetApi as {
        ledger: {
          list: (query: unknown) => Promise<unknown>;
          savedViews: { save: (input: unknown) => Promise<unknown> };
        };
        backup: { restore: (input: unknown) => Promise<unknown> };
      };
      const results: string[] = [];

      await api.ledger.list(null).then(
        () => results.push("ledger-accepted"),
        (error: unknown) => results.push(error instanceof Error ? error.message : String(error))
      );
      await api.ledger.list({ amountFromMinor: 200, amountToMinor: 100 }).then(
        () => results.push("ledger-range-accepted"),
        (error: unknown) => results.push(error instanceof Error ? error.message : String(error))
      );
      await api.ledger.savedViews.save({
        name: "Invalid month",
        filters: { datePreset: "lastMonth" },
      }).then(
        () => results.push("saved-view-accepted"),
        (error: unknown) => results.push(error instanceof Error ? error.message : String(error))
      );
      await api.backup.restore(null).then(
        () => results.push("restore-accepted"),
        (error: unknown) => results.push(error instanceof Error ? error.message : String(error))
      );

      return results;
    });

    expect(responses[0]).toContain("Transaction query must be an object.");
    expect(responses[1]).toContain("amountFromMinor must not exceed amountToMinor.");
    expect(responses[2]).toContain("datePreset must be 'thisMonth'.");
    expect(responses[3]).toContain("Restore input must be an object.");
  });

  test("rejects malformed import input before reading the supplied path", async ({ window }) => {
    const responses = await window.evaluate(async () => {
      const api = (globalThis as unknown as { budgetApi: unknown }).budgetApi as {
        import: {
          importCsv: (input: unknown) => Promise<unknown>;
          importPdf: (input: unknown) => Promise<unknown>;
        };
      };
      const results: string[] = [];

      await api.import.importCsv({
        filePath: "missing-malformed-import.csv",
        previewId: "unused-preview",
        columnMapping: { description: "" },
      }).then(
        () => results.push("csv-accepted"),
        (error: unknown) => results.push(error instanceof Error ? error.message : String(error))
      );
      await api.import.importPdf({
        filePath: "missing-malformed-import.pdf",
        previewId: "unused-preview",
        accountId: 42,
      }).then(
        () => results.push("pdf-accepted"),
        (error: unknown) => results.push(error instanceof Error ? error.message : String(error))
      );

      return results;
    });

    expect(responses[0]).toContain("Invalid CSV column mapping: description");
    expect(responses[1]).toContain("accountId must be a non-empty string when provided.");
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
