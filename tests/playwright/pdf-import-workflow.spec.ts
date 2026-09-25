/**
 * Playwright runtime smoke tests for the PDF import renderer workflow.
 *
 * These tests launch the built Electron app and verify:
 *   - Scenario 1: Importing the supported synthetic text PDF fixture from the renderer
 *     reports success and the adapter ID is recorded in provenance (AC-1, AC-2, AC-4).
 *   - Scenario 2: Importing an unsupported layout reports validation errors and preserves
 *     the pre-import dashboard state (AC-1, AC-3).
 *   - Scenario 3: The import workflow runs under the network guard with no outbound calls (AC-5).
 *
 * Framework boundary:
 *   Vitest   -- unit, integration, and Vitest e2e smoke tests (tests/e2e/)
 *   Playwright -- Electron runtime flow validation (this file)
 *
 * Prerequisites: `npm run test:e2e:playwright` runs `npm run build` automatically via the
 * pretest script. To run manually first: `npm run build && npm run test:e2e:playwright`.
 */

import { test, expect } from "./fixtures/electron.js";
import type { Request } from "@playwright/test";
import { join, resolve } from "node:path";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";

const FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-statement.txt");
const BINARY_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-binary.pdf");
const temporaryDirectories = new Set<string>();

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "budget-playwright-pdf-"));
  temporaryDirectories.add(directory);
  return directory;
}

test.afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

/** Writes an unsupported text content to a temp file and returns the absolute path. */
function writeUnsupportedFixture(): string {
  const dir = createTemporaryDirectory();
  const path = join(dir, `unsupported-${randomUUID()}.txt`);
  writeFileSync(path, "Not a supported bank statement format.\nSome other bank\n", "utf8");
  return path;
}

function loadPersistedSnapshot(databasePath: string) {
  const ledger = createLocalLedgerDatabase({
    dbPath: databasePath,
    seedData: {
      household: {
        id: "sample-hh",
        name: "Sample Household",
        createdAtIso: "2026-01-01T00:00:00Z",
      },
      accounts: [
        {
          id: "sample-acc",
          householdId: "sample-hh",
          name: "Brukskonto",
          currencyCode: "NOK" as const,
        },
      ],
      transactions: [],
      importJobs: [],
      monthlyCategoryTargets: [],
    },
  });

  try {
    return ledger.loadLedgerSnapshotData();
  } finally {
    ledger.close();
  }
}

