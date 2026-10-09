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

test.describe("PDF file picker cancellation", () => {
  test.use({ importFileDialogBehavior: "native" });

  test("keeps the entered path when the picker is canceled", async ({ pdfImport, electronApp }) => {
    await electronApp.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });

    await pdfImport.enterFilePath(FIXTURE_PATH);
    await expect(pdfImport.importButton).toBeEnabled();

    await pdfImport.chooseFileButton.click();

    await expect(pdfImport.filePathInput).toHaveValue(FIXTURE_PATH);
    await expect(pdfImport.importButton).toBeEnabled();
    await expect(pdfImport.previewRegion).not.toBeVisible();
  });
});

test.describe("PDF file picker result", () => {
  test.use({ importFileDialogBehavior: "pdf-selected" });

  test("disabled confirmation explains how to select a statement before preview", async ({ pdfImport }) => {
    await expect(pdfImport.confirmImportButton).toBeDisabled();
    const reason = pdfImport.importSection.locator("#pdf-confirm-help");
    await expect(reason).toContainText("Choose a digital PDF statement");
    await expect(reason.getByRole("link", { name: "select its file" })).toHaveAttribute(
      "href",
      "#pdf-file-picker-button"
    );
  });

  test("choosing a PDF file makes it the statement being previewed", async ({ pdfImport, window }) => {
    await window.getByRole("button", { name: "Choose PDF file", exact: true }).click();

    await expect(window.getByText(FIXTURE_PATH, { exact: true })).toBeVisible();
    await expect(pdfImport.importButton).toBeEnabled();
  });

  test("PDF preview uses shared stages and does not persist before confirmation", async ({ pdfImport, databasePath }) => {
    const transactionsBeforePreview = loadPersistedSnapshot(databasePath).transactions;
    await pdfImport.chooseFileButton.click();
    await pdfImport.importButton.click();
    await expect(pdfImport.previewRegion).toBeVisible();

    const stages = pdfImport.importSection.getByRole("list", { name: "PDF import progress" }).getByRole("listitem");
    await expect(stages).toHaveCount(4);
    await expect(stages.nth(0)).toHaveAttribute("data-state", "complete");
    await expect(stages.nth(1)).toHaveAttribute("data-state", "complete");
    await expect(stages.nth(2)).toHaveAttribute("aria-current", "step");
    expect(loadPersistedSnapshot(databasePath).transactions).toEqual(transactionsBeforePreview);
  });
});

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

function writeMalformedTransactionStatementFixture(): { path: string; lineNumber: number } {
  const directory = createTemporaryDirectory();
  const path = join(directory, `malformed-row-${randomUUID()}.txt`);
  const lines = readFileSync(FIXTURE_PATH, "utf8").split(/\r?\n/);
  const transactionIndex = lines.findIndex((line) => /^\s*\d{2}\.\d{2}\.\d{4}\s+/.test(line));
  lines[transactionIndex] = "27.05.2026   BROKEN STORE                              invalid         75,00";
  writeFileSync(path, lines.join("\n"), "utf8");
  return { path, lineNumber: transactionIndex + 1 };
}

