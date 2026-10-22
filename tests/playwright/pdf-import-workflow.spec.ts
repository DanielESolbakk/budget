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
import { basename, join, resolve } from "node:path";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { ImportReviewPage } from "./pom/ImportReviewPage.js";

const FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-statement.txt");
const BINARY_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-binary.pdf");
const temporaryDirectories = new Set<string>();

interface PdfTextPlacement {
  x: number;
  y: number;
  text: string;
}

function encodePdfText(value: string): string {
  return `<${Array.from(Buffer.from(value, "latin1"), (byte) => byte.toString(16).padStart(2, "0")).join("")}>`;
}

function createMixedStatusPdf(): Buffer {
  const columns = [
    { x: 20, label: "Dato" },
    { x: 95, label: "Type" },
    { x: 170, label: "Fra konto" },
    { x: 270, label: "Avsender" },
    { x: 370, label: "Til konto" },
    { x: 455, label: "Mottakernavn" },
    { x: 565, label: "Beløp" },
    { x: 635, label: "Valuta" },
    { x: 695, label: "Status" },
    { x: 760, label: "Melding/KID/Fakt.nr" },
  ];
  const placements: PdfTextPlacement[] = [
    { x: 20, y: 570, text: "ROGALAND SPAREBANK" },
    ...columns.map(({ x, label }) => ({ x, y: 520, text: label })),
    { x: 20, y: 475, text: "29.05.2026" },
    { x: 95, y: 475, text: "Purchase" },
    { x: 170, y: 475, text: "ACCT-001" },
    { x: 565, y: 475, text: "-45,00" },
    { x: 635, y: 475, text: "NOK" },
    { x: 695, y: 475, text: "Reservert" },
    { x: 760, y: 475, text: "SYNTHETIC TRANSIT" },
    { x: 20, y: 445, text: "29.05.2026" },
    { x: 95, y: 445, text: "Payment" },
    { x: 170, y: 445, text: "ACCT-001" },
    { x: 565, y: 445, text: "-350,00" },
    { x: 635, y: 445, text: "NOK" },
    { x: 695, y: 445, text: "Bekreftet" },
    { x: 760, y: 445, text: "SYNTHETIC BILL" },
    { x: 20, y: 415, text: "28.05.2026" },
    { x: 95, y: 415, text: "Purchase" },
    { x: 170, y: 415, text: "ACCT-001" },
    { x: 565, y: 415, text: "-20,00" },
    { x: 635, y: 415, text: "NOK" },
    { x: 695, y: 415, text: "Bokført" },
    { x: 760, y: 415, text: "SYNTHETIC SHOP" },
  ];
  const content = placements.map(({ x, y, text }) =>
    `BT /F1 10 Tf 1 0 0 1 ${x} ${y} Tm ${encodePdfText(text)} Tj ET`
  ).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 900 600] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const crossReferenceOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${crossReferenceOffset}\n%%EOF`;
  return Buffer.from(pdf, "ascii");
}

function writeMixedStatusPdfFixture(): string {
  const path = join(createTemporaryDirectory(), `mixed-status-${randomUUID()}.pdf`);
  writeFileSync(path, createMixedStatusPdf());
  return path;
}

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

  test("the empty state keeps file selection as the next action", async ({ pdfImport, window }) => {
    await expect(pdfImport.confirmImportButton).not.toBeVisible();
    await expect(pdfImport.importSection.getByRole("link", { name: "Select its file" })).not.toBeVisible();
    await expect(pdfImport.chooseFileButton).toBeVisible();

    await pdfImport.chooseFileButton.click();

    await expect(window.getByText(basename(BINARY_FIXTURE_PATH), { exact: true })).toBeVisible();
  });

  test("choosing a PDF file makes it the statement being previewed", async ({ pdfImport, window }) => {
    await window.getByRole("button", { name: "Choose statement file", exact: true }).click();

    await expect(window.getByText(basename(BINARY_FIXTURE_PATH), { exact: true })).toBeVisible();
    await expect(window.getByText(BINARY_FIXTURE_PATH, { exact: true })).not.toBeVisible();
    await expect(pdfImport.importButton).toBeEnabled();
  });

  test("importing another statement from the receipt opens the file picker", async ({ pdfImport, window }) => {
    await pdfImport.submitImport(FIXTURE_PATH);

    await pdfImport.importSection.getByRole("button", { name: "Import another statement", exact: true }).click();

    await expect(window.getByText(basename(BINARY_FIXTURE_PATH), { exact: true })).toBeVisible();
    await expect(pdfImport.successStatus).not.toBeVisible();
  });

  test("PDF preview uses shared stages and does not persist before confirmation", async ({ pdfImport, databasePath }) => {
    const transactionsBeforePreview = loadPersistedSnapshot(databasePath).transactions;
    await pdfImport.chooseFileButton.click();
    await pdfImport.importButton.click();
    await expect(pdfImport.previewRegion).toBeVisible();

    const stages = pdfImport.importSection.getByRole("list", { name: "PDF import progress" }).getByRole("listitem");
    await expect(stages).toHaveCount(4);
    await expect(stages.nth(0)).toHaveAttribute("data-state", "complete");
    await expect(stages.nth(1)).toContainText("Extract and validate");
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

function writeUnreadablePdfFixture(): string {
  const dir = createTemporaryDirectory();
  const path = join(dir, `unreadable-${randomUUID()}.pdf`);
  writeFileSync(path, Buffer.from("%PDF-1.7\nnot a valid PDF document", "ascii"));
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

function writeDuplicateAcrossPagesFixtures(): { firstImportPath: string; previewPath: string } {
  const directory = createTemporaryDirectory();
  const tableHeader = "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr";
  const duplicateRow = "28.05.2026 Varekjøp ACCT-001 LOCAL_USER -0,01 NOK Bokført SYNTHETIC DUPLICATE";
  const firstImportPath = join(directory, "existing-duplicate.txt");
  const previewPath = join(directory, "duplicate-on-second-page.txt");
  writeFileSync(firstImportPath, [
    "ROGALAND SPAREBANK",
    "Transaksjoner Antall: 1",
    "Kontonummer: ACCT-001",
    tableHeader,
    duplicateRow,
  ].join("\n"), "utf8");
  const newRows = Array.from({ length: 100 }, (_, index) =>
    `28.05.2026 Varekjøp ACCT-001 LOCAL_USER -${index + 1},00 NOK Bokført SYNTHETIC NEW ${String(index + 1).padStart(3, "0")}`
  );
  writeFileSync(previewPath, [
    "ROGALAND SPAREBANK",
    "Transaksjoner Antall: 101",
    "Kontonummer: ACCT-001",
    tableHeader,
    ...newRows,
    duplicateRow,
  ].join("\n"), "utf8");
  return { firstImportPath, previewPath };
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
  test.use({ importFileDialogBehavior: "pdf-selected" });

  test("hides and reopens the validated preview without losing decisions", async ({ pdfImport, window }, testInfo) => {
    const fixturePath = writeMixedStatusPdfFixture();
    await pdfImport.enterFilePath(fixturePath);
    await pdfImport.importButton.click();
    await expect(pdfImport.previewRegion).toBeVisible();

    const acknowledgement = pdfImport.importSection.getByRole("checkbox", {
      name: "I understand that these 2 rows are not booked and will be left out.",
    });
    await acknowledgement.check();
    await expect(pdfImport.confirmImportButton).toBeEnabled();
    await expect(window.getByRole("button", { name: "Hide preview", exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(window.getByRole("button", { name: "Hide preview", exact: true })).toBeInViewport();
    await window.screenshot({ path: testInfo.outputPath("statement-preview-visible.png") });

    await window.getByRole("button", { name: "Hide preview", exact: true }).click();
    await expect(pdfImport.previewRegion).not.toBeVisible();
    await expect(window.getByRole("button", { name: "Show preview", exact: true })).toBeFocused();
    await expect(pdfImport.importSection.getByText(basename(fixturePath), { exact: true })).toBeVisible();
    await expect(window.getByRole("button", { name: "Show preview", exact: true })).toHaveAttribute("aria-expanded", "false");
    await window.screenshot({ path: testInfo.outputPath("statement-preview-hidden.png") });

    await window.getByRole("button", { name: "Show preview", exact: true }).click();
    await expect(pdfImport.previewRegion).toBeVisible();
    await expect(window.getByRole("button", { name: "Hide preview", exact: true })).toBeInViewport({ ratio: 1 });
    await expect(acknowledgement).toBeChecked();
    await expect(pdfImport.confirmImportButton).toBeEnabled();
    await window.screenshot({ path: testInfo.outputPath("statement-preview-reopened.png") });
  });

  test("keeps the preview toggle fully visible above a long reopened preview", async ({ pdfImport, window }, testInfo) => {
    await window.setViewportSize({ width: 1280, height: 800 });
    await pdfImport.enterFilePath(writeLargePdfTextFixture(10_000));
    await pdfImport.importButton.click();
    await expect(pdfImport.previewRegion).toBeVisible();

    const previewTable = pdfImport.previewRegion.getByRole("table", {
      name: "PDF statement preview rows and duplicate decisions",
    });
    await expect(previewTable.getByRole("row")).toHaveCount(101);
    const toggle = window.getByRole("button", { name: "Hide preview", exact: true });
    await expect(toggle).toBeInViewport({ ratio: 0.99 });
    expect((await toggle.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(12);

    await toggle.click();
    await expect(pdfImport.previewRegion).not.toBeVisible();
    await window.getByRole("button", { name: "Show preview", exact: true }).click();
    await expect(pdfImport.previewRegion).toBeVisible();
    const reopenedToggle = window.getByRole("button", { name: "Hide preview", exact: true });
    await expect(reopenedToggle).toBeInViewport({ ratio: 0.99 });
    expect((await reopenedToggle.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(12);
    await window.screenshot({ path: testInfo.outputPath("long-preview-reopened.png") });
  });

  test("cancels an unconfirmed import and returns to file selection without saving rows", async ({
    pdfImport,
    window,
    databasePath,
  }) => {
    const transactionsBeforePreview = loadPersistedSnapshot(databasePath).transactions;
    await pdfImport.enterFilePath(BINARY_FIXTURE_PATH);
    await pdfImport.importButton.click();
    await expect(pdfImport.previewRegion).toBeVisible();

    await window.getByRole("button", { name: "Cancel import", exact: true }).click();

    await expect(pdfImport.previewRegion).not.toBeVisible();
    await expect(window.getByRole("button", { name: "Choose statement file", exact: true })).toBeVisible();
    await expect(window.getByRole("status").filter({
      hasText: "Import cancelled. No transactions were saved.",
    })).toBeVisible();
    await expect(window.getByRole("button", { name: "Choose statement file", exact: true })).toBeFocused();
    expect(loadPersistedSnapshot(databasePath).transactions).toEqual(transactionsBeforePreview);
  });

  test("keeps review and history out of the active statement preview", async ({ pdfImport, window }, testInfo) => {
    await window.setViewportSize({ width: 1280, height: 800 });
    await pdfImport.enterFilePath(BINARY_FIXTURE_PATH);
    await pdfImport.importButton.click();
    await expect(pdfImport.previewRegion).toBeVisible();
    await window.screenshot({ path: testInfo.outputPath("statement-preview.png") });

    await expect(window.getByRole("region", { name: "Import review queue", exact: true })).not.toBeVisible();
    await expect(window.getByRole("region", { name: "Import history", exact: true })).not.toBeVisible();
  });

  test("shows a source-aware completion receipt instead of an empty import form", async ({
    pdfImport,
    window,
  }, testInfo) => {
    await window.setViewportSize({ width: 1280, height: 800 });
    await pdfImport.submitImport(FIXTURE_PATH);

    await expect(pdfImport.successStatus).toContainText("Added 10 transactions to your ledger.");
    await expect(window.getByText(
      "Import complete. The summary below shows what was added and what stayed unchanged.",
      { exact: true }
    )).toBeVisible();
    await expect(pdfImport.importHeading).not.toBeVisible();
    await expect(window.getByRole("button", { name: "Enter a transaction manually instead" })).not.toBeVisible();
    await expect(pdfImport.importSection).toContainText(basename(FIXTURE_PATH));
    await expect(pdfImport.importSection).toContainText("The original statement file stays in its original folder.");
    await expect(pdfImport.importButton).not.toBeVisible();
    await expect(pdfImport.confirmImportButton).not.toBeVisible();
    await expect(pdfImport.filePathInput).not.toBeVisible();
    await expect(pdfImport.importSection.getByText("No digital statement selected.", { exact: true })).not.toBeVisible();
    await window.screenshot({ path: testInfo.outputPath("statement-import-receipt.png") });
  });

  test("keeps undo confirmation and retained transaction details beside the selected import", async ({
    pdfImport,
    window,
    databasePath,
  }, testInfo) => {
    await pdfImport.submitImport(FIXTURE_PATH);
    const importedTransaction = loadPersistedSnapshot(databasePath).transactions.find(
      (transaction) => transaction.importJobId !== undefined
    );
    expect(importedTransaction).toBeDefined();
    if (importedTransaction === undefined) return;

    const ledger = createLocalLedgerDatabase({ dbPath: databasePath });
    try {
      ledger.updateTransactionCategoryAndRule(importedTransaction.id, {
        merchantAlias: "user-corrected merchant",
        categoryId: "groceries",
      });
    } finally {
      ledger.close();
    }

    await window.getByRole("button", { name: "Import history", exact: true }).click();
    const history = window.getByRole("region", { name: "Import history", exact: true });
    const historyTable = history.getByRole("table", { name: "Completed local import jobs" });
    const importRow = historyTable.getByRole("row").filter({ hasText: basename(FIXTURE_PATH) }).first();
    await importRow.getByRole("button", { name: `Undo import ${basename(FIXTURE_PATH)}` }).click();

    const confirmation = history.getByRole("group", { name: "Undo import confirmation", exact: true });
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toBeInViewport();
    await confirmation.getByRole("button", { name: "Confirm undo", exact: true }).click();

    const result = history.getByRole("status", { name: "Import undo result" });
    await expect(result).toContainText("1 transaction kept");
    await expect(result).toContainText("changed after import");
    await expect(result).toContainText(importedTransaction.merchantRaw);
    await expect(result).toBeInViewport();
    await window.screenshot({ path: testInfo.outputPath("statement-import-undo.png") });
  });

  test("shows the target account before PDF preview", async ({ pdfImport }) => {
    const accountSelect = pdfImport.importSection.getByRole("combobox", { name: "Import into account" });

    await expect(accountSelect).toBeVisible();
    await expect(accountSelect).toHaveValue("sample-acc");
    await expect(accountSelect.locator("option")).toHaveText(["Brukskonto"]);
  });

  test("states when a PDF preview has no duplicate decisions", async ({ pdfImport }) => {
    await pdfImport.enterFilePath(BINARY_FIXTURE_PATH);
    await pdfImport.importButton.click();
    await expect(pdfImport.previewRegion).toBeVisible();
    await expect(pdfImport.previewRegion).toBeFocused();

    await expect(pdfImport.previewRegion).toContainText("No possible duplicates found.");
  });

  test("jumps to the page containing the next unresolved duplicate", async ({ pdfImport }) => {
    const fixtures = writeDuplicateAcrossPagesFixtures();
    await pdfImport.submitImport(fixtures.firstImportPath);
    await expect(pdfImport.successStatus).toContainText("Added 1 transaction to your ledger.");

    await pdfImport.enterFilePath(fixtures.previewPath);
    await pdfImport.importButton.click();
    await expect(pdfImport.previewRegion).toBeVisible();
    await expect(pdfImport.previewRegion.getByText(/Rows 1-100 of 101/)).toBeVisible();

    await pdfImport.importSection.getByRole("button", { name: "Go to unresolved duplicate" }).click();
    await expect(pdfImport.previewRegion.getByText(/Rows 101-101 of 101/)).toBeVisible();
    const duplicateRow = pdfImport.previewRegion.getByRole("row").filter({ hasText: "SYNTHETIC DUPLICATE" });
    await expect(duplicateRow).toBeVisible();
    await expect(duplicateRow).toBeFocused();
    await expect(duplicateRow).toHaveCSS("outline-width", "3px");
  });

  test("places confirmation with the statement summary before the long row list", async ({ pdfImport }) => {
    await pdfImport.enterFilePath(BINARY_FIXTURE_PATH);
    await pdfImport.importButton.click();
    await expect(pdfImport.previewRegion).toBeVisible();

    const confirmationLeadsIntoRows = await pdfImport.importSection.evaluate((section) => {
      const preview = section.querySelector('[aria-label="PDF import preview"]');
      const confirmation = section.querySelector("#pdf-confirm-button");
      const table = preview?.querySelector("table") ?? null;
      return preview !== null && confirmation !== null && table !== null &&
        preview.contains(confirmation) &&
        Boolean(confirmation.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING);
    });

    expect(confirmationLeadsIntoRows).toBe(true);
    await expect(pdfImport.previewRegion).toContainText("Importing into account: Brukskonto");
  });

  test("acknowledges excluded status rows before importing booked transactions", async ({ pdfImport, databasePath }) => {
    const fixturePath = writeMixedStatusPdfFixture();
    await pdfImport.enterFilePath(fixturePath);
    await pdfImport.importButton.click();
    await expect(pdfImport.previewRegion).toBeVisible();

    await expect(pdfImport.previewRegion).toContainText("2 rows are not booked by the bank and will not be imported.");
    const excludedRowsDisclosure = pdfImport.previewRegion.getByText("Excluded rows (2)", { exact: true });
    await expect(excludedRowsDisclosure).toBeVisible();
    await excludedRowsDisclosure.click();
    const excludedRows = pdfImport.previewRegion.getByRole("list", { name: "Excluded rows" });
    await expect(excludedRows.getByRole("listitem")).toHaveCount(2);
    await expect(excludedRows).toContainText("Line 4 · 29.05.2026 · SYNTHETIC TRANSIT · -45,00 NOK · Reservert");
    await expect(excludedRows).toContainText("Line 5 · 29.05.2026 · SYNTHETIC BILL · -350,00 NOK · Bekreftet");
    await expect(pdfImport.previewRegion.getByRole("row").filter({ hasText: "SYNTHETIC SHOP" })).toContainText("Booked · will import");
    const acknowledgement = pdfImport.importSection.getByRole("checkbox", {
      name: "I understand that these 2 rows are not booked and will be left out.",
    });
    await expect(acknowledgement).not.toBeChecked();
    await expect(pdfImport.confirmImportButton).toBeDisabled();

    await acknowledgement.check();
    await expect(pdfImport.confirmImportButton).toBeEnabled();
    await pdfImport.confirmImportButton.click();

    await expect(pdfImport.successStatus).toContainText("Added 1 transaction to your ledger.");
    await expect(pdfImport.importSection).toContainText("was imported into Brukskonto.");
    await expect(pdfImport.importSection.getByText("2 rows not yet booked were left out.", { exact: true })).toBeVisible();
    const pdfTransactions = loadPersistedSnapshot(databasePath).transactions.filter((transaction) => transaction.sourceType === "pdf");
    expect(pdfTransactions).toHaveLength(1);
    expect(pdfTransactions[0]).toMatchObject({
      bookedAtIso: "2026-05-28T00:00:00Z",
      amountMinor: -2000,
      merchantRaw: "SYNTHETIC SHOP",
      sourceType: "pdf",
    });
  });

  test("keeps the excluded-row acknowledgement readable at narrow width", async ({ pdfImport, window }) => {
    await window.setViewportSize({ width: 390, height: 844 });
    await pdfImport.enterFilePath(writeMixedStatusPdfFixture());
    await pdfImport.importButton.click();
    await expect(pdfImport.previewRegion).toBeVisible();

    const label = pdfImport.importSection.locator("label.import-excluded-acknowledgement");
    const geometry = await label.evaluate((element) => {
      const checkbox = element.querySelector("input[type=checkbox]");
      const textWidths: number[] = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const textNode = walker.currentNode;
        if (!textNode.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(textNode);
        textWidths.push(...Array.from(range.getClientRects(), (rect) => rect.width));
      }
      return {
        checkboxWidth: checkbox?.getBoundingClientRect().width ?? 0,
        widestTextLine: Math.max(...textWidths, 0),
      };
    });

    expect(geometry.checkboxWidth).toBeLessThan(32);
    expect(geometry.widestTextLine).toBeGreaterThan(120);
  });

  test("rejects a non-boolean excluded-row acknowledgement at the IPC boundary", async ({ window }) => {
    const result = await window.evaluate(async (filePath) => {
      try {
        const response = await (globalThis as unknown as Window).budgetApi.import.importPdf({
          filePath,
          previewId: "unused-preview",
          acknowledgeExcludedRows: "yes",
        } as never);
        return response.ok ? "imported" : response.errors[0]?.code ?? "failed";
      } catch (error: unknown) {
        return error instanceof Error ? error.message : String(error);
      }
    }, FIXTURE_PATH);

    expect(result).toContain("acknowledgeExcludedRows must be a boolean when provided.");
  });

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

  test("PDF parser diagnostics remain reviewable with the original source line", async ({ pdfImport, window }) => {
    const invalidStatement = writeMalformedTransactionStatementFixture();
    await pdfImport.enterFilePath(invalidStatement.path);
    await pdfImport.importButton.click();

    await expect(pdfImport.previewRegion).toBeVisible();
    const report = pdfImport.previewRegion.locator("details.import-validation-report");
    await report.getByText("Unresolved rows for review", { exact: false }).click();
    await expect(report).toContainText(`Line ${invalidStatement.lineNumber}`);
    await expect(report).toContainText("amount");
    await pdfImport.confirmImportButton.click();
    await expect(pdfImport.successStatus).toContainText("Added 9 transactions to your ledger.");
    await expect(pdfImport.importSection.getByText("1 row was sent to review during import.", { exact: true })).toBeVisible();
    await new ImportReviewPage(window).openReviewQueue();
    const reviewRow = new ImportReviewPage(window).reviewQueue
      .getByRole("listitem")
      .filter({ hasText: basename(invalidStatement.path) })
      .getByRole("group", { name: `Import review row ${invalidStatement.lineNumber}`, exact: true });
    await expect(reviewRow).toContainText("Needs review");
  });

  test("unsupported layouts retain the original source text for review", async ({ pdfImport, databasePath }) => {
    const transactionsBeforePreview = loadPersistedSnapshot(databasePath).transactions;
    await pdfImport.enterFilePath(writeUnsupportedFixture());
    await pdfImport.importButton.click();

    await expect(pdfImport.errorAlert).toBeVisible();
    const sourceEvidenceSummary = pdfImport.importSection.getByText("Unresolved source evidence", { exact: true });
    await expect(sourceEvidenceSummary).toBeVisible();
    await sourceEvidenceSummary.click();
    await expect(pdfImport.importSection).toContainText("Not a supported bank statement format.");
    await expect(pdfImport.importSection).toContainText("Some other bank");
    expect(loadPersistedSnapshot(databasePath).transactions).toEqual(transactionsBeforePreview);
  });

  test("unreadable PDFs report extraction errors and identify the selected source", async ({ pdfImport }) => {
    const unreadablePath = writeUnreadablePdfFixture();
    await pdfImport.enterFilePath(unreadablePath);
    await pdfImport.importButton.click();

    await expect(pdfImport.errorAlert).toBeVisible();
    await expect(pdfImport.errorAlert).toContainText("Import validation failed:");
    const validationReport = pdfImport.importSection.locator("details.import-validation-report");
    await validationReport.getByText("PDF validation report", { exact: false }).click();
    await expect(validationReport).toContainText("FILE_READ_ERROR");

    const sourceEvidence = pdfImport.importSection.getByText("Unresolved source evidence", { exact: true });
    await expect(sourceEvidence).toBeVisible();
    await sourceEvidence.click();
    await expect(pdfImport.importSection).toContainText(`Source: ${basename(unreadablePath)}`);
    await expect(pdfImport.importSection).toContainText("No page text was extracted.");
  });

  test("cancelling a 10,000-row PDF preflight leaves the ledger unchanged", async ({ pdfImport, databasePath }) => {
    const transactionsBeforePreview = loadPersistedSnapshot(databasePath).transactions;
    await pdfImport.enterFilePath(writeLargePdfTextFixture(10_000));
    await pdfImport.importButton.click();

    const progress = pdfImport.importSection.getByRole("status", { name: "Import preflight progress" });
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

    await window.getByRole("button", { name: "Import history", exact: true }).click();
    const historyTable = window.getByRole("region", { name: "Import history", exact: true })
      .getByRole("table", { name: "Completed local import jobs" });
    await expect(historyTable.getByRole("row")).toHaveCount(3);
  });

  test("PDF duplicate candidates support one bulk import choice with an individual override", async ({ pdfImport }) => {
    await pdfImport.submitImport(FIXTURE_PATH);
    await pdfImport.enterFilePath(FIXTURE_PATH);
    await pdfImport.importButton.click();
    await expect(pdfImport.previewRegion).toBeVisible();

    const previewTable = pdfImport.previewRegion.getByRole("table", { name: "PDF statement preview rows and duplicate decisions" });
    const duplicateRows = previewTable.getByRole("row").filter({ hasText: "Duplicate candidate" });
    await expect(duplicateRows).toHaveCount(10);
    await expect(duplicateRows.first()).toContainText(/Matched by (source reference|transaction fingerprint)/);
    await expect(duplicateRows.first().getByText("Compare existing transaction", { exact: true })).toBeVisible();
    await expect(duplicateRows.first().getByText(/^Existing:/)).not.toBeVisible();
    await duplicateRows.first().getByText("Compare existing transaction", { exact: true }).click();
    await expect(duplicateRows.first().getByText(/^Existing:/)).toBeVisible();
    await expect(pdfImport.confirmImportButton).toBeDisabled();

    const bulkActions = pdfImport.previewRegion.getByRole("group", {
      name: "Set duplicate decisions for all candidates",
    });
    await bulkActions.getByRole("button", { name: "Import all duplicate candidates", exact: true }).click();
    await expect(pdfImport.previewRegion).toContainText("10 of 10 duplicate decisions selected.");
    for (const row of await duplicateRows.all()) {
      await expect(row.getByRole("radio", { name: "Import duplicate" })).toBeChecked();
    }
    await duplicateRows.first().getByRole("radio", { name: "Skip duplicate" }).check();
    await expect(pdfImport.confirmImportButton).toBeEnabled();
    await pdfImport.confirmImportButton.click();

    await expect(pdfImport.successStatus).toHaveText("Added 9 transactions to your ledger.");
    await expect(pdfImport.importSection.getByText("1 duplicate row skipped.", { exact: true })).toBeVisible();
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
    await expect(pdfImport.importSection.getByRole("navigation", { name: "PDF import stages" })).not.toBeVisible();

    // AC-4: the import completes with user-facing feedback; adapter provenance is persisted separately.

    // The app reloads dashboard state after successful import and remounts the import section.
    await expect(pdfImport.importSection.getByRole("button", {
      name: "Import another statement",
      exact: true,
    })).toBeVisible();

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
    await expect(pdfImport.importSection.getByRole("button", {
      name: "Import another statement",
      exact: true,
    })).toBeVisible();
    await expect(pdfImport.pendingStatus).not.toBeVisible();
    await expect(pdfImport.successStatus).toHaveText("No new transactions were added.", { timeout: 10_000 });
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
    await expect(pdfImport.confirmImportButton).not.toBeVisible();
    await expect(pdfImport.importButton).toBeEnabled();
    await expect(pdfImport.previewRegion).not.toBeVisible();
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