test.describe("PDF import renderer workflow", () => {
  test("Scenario 0: importing a binary PDF extracts and persists representative transaction fields", async ({
    pdfImport,
    dashboard,
    databasePath,
  }) => {
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    await pdfImport.submitImport(BINARY_FIXTURE_PATH);

    await expect(pdfImport.successStatus).toBeVisible({ timeout: 20_000 });
    await expect(pdfImport.successStatus).toContainText("Added 2 transactions to your ledger");
    await expect(dashboard.monthlyTotalsSection).toBeVisible();

    const snapshot = loadPersistedSnapshot(databasePath);
    const importedTransactions = snapshot.transactions.filter((transaction) => transaction.sourceType === "pdf");
    expect(importedTransactions).toHaveLength(2);
    expect(importedTransactions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        bookedAtIso: "2026-05-27T00:00:00Z",
        amountMinor: 5_000_000,
        merchantRaw: "SALARY",
        currencyCode: "NOK",
      }),
      expect.objectContaining({
        bookedAtIso: "2026-05-26T00:00:00Z",
        amountMinor: -9_770,
        merchantRaw: "MERCHANT-005 Butikkjop",
        currencyCode: "NOK",
      }),
    ]));

    expect(snapshot.importJobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: "pdf",
        adapterId: "rogaland-sparebank-text-v1",
        candidateCount: 2,
        provenance: expect.objectContaining({
          sourceIdentity: "no.rogaland-sparebank.statement-text",
        }),
      }),
    ]));
  });

  test("Scenario 1: importing the supported synthetic text PDF fixture reports success and displays adapter identity", async ({
    pdfImport,
    dashboard,
    databasePath,
  }) => {
    // AC-1: PDF import section is visible with file path input and button.
    await expect(pdfImport.importSection).toBeVisible();
    await expect(pdfImport.importHeading).toBeVisible();
    await expect(pdfImport.filePathInput).toBeVisible();
    await expect(pdfImport.importButton).toBeVisible();

    // Capture baseline dashboard income value before import.
    const monthSelector = dashboard.monthSelector;
    await monthSelector.selectOption("2026-05");
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    const beforeIncomeText = ((await dashboard.incomeValue.textContent()) ?? "").trim();

    // AC-1, AC-2: submit the fixture text path via the renderer input.
    await pdfImport.submitImport(FIXTURE_PATH);

    // AC-1: success status is shown after import.
    await expect(pdfImport.successStatus).toBeVisible({ timeout: 10_000 });
    const statusText = await pdfImport.successStatus.textContent();
    expect(statusText).toMatch(/Added 10 transactions to your ledger/i);

    // AC-4: the import completes with user-facing feedback; adapter provenance is persisted separately.

    // The app reloads dashboard state after successful import and remounts the import section.
    await expect(pdfImport.filePathInput).toHaveValue("", { timeout: 10_000 });

    // AC-5: dashboard automatically reloads after import success.
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    await expect
      .poll(async () => ((await dashboard.incomeValue.textContent()) ?? "").trim(), {
        timeout: 10_000,
      })
      .not.toBe(beforeIncomeText);

    const snapshotAfterFirstImport = loadPersistedSnapshot(databasePath);
    const firstImportJob = snapshotAfterFirstImport.importJobs.find(
      (importJob) => importJob.adapterId === "rogaland-sparebank-text-v1"
    );
    expect(firstImportJob).toBeDefined();
    expect(firstImportJob?.candidateCount).toBeGreaterThan(0);
    expect(snapshotAfterFirstImport.transactions).toHaveLength(
      4 + (firstImportJob?.candidateCount ?? 0)
    );

    const beforeSecondImportIncomeText = ((await dashboard.incomeValue.textContent()) ?? "").trim();
    await pdfImport.filePathInput.fill(FIXTURE_PATH);
    await pdfImport.importButton.click();
    await expect(pdfImport.previewRegion).toBeVisible();
    await pdfImport.confirmImportButton.click();
    await expect(pdfImport.filePathInput).toHaveValue("", { timeout: 10_000 });
    await expect(pdfImport.pendingStatus).not.toBeVisible();
    await expect(pdfImport.successStatus).toHaveText(
      "Added 0 transactions to your ledger. 10 duplicates skipped.",
      { timeout: 10_000 }
    );
    await expect
      .poll(async () => ((await dashboard.incomeValue.textContent()) ?? "").trim(), {
        timeout: 10_000,
      })
      .toBe(beforeSecondImportIncomeText);

    const snapshotAfterSecondImport = loadPersistedSnapshot(databasePath);
    expect(snapshotAfterSecondImport.transactions).toEqual(snapshotAfterFirstImport.transactions);
    expect(snapshotAfterSecondImport.importJobs).toHaveLength(1);
    expect(snapshotAfterSecondImport.importJobs[0]).toMatchObject({
      adapterId: "rogaland-sparebank-text-v1",
    });
  });

  test("Scenario 2: importing an unsupported layout reports validation errors and leaves dashboard unchanged", async ({ pdfImport, dashboard }) => {
    // Ensure dashboard is in a known state before the invalid import.
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    const beforeIncomeText = (await dashboard.incomeValue.textContent()) ?? "";

    const unsupportedPath = writeUnsupportedFixture();

    // AC-1, AC-3: submit unsupported layout path via renderer input.
    await pdfImport.submitImport(unsupportedPath);

    // AC-3: alert with validation failure is shown.
    await expect(pdfImport.errorAlert).toBeVisible({ timeout: 10_000 });
    const alertText = await pdfImport.errorAlert.textContent();
    expect(alertText).toMatch(/failed/i);

    // AC-5: dashboard totals remain unchanged after a failed import.
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    const afterIncomeText = (await dashboard.incomeValue.textContent()) ?? "";
    expect(afterIncomeText).toBe(beforeIncomeText);
  });

  test("Regression: a missing PDF path reports a file-read failure", async ({ pdfImport }) => {
    const missingPath = join(tmpdir(), `missing-${randomUUID()}.txt`);

    await pdfImport.submitImport(missingPath);

    await expect(pdfImport.errorAlert).toBeVisible({ timeout: 10_000 });
    await expect(pdfImport.errorAlert).toContainText(missingPath);
  });

  test("Regression: PDF confirmation rejects a file changed after preview", async ({
    pdfImport,
    dashboard,
  }) => {
    const mutablePath = join(createTemporaryDirectory(), `mutable-${randomUUID()}.txt`);
    writeFileSync(mutablePath, readFileSync(FIXTURE_PATH));
    const beforeIncomeText = (await dashboard.incomeValue.textContent()) ?? "";
    const beforeExpenseText = (await dashboard.expenseValue.textContent()) ?? "";
    const beforeNetText = (await dashboard.netValue.textContent()) ?? "";

    await pdfImport.filePathInput.fill(mutablePath);
    await pdfImport.importButton.click();
    await expect(pdfImport.previewRegion).toBeVisible();

    writeFileSync(mutablePath, `${readFileSync(FIXTURE_PATH, "utf8")}changed after preview\n`, "utf8");
    await pdfImport.confirmImportButton.click();

    await expect(pdfImport.errorAlert).toBeVisible({ timeout: 10_000 });
    await expect(pdfImport.errorAlert).toContainText("Import validation failed");
    await expect(pdfImport.errorAlert).toContainText("PREVIEW_STALE: The file changed after preview.");
    await expect(dashboard.incomeValue).toHaveText(beforeIncomeText);
    await expect(dashboard.expenseValue).toHaveText(beforeExpenseText);
    await expect(dashboard.netValue).toHaveText(beforeNetText);
  });

  test("Regression: PDF import rejects an account outside the household", async ({ window }) => {
    const response = await window.evaluate(async (filePath) =>
      (globalThis as unknown as Window).budgetApi.import.importPdf({ filePath, previewId: "unused", accountId: "other-household-account" }),
      FIXTURE_PATH
    );

    expect(response).toMatchObject({
      ok: false,
      errors: [{ code: "INVALID_ACCOUNT_ID" }],
    });
  });

  test("Scenario 3: PDF import workflow runs under network guard with no outbound network calls", async ({ pdfImport, window }) => {
    // AC-5: verify the renderer import path emits no external HTTP(S) request.
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

    await pdfImport.submitImport(FIXTURE_PATH);

    await expect(pdfImport.successStatus).toBeVisible({ timeout: 10_000 });

    window.off("request", onRequest);
    expect(outboundRequests).toHaveLength(0);
  });
});