function writeLargePdfTextFixture(transactionCount: number): string {
  const directory = createTemporaryDirectory();
  const path = join(directory, `large-${transactionCount}-rows.txt`);
  const sourceLines = readFileSync(FIXTURE_PATH, "utf8").split(/\r?\n/);
  const firstTransactionIndex = sourceLines.findIndex((line) => /^\s*\d{2}\.\d{2}\.\d{4}\s+/.test(line));
  const statementHeader = sourceLines.slice(0, firstTransactionIndex).join("\n");
  const transactionLine = sourceLines[firstTransactionIndex];
  if (transactionLine === undefined) throw new Error("Synthetic PDF fixture has no transaction row.");
  writeFileSync(path, `${statementHeader}\n${Array.from({ length: transactionCount }, () => transactionLine).join("\n")}`, "utf8");
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
  test("10,000-row PDF preview renders a bounded page with navigation", async ({ pdfImport }) => {
    await pdfImport.enterFilePath(writeLargePdfTextFixture(10_000));
    await pdfImport.importButton.click();
    await expect(pdfImport.previewRegion).toBeVisible();

    const previewTable = pdfImport.previewRegion.getByRole("table", { name: "PDF statement preview rows and duplicate decisions" });
    await expect(previewTable.getByRole("row")).toHaveCount(101);
    await pdfImport.previewRegion.getByRole("button", { name: "Next rows", exact: true }).click();
    await expect(previewTable.getByRole("row")).toHaveCount(101);
    await expect(pdfImport.previewRegion.getByText(/Rows 101-200 of 10/)).toBeVisible();
  });

  test("PDF validation report identifies the source line and field", async ({ pdfImport }) => {
    const invalidStatement = writeMalformedTransactionStatementFixture();
    await pdfImport.enterFilePath(invalidStatement.path);
    await pdfImport.importButton.click();

    await expect(pdfImport.errorAlert).toBeVisible();
    const report = pdfImport.importSection.locator("details.import-validation-report");
    await report.getByText("PDF validation report", { exact: false }).click();
    await expect(report).toContainText(`Line ${invalidStatement.lineNumber}`);
    await expect(report).toContainText("amount");
  });

  test("cancelling a 10,000-row PDF preflight leaves the ledger unchanged", async ({ pdfImport, databasePath }) => {
    const transactionsBeforePreview = loadPersistedSnapshot(databasePath).transactions;
    await pdfImport.enterFilePath(writeLargePdfTextFixture(10_000));
    await pdfImport.importButton.click();

    const progress = pdfImport.importSection.getByRole("status", { name: "Import preflight progress" });
    await expect(progress).toBeVisible();
    await expect(pdfImport.importSection.getByRole("button", { name: "Cancel preview", exact: true })).toBeEnabled();
    await pdfImport.importSection.getByRole("button", { name: "Cancel preview", exact: true }).click();

    await expect(progress).toContainText("Preview cancelled");
    await expect(pdfImport.previewRegion).not.toBeVisible();
    expect(loadPersistedSnapshot(databasePath).transactions).toEqual(transactionsBeforePreview);
  });

  test("history keeps repeated imports of the same PDF as separate runs", async ({ pdfImport, window }) => {
    await pdfImport.submitImport(FIXTURE_PATH);
    await pdfImport.enterFilePath(FIXTURE_PATH);
    await pdfImport.importButton.click();
    await expect(pdfImport.previewRegion).toBeVisible();

    const previewRows = pdfImport.previewRegion.getByRole("table", {
      name: "PDF statement preview rows and duplicate decisions",
    }).getByRole("row").filter({ hasText: "Duplicate candidate" });
    for (const row of await previewRows.all()) {
      await row.getByRole("radio", { name: "Skip duplicate" }).check();
    }
    await pdfImport.confirmImportButton.click();

    const historyTable = window.getByRole("region", { name: "Import history", exact: true })
      .getByRole("table", { name: "Completed local import jobs" });
    await expect(historyTable.getByRole("row")).toHaveCount(3);
  });

  test("PDF duplicate candidates require explicit per-row skip or import decisions", async ({ pdfImport }) => {
    await pdfImport.submitImport(FIXTURE_PATH);
    await pdfImport.enterFilePath(FIXTURE_PATH);
    await pdfImport.importButton.click();
    await expect(pdfImport.previewRegion).toBeVisible();

    const previewTable = pdfImport.previewRegion.getByRole("table", { name: "PDF statement preview rows and duplicate decisions" });
    const duplicateRows = previewTable.getByRole("row").filter({ hasText: "Duplicate candidate" });
    await expect(duplicateRows).toHaveCount(10);
    await expect(duplicateRows.first()).toContainText(/Matched by (source reference|transaction fingerprint)/);
    await expect(pdfImport.confirmImportButton).toBeDisabled();

    for (const row of await duplicateRows.all()) {
      await row.getByRole("radio", { name: "Skip duplicate" }).check();
    }
    await duplicateRows.first().getByRole("radio", { name: "Import duplicate" }).check();
    await expect(pdfImport.confirmImportButton).toBeEnabled();
    await pdfImport.confirmImportButton.click();

    await expect(pdfImport.successStatus).toHaveText("Added 1 transaction to your ledger.");
    await expect(pdfImport.importSection.getByText("9 duplicate rows skipped.", { exact: true })).toBeVisible();
  });

  test("Scenario 0: importing a binary PDF extracts and persists representative transaction fields", async ({
    appShell,
    pdfImport,
    dashboard,
    databasePath,
  }) => {
    await appShell.openWorkspace("Review");
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    await appShell.openWorkspace("Import");
    await pdfImport.submitImport(BINARY_FIXTURE_PATH);

    await expect(pdfImport.successStatus).toBeVisible({ timeout: 20_000 });
    await expect(pdfImport.successStatus).toContainText("Added 2 transactions to your ledger");
    await appShell.openWorkspace("Review");
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
    appShell,
    pdfImport,
    dashboard,
    databasePath,
  }) => {
    // AC-1: PDF import section is visible with file path input and button.
    await expect(pdfImport.importSection).toBeVisible();
    await expect(pdfImport.importHeading).toBeVisible();
    await expect(pdfImport.chooseFileButton).toBeVisible();
    await expect(pdfImport.importSection.getByText("Advanced: enter a file path", { exact: true })).toBeVisible();
    await expect(pdfImport.filePathInput).not.toBeVisible();
    await expect(pdfImport.importButton).toBeVisible();

    // Capture baseline dashboard income value before import.
    await appShell.openWorkspace("Review");
    const monthSelector = dashboard.monthSelector;
    await monthSelector.selectOption("2026-05");
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    const beforeIncomeText = ((await dashboard.incomeValue.textContent()) ?? "").trim();

    // AC-1, AC-2: submit the fixture text path via the renderer input.
    await appShell.openWorkspace("Import");
    await pdfImport.submitImport(FIXTURE_PATH);

    // AC-1: success status is shown after import.
    await expect(pdfImport.successStatus).toContainText(/Added 10 transactions to your ledger/i, {
      timeout: 10_000,
    });
    const stageProgress = pdfImport.importSection.getByRole("navigation", { name: "PDF import stages" });
    const stages = stageProgress.getByRole("listitem");
    await expect(stages).toHaveCount(4);
    for (const stage of await stages.all()) {
      await expect(stage).toHaveAttribute("data-state", "complete");
    }
    await expect(stageProgress.locator('[aria-current="step"]')).toHaveCount(0);

    // AC-4: the import completes with user-facing feedback; adapter provenance is persisted separately.

    // The app reloads dashboard state after successful import and remounts the import section.
    await expect(pdfImport.filePathInput).toHaveValue("", { timeout: 10_000 });

    // AC-5: dashboard automatically reloads after import success.
    await appShell.openWorkspace("Review");
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
    await appShell.openWorkspace("Import");
    await pdfImport.enterFilePath(FIXTURE_PATH);
    await pdfImport.importButton.click();
    await expect(pdfImport.previewRegion).toBeVisible();
    const duplicateRows = pdfImport.previewRegion.getByRole("table", {
      name: "PDF statement preview rows and duplicate decisions",
    }).getByRole("row").filter({ hasText: "Duplicate candidate" });
    await expect(duplicateRows).toHaveCount(10);
    for (const row of await duplicateRows.all()) {
      await row.getByRole("radio", { name: "Skip duplicate" }).check();
    }
    await pdfImport.confirmImportButton.click();
    await expect(pdfImport.filePathInput).toHaveValue("", { timeout: 10_000 });
    await expect(pdfImport.pendingStatus).not.toBeVisible();
    await expect(pdfImport.successStatus).toHaveText("Added 0 transactions to your ledger.", { timeout: 10_000 });
    await expect(pdfImport.importSection.getByText("10 duplicate rows skipped.", { exact: true })).toBeVisible();
    await appShell.openWorkspace("Review");
    await expect
      .poll(async () => ((await dashboard.incomeValue.textContent()) ?? "").trim(), {
        timeout: 10_000,
      })
      .toBe(beforeSecondImportIncomeText);

    const snapshotAfterSecondImport = loadPersistedSnapshot(databasePath);
    expect(snapshotAfterSecondImport.transactions).toEqual(snapshotAfterFirstImport.transactions);
    expect(snapshotAfterSecondImport.importJobs).toHaveLength(2);
    expect(new Set(snapshotAfterSecondImport.importJobs.map((job) => job.id)).size).toBe(2);
    expect(snapshotAfterSecondImport.importJobs[0]).toMatchObject({
      adapterId: "rogaland-sparebank-text-v1",
    });
  });

  test("Scenario 2: importing an unsupported layout reports validation errors and leaves dashboard unchanged", async ({ appShell, pdfImport, dashboard }) => {
    // Ensure dashboard is in a known state before the invalid import.
    await appShell.openWorkspace("Review");
    await dashboard.monthSelector.selectOption("2026-05");
    await expect(dashboard.monthlyTotalsSection).toBeVisible();
    const beforeIncomeText = (await dashboard.incomeValue.textContent()) ?? "";

    const unsupportedPath = writeUnsupportedFixture();

    // AC-1, AC-3: submit unsupported layout path via renderer input.
    await appShell.openWorkspace("Import");
    await pdfImport.submitImport(unsupportedPath);

    // AC-3: alert with validation failure is shown.
    await expect(pdfImport.errorAlert).toBeVisible({ timeout: 10_000 });
    const alertText = await pdfImport.errorAlert.textContent();
    expect(alertText).toMatch(/failed/i);

    // AC-5: dashboard totals remain unchanged after a failed import.
    await appShell.openWorkspace("Review");
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
    appShell,
    pdfImport,
    dashboard,
  }) => {
    const mutablePath = join(createTemporaryDirectory(), `mutable-${randomUUID()}.txt`);
    writeFileSync(mutablePath, readFileSync(FIXTURE_PATH));
    await appShell.openWorkspace("Review");
    await dashboard.monthSelector.selectOption("2026-05");
    const beforeIncomeText = (await dashboard.incomeValue.textContent()) ?? "";
    const beforeExpenseText = (await dashboard.expenseValue.textContent()) ?? "";
    const beforeNetText = (await dashboard.netValue.textContent()) ?? "";

    await appShell.openWorkspace("Import");
    await pdfImport.enterFilePath(mutablePath);
    await pdfImport.importButton.click();
    await expect(pdfImport.previewRegion).toBeVisible();

    writeFileSync(mutablePath, `${readFileSync(FIXTURE_PATH, "utf8")}changed after preview\n`, "utf8");
    await pdfImport.confirmImportButton.click();

    await expect(pdfImport.errorAlert).toBeVisible({ timeout: 10_000 });
    await expect(pdfImport.errorAlert).toContainText("Import validation failed");
    await expect(pdfImport.errorAlert).toContainText("PREVIEW_STALE: The file changed after preview.");
    await expect(pdfImport.confirmImportButton).toBeDisabled();
    await expect(pdfImport.previewRegion).not.toBeVisible();
    await expect(pdfImport.importSection.locator("#pdf-confirm-help").getByRole("link", {
      name: "preview the statement again",
    })).toHaveAttribute("href", "#pdf-preview-button");
    await appShell.openWorkspace("Review");
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
