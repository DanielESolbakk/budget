import { test as baseTest, expect } from "./fixtures/electron.js";
import { _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PendingTransactionsPage } from "./pom/PendingTransactionsPage.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";

interface PendingFixtures {
  pendingTransactions: PendingTransactionsPage;
  pendingStatementFiles: {
    csvPath: string;
    textPdfPath: string;
    reconciliationPendingCsvPath: string;
    reconciliationBookedTextPdfPath: string;
    budgetPendingCsvPath: string;
    budgetPendingTextPdfPath: string;
    unmatchedPendingCsvPath: string;
    unmatchedBookedCsvPath: string;
  };
}

const test = baseTest.extend<PendingFixtures>({
  pendingTransactions: async ({ window }, use) => {
    await use(new PendingTransactionsPage(window));
  },
  // eslint-disable-next-line no-empty-pattern
  pendingStatementFiles: async ({}, use) => {
    const directory = mkdtempSync(join(tmpdir(), "budget-pending-playwright-"));
    const csvPath = join(directory, "pending-transactions.csv");
    const textPdfPath = join(directory, "pending-transactions.txt");
    const reconciliationPendingCsvPath = join(directory, "reconciliation-pending.csv");
    const reconciliationBookedTextPdfPath = join(directory, "reconciliation-booked.txt");
    const budgetPendingCsvPath = join(directory, "budget-pending.csv");
    const budgetPendingTextPdfPath = join(directory, "budget-pending.txt");
    const unmatchedPendingCsvPath = join(directory, "unmatched-pending.csv");
    const unmatchedBookedCsvPath = join(directory, "unmatched-booked.csv");
    const statusCsvHeader =
      "Utført dato;Bokført dato;Beskrivelse;Beløp inn;Beløp ut;Valuta;Status;Melding/KID/Fakt.nr";
    writeFileSync(
      csvPath,
      [
        "Utført dato;Bokført dato;Beskrivelse;Beløp inn;Beløp ut;Valuta;Status;Melding/KID/Fakt.nr",
        "29.05.2026;;SYNTHETIC PENDING CSV;;-12.34;NOK;Reservert;REF-PENDING-CSV",
        "28.05.2026;28.05.2026;SYNTHETIC BOOKED CSV;;-5.00;NOK;Bokført;REF-BOOKED-CSV",
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      textPdfPath,
      [
        "ROGALAND SPAREBANK",
        "Transaksjoner Antall: 1",
        "Kontonummer: ACCT-001",
        "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
        "29.05.2026 Varekjøp ACCT-001 LOCAL_USER -15,00 NOK Bekreftet KID: REF-PENDING-PDF SYNTHETIC PENDING PDF",
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      reconciliationPendingCsvPath,
      [
        "Utført dato;Bokført dato;Beskrivelse;Beløp inn;Beløp ut;Valuta;Status;Melding/KID/Fakt.nr",
        "29.05.2026;;SYNTHETIC RECONCILED SHOP;;-7.00;NOK;Reservert;REF-RECONCILE-001",
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      reconciliationBookedTextPdfPath,
      [
        "ROGALAND SPAREBANK",
        "Transaksjoner Antall: 1",
        "Kontonummer: ACCT-001",
        "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
        "28.05.2026 Varekjøp ACCT-001 LOCAL_USER -8,00 NOK Bokført KID: REF-RECONCILE-001 SYNTHETIC RECONCILED SHOP",
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      budgetPendingCsvPath,
      [
        statusCsvHeader,
        "29.05.2026;;KIWI;;-12.34;NOK;Reservert;REF-BUDGET-CSV",
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      budgetPendingTextPdfPath,
      [
        "ROGALAND SPAREBANK",
        "Transaksjoner Antall: 1",
        "Kontonummer: ACCT-001",
        "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
        "28.05.2026 Varekjøp ACCT-001 LOCAL_USER -15,00 NOK Bekreftet KID: REF-BUDGET-PDF KIWI",
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      unmatchedPendingCsvPath,
      [
        statusCsvHeader,
        "29.05.2026;;SYNTHETIC NO REF PENDING;;-4.00;NOK;Reservert;",
        "28.05.2026;;SYNTHETIC AMBIGUOUS PENDING A;;-5.00;NOK;Reservert;REF-AMBIG-001",
        "27.05.2026;;SYNTHETIC AMBIGUOUS PENDING B;;-6.00;NOK;Bekreftet;REF-AMBIG-001",
      ].join("\n"),
      "utf8"
    );
    writeFileSync(
      unmatchedBookedCsvPath,
      [
        statusCsvHeader,
        "26.05.2026;26.05.2026;SYNTHETIC NO REF BOOKED;;-7.00;NOK;Bokført;",
        "26.05.2026;26.05.2026;SYNTHETIC AMBIGUOUS BOOKED;;-8.00;NOK;Bokført;REF-AMBIG-001",
      ].join("\n"),
      "utf8"
    );

    try {
      await use({
        csvPath,
        textPdfPath,
        reconciliationPendingCsvPath,
        reconciliationBookedTextPdfPath,
        budgetPendingCsvPath,
        budgetPendingTextPdfPath,
        unmatchedPendingCsvPath,
        unmatchedBookedCsvPath,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
});

async function selectSyntheticStatement(
  electronApp: ElectronApplication,
  page: Page,
  format: "csv" | "pdf",
  filePath: string
): Promise<void> {
  const previousEnvironment = await electronApp.evaluate(() => ({
    dialogBehavior: process.env["BUDGET_TEST_IMPORT_FILE_DIALOG"] ?? "native",
    csvPath: process.env["BUDGET_TEST_CSV_IMPORT_PATH"] ?? "",
    pdfPath: process.env["BUDGET_TEST_PDF_IMPORT_PATH"] ?? "",
  }));

  await electronApp.evaluate((_, selection) => {
    process.env["BUDGET_TEST_IMPORT_FILE_DIALOG"] =
      selection.format === "csv" ? "csv-selected" : "pdf-selected";
    if (selection.format === "csv") {
      process.env["BUDGET_TEST_CSV_IMPORT_PATH"] = selection.filePath;
    } else {
      process.env["BUDGET_TEST_PDF_IMPORT_PATH"] = selection.filePath;
    }
  }, { format, filePath });

  try {
    await page.getByRole("button", {
      name: /^(Choose statement file|Change statement file|Import another statement)$/,
    }).click();
    await page.getByRole("region", {
      name: format === "csv" ? "CSV Import" : "Digital statement import",
      exact: true,
    }).waitFor({ state: "visible" });
  } finally {
    await electronApp.evaluate((_, environment) => {
      process.env["BUDGET_TEST_IMPORT_FILE_DIALOG"] = environment.dialogBehavior;
      process.env["BUDGET_TEST_CSV_IMPORT_PATH"] = environment.csvPath;
      process.env["BUDGET_TEST_PDF_IMPORT_PATH"] = environment.pdfPath;
    }, previousEnvironment);
  }
}

test("reaches the Pending empty state and its ledger action by keyboard", async ({
  appShell,
  window,
}) => {
  await window.keyboard.press("Tab");
  await expect(appShell.destination("Review")).toBeFocused();
  await window.keyboard.press("Tab");
  await expect(appShell.destination("Transactions")).toBeFocused();
  await window.keyboard.press("Tab");
  const pendingDestination = appShell.destination("Pending");
  await expect(pendingDestination).toBeFocused();
  await window.keyboard.press("Enter");

  await expect(
    window.getByRole("region", { name: "Pending transactions workspace", exact: true })
  ).toBeVisible();
  await expect(window.getByRole("heading", { name: "Pending", exact: true })).toBeVisible();
  await expect(window.getByText("No pending transactions", { exact: true })).toBeVisible();
  await expect(
    window.getByText(/not included in booked totals, budget actuals or forecasts/i)
  ).toBeVisible();

  await window.keyboard.press("Tab");
  await expect(appShell.destination("Import")).toBeFocused();
  await window.keyboard.press("Tab");
  await expect(appShell.destination("Data safety")).toBeFocused();
  await window.keyboard.press("Tab");
  await expect(appShell.destination("Settings")).toBeFocused();
  await window.keyboard.press("Tab");
  const openTransactions = window.getByRole("button", {
    name: "Open transactions",
    exact: true,
  });
  await expect(openTransactions).toBeFocused();
  await window.keyboard.press("Enter");
  await expect(appShell.destination("Transactions")).toHaveAttribute("aria-current", "page");
  await expect(appShell.workspace("Transactions")).toBeVisible();
});

test("labels pending CSV rows as pending rather than unresolved in preview", async ({
  csvImport,
  pendingStatementFiles,
}) => {
  await csvImport.enterFilePath(pendingStatementFiles.csvPath);
  await csvImport.importButton.click();
  await expect(csvImport.previewRegion).toBeVisible();

  await expect(csvImport.previewRegion).toContainText("1 pending row");
  await expect(csvImport.previewRegion).toContainText("Reservert");
  await expect(csvImport.previewRegion).toContainText("SYNTHETIC PENDING CSV");
  await expect(csvImport.previewRegion).not.toContainText("1 unresolved row will be saved for review");
});

test("keeps CSV and text-PDF pending rows separate from the booked review", async ({
  appShell,
  dashboard,
  databasePath,
  electronApp,
  pendingStatementFiles,
  pendingTransactions,
  window,
}) => {
  const baselineLedger = createLocalLedgerDatabase({ dbPath: databasePath });
  let baselineMayExpenses = 0;
  try {
    baselineMayExpenses = baselineLedger
      .getTransactionsForMonth("sample-hh", "2026-05")
      .filter((transaction) => transaction.amountMinor < 0)
      .reduce((total, transaction) => total + Math.abs(transaction.amountMinor), 0);
  } finally {
    baselineLedger.close();
  }

  const outboundRequests: string[] = [];
  window.on("request", (request) => {
    if (/^https?:\/\//i.test(request.url())) outboundRequests.push(request.url());
  });

  await window.setViewportSize({ width: 1280, height: 800 });
  await pendingTransactions.openWithKeyboard();
  await expect(
    window.getByRole("region", { name: "Pending transactions workspace", exact: true })
  ).toBeVisible();

  await appShell.openWorkspace("Import");
  await selectSyntheticStatement(electronApp, window, "csv", pendingStatementFiles.csvPath);
  await pendingTransactions.importCsvFile(pendingStatementFiles.csvPath);
  await expect(
    window.getByRole("region", { name: "CSV Import", exact: true })
  ).toContainText("1 pending item is tracked in Pending.");
  await selectSyntheticStatement(electronApp, window, "pdf", pendingStatementFiles.textPdfPath);
  await pendingTransactions.importTextPdfFile(pendingStatementFiles.textPdfPath);

  await pendingTransactions.openWithKeyboard();
  await expect.poll(() => pendingTransactions.pendingCount()).toBe(2);
  const pendingText = await pendingTransactions.pendingText();
  expect(pendingText).toContain("SYNTHETIC PENDING CSV");
  expect(pendingText).toContain("Brukskonto");
  expect(pendingText).toContain("Reservert");
  expect(pendingText).toContain("REF-PENDING-CSV");
  expect(pendingText).toContain("SYNTHETIC PENDING PDF");
  expect(pendingText).toContain("Bekreftet");
  expect(pendingText).toContain("REF-PENDING-PDF");

  expect(await pendingTransactions.hasHorizontalOverflow()).toBe(false);
  await window.setViewportSize({ width: 390, height: 844 });
  await pendingTransactions.openWithKeyboard();
  expect(await pendingTransactions.hasHorizontalOverflow()).toBe(false);
  expect(await pendingTransactions.pendingRowsOverlap()).toBe(false);
  await expect(
    window.getByRole("region", { name: "Pending transactions workspace", exact: true })
  ).toBeVisible();

  await appShell.openWorkspace("Review");
  await dashboard.monthSelector.selectOption("2026-05");
  const formatNok = (amountMinor: number): string =>
    new Intl.NumberFormat("nb-NO", {
      style: "currency",
      currency: "NOK",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amountMinor / 100);
  await expect(dashboard.expenseValue).toHaveText(formatNok(baselineMayExpenses + 500));
  await expect(dashboard.expenseValue).not.toHaveText(
    formatNok(baselineMayExpenses + 500 + 1234 + 1500)
  );
  expect(outboundRequests).toEqual([]);
});

test("pending CSV and text-PDF imports leave budget actuals and forecasts unchanged", async ({
  appShell,
  dashboard,
  dashboardTarget,
  electronApp,
  forecast,
  pendingStatementFiles,
  pendingTransactions,
  window,
}) => {
  await appShell.openWorkspace("Review");
  await dashboard.monthSelector.selectOption("2026-05");
  await expect(dashboardTarget.targetCell("groceries")).toHaveText(/90,00/);
  await expect(dashboardTarget.actualCell("groceries")).toHaveText(/85,00/);
  await expect(forecast.projectedDescription).toBeVisible();
  const groceriesActualBefore = await dashboardTarget.actualCell("groceries").innerText();
  const forecastRowsBefore = await forecast.section.getByRole("listitem").allTextContents();
  expect(forecastRowsBefore).toHaveLength(3);

  await appShell.openWorkspace("Import");
  await selectSyntheticStatement(
    electronApp,
    window,
    "csv",
    pendingStatementFiles.budgetPendingCsvPath
  );
  await pendingTransactions.importCsvFile(pendingStatementFiles.budgetPendingCsvPath);
  await selectSyntheticStatement(
    electronApp,
    window,
    "pdf",
    pendingStatementFiles.budgetPendingTextPdfPath
  );
  await pendingTransactions.importTextPdfFile(pendingStatementFiles.budgetPendingTextPdfPath);

  await pendingTransactions.open();
  await expect.poll(() => pendingTransactions.pendingCount()).toBe(2);
  await appShell.openWorkspace("Review");
  await expect(dashboard.monthSelector).toHaveValue("2026-05");
  await expect(dashboardTarget.actualCell("groceries")).toHaveText(groceriesActualBefore);
  await expect
    .poll(async () => forecast.section.getByRole("listitem").allTextContents())
    .toEqual(forecastRowsBefore);
});

test("keeps missing and ambiguous references visible after later booked imports", async ({
  appShell,
  electronApp,
  pendingStatementFiles,
  pendingTransactions,
  window,
}) => {
  await appShell.openWorkspace("Import");
  await selectSyntheticStatement(
    electronApp,
    window,
    "csv",
    pendingStatementFiles.unmatchedPendingCsvPath
  );
  await pendingTransactions.importCsvFile(pendingStatementFiles.unmatchedPendingCsvPath);

  await pendingTransactions.open();
  await expect.poll(() => pendingTransactions.pendingCount()).toBe(3);
  const pendingList = window.getByRole("list", {
    name: "Pending transactions",
    exact: true,
  });
  await expect(pendingList).toContainText("SYNTHETIC NO REF PENDING");
  await expect(pendingList).toContainText("Not provided");
  await expect(pendingList).toContainText(
    "This item will stay separate because it has no source reference."
  );
  await expect(pendingList.getByText("REF-AMBIG-001", { exact: true })).toHaveCount(2);

  await appShell.openWorkspace("Import");
  await selectSyntheticStatement(
    electronApp,
    window,
    "csv",
    pendingStatementFiles.unmatchedBookedCsvPath
  );
  await pendingTransactions.importCsvFile(pendingStatementFiles.unmatchedBookedCsvPath);

  await pendingTransactions.openWithKeyboard();
  await expect.poll(() => pendingTransactions.pendingCount()).toBe(3);
  await expect(pendingList.getByText("REF-AMBIG-001", { exact: true })).toHaveCount(2);
  await appShell.openWorkspace("Transactions");
  await expect(
    window.getByRole("cell", { name: "SYNTHETIC NO REF BOOKED", exact: true })
  ).toHaveCount(1);
  await expect(
    window.getByRole("cell", { name: "SYNTHETIC AMBIGUOUS BOOKED", exact: true })
  ).toHaveCount(1);
});

test("retains pending observations after restarting the desktop application", async ({
  appShell,
  databasePath,
  electronApp,
  pendingStatementFiles,
  pendingTransactions,
  window,
}) => {
  await appShell.openWorkspace("Import");
  await selectSyntheticStatement(electronApp, window, "csv", pendingStatementFiles.csvPath);
  await pendingTransactions.importCsvFile(pendingStatementFiles.csvPath);
  await electronApp.close();

  const restartedApp = await electron.launch({
    args: [join(process.cwd(), "out", "main", "index.js")],
    env: {
      ...process.env,
      NODE_ENV: "test",
      BUDGET_DB_PATH: databasePath,
    },
  });

  try {
    const restartedWindow = await restartedApp.firstWindow();
    await restartedWindow.waitForLoadState("domcontentloaded");
    const restartedPendingTransactions = new PendingTransactionsPage(restartedWindow);
    await restartedPendingTransactions.open();
    await expect.poll(() => restartedPendingTransactions.pendingCount()).toBe(1);
    expect(await restartedPendingTransactions.pendingText()).toContain("REF-PENDING-CSV");
  } finally {
    await restartedApp.close();
  }
});

test("retains the reconciled booked row after restarting the desktop application", async ({
  appShell,
  databasePath,
  electronApp,
  pendingStatementFiles,
  pendingTransactions,
  window,
}) => {
  await appShell.openWorkspace("Import");
  await selectSyntheticStatement(
    electronApp,
    window,
    "csv",
    pendingStatementFiles.reconciliationPendingCsvPath
  );
  await pendingTransactions.importCsvFile(pendingStatementFiles.reconciliationPendingCsvPath);
  await selectSyntheticStatement(
    electronApp,
    window,
    "pdf",
    pendingStatementFiles.reconciliationBookedTextPdfPath
  );
  await pendingTransactions.importTextPdfFile(
    pendingStatementFiles.reconciliationBookedTextPdfPath
  );

  await pendingTransactions.open();
  await expect(window.getByText("No pending transactions", { exact: true })).toBeVisible();
  await appShell.openWorkspace("Transactions");
  await expect(
    window.getByRole("cell", { name: "SYNTHETIC RECONCILED SHOP", exact: true })
  ).toHaveCount(1);
  await electronApp.close();

  const restartedApp = await electron.launch({
    args: [join(process.cwd(), "out", "main", "index.js")],
    env: {
      ...process.env,
      NODE_ENV: "test",
      BUDGET_DB_PATH: databasePath,
    },
  });

  try {
    const restartedWindow = await restartedApp.firstWindow();
    await restartedWindow.waitForLoadState("domcontentloaded");
    const restartedPendingTransactions = new PendingTransactionsPage(restartedWindow);
    await restartedPendingTransactions.open();
    await expect(
      restartedWindow.getByText("No pending transactions", { exact: true })
    ).toBeVisible();
    await restartedWindow.getByRole("button", { name: "Transactions", exact: true }).click();
    await expect(
      restartedWindow.getByRole("cell", { name: "SYNTHETIC RECONCILED SHOP", exact: true })
    ).toHaveCount(1);
  } finally {
    await restartedApp.close();
  }
});

test("keeps a pending CSV re-import idempotent in the Pending view", async ({
  appShell,
  electronApp,
  pendingStatementFiles,
  pendingTransactions,
  window,
}) => {
  await appShell.openWorkspace("Import");
  await selectSyntheticStatement(
    electronApp,
    window,
    "csv",
    pendingStatementFiles.reconciliationPendingCsvPath
  );
  await pendingTransactions.importCsvFile(pendingStatementFiles.reconciliationPendingCsvPath);
  await selectSyntheticStatement(
    electronApp,
    window,
    "csv",
    pendingStatementFiles.reconciliationPendingCsvPath
  );
  await pendingTransactions.importCsvFile(pendingStatementFiles.reconciliationPendingCsvPath);

  await pendingTransactions.open();
  await expect.poll(() => pendingTransactions.pendingCount()).toBe(1);
  expect(await pendingTransactions.pendingText()).toContain("REF-RECONCILE-001");
});

test("keeps a pending text-PDF re-import idempotent in the Pending view", async ({
  appShell,
  electronApp,
  pendingStatementFiles,
  pendingTransactions,
  window,
}) => {
  await appShell.openWorkspace("Import");
  await selectSyntheticStatement(electronApp, window, "pdf", pendingStatementFiles.textPdfPath);
  await pendingTransactions.importTextPdfFile(pendingStatementFiles.textPdfPath);
  await selectSyntheticStatement(electronApp, window, "pdf", pendingStatementFiles.textPdfPath);
  await pendingTransactions.importTextPdfFile(pendingStatementFiles.textPdfPath);

  await pendingTransactions.open();
  await expect.poll(() => pendingTransactions.pendingCount()).toBe(1);
  expect(await pendingTransactions.pendingText()).toContain("REF-PENDING-PDF");
});

test("moves a unique matching pending item into the booked ledger", async ({
  appShell,
  electronApp,
  pendingStatementFiles,
  pendingTransactions,
  window,
}) => {
  await appShell.openWorkspace("Import");
  await selectSyntheticStatement(
    electronApp,
    window,
    "csv",
    pendingStatementFiles.reconciliationPendingCsvPath
  );
  await pendingTransactions.importCsvFile(pendingStatementFiles.reconciliationPendingCsvPath);

  await pendingTransactions.open();
  await expect.poll(() => pendingTransactions.pendingCount()).toBe(1);
  expect(await pendingTransactions.pendingText()).toContain("REF-RECONCILE-001");

  await appShell.openWorkspace("Import");
  await selectSyntheticStatement(
    electronApp,
    window,
    "pdf",
    pendingStatementFiles.reconciliationBookedTextPdfPath
  );
  await pendingTransactions.importTextPdfFile(
    pendingStatementFiles.reconciliationBookedTextPdfPath
  );

  await pendingTransactions.openWithKeyboard();
  await expect(window.getByText("No pending transactions", { exact: true })).toBeVisible();
  await appShell.openWorkspace("Transactions");
  await expect(
    window.getByRole("cell", { name: "SYNTHETIC RECONCILED SHOP", exact: true })
  ).toBeVisible();
});

test("explains and undoes a pending-only import from import history", async ({
  appShell,
  electronApp,
  pendingStatementFiles,
  pendingTransactions,
  window,
}) => {
  await appShell.openWorkspace("Import");
  await selectSyntheticStatement(
    electronApp,
    window,
    "csv",
    pendingStatementFiles.reconciliationPendingCsvPath
  );
  await pendingTransactions.importCsvFile(pendingStatementFiles.reconciliationPendingCsvPath);

  await window.getByRole("button", { name: "Import history", exact: true }).click();
  const importHistory = window.getByRole("region", { name: "Import history", exact: true });
  const undoButton = importHistory.getByRole("button", {
    name: "Undo import reconciliation-pending.csv",
    exact: true,
  });
  await expect(undoButton).toBeEnabled();
  await undoButton.click();

  const confirmation = window.getByRole("group", { name: "Undo import confirmation" });
  await expect(confirmation).toContainText("pending item");
  await expect(confirmation).toContainText(
    "Pending items already reconciled to booked transactions will remain linked to those transactions."
  );
  await confirmation.getByRole("button", { name: "Confirm undo", exact: true }).click();

  await pendingTransactions.open();
  await expect(window.getByText("No pending transactions", { exact: true })).toBeVisible();
});

test("describes pending-only undo counts as imported items", async ({
  appShell,
  electronApp,
  pendingStatementFiles,
  pendingTransactions,
  window,
}) => {
  await appShell.openWorkspace("Import");
  await selectSyntheticStatement(
    electronApp,
    window,
    "csv",
    pendingStatementFiles.reconciliationPendingCsvPath
  );
  await pendingTransactions.importCsvFile(pendingStatementFiles.reconciliationPendingCsvPath);

  await window.getByRole("button", { name: "Import history", exact: true }).click();
  const importHistory = window.getByRole("region", { name: "Import history", exact: true });
  const undoButton = importHistory.getByRole("button", {
    name: "Undo import reconciliation-pending.csv",
    exact: true,
  });
  await expect(undoButton).toBeEnabled();
  await undoButton.click();

  const confirmation = window.getByRole("group", { name: "Undo import confirmation" });
  await confirmation.getByRole("button", { name: "Confirm undo", exact: true }).click();
  const undoResult = importHistory.getByRole("status", {
    name: "Import undo result",
    exact: true,
  });
  await expect(undoResult).toContainText("1 imported item removed.");
  await expect(undoResult).toContainText("No items from this import were retained.");
});

test("keeps the import history caption readable on mobile", async ({
  appShell,
  electronApp,
  pendingStatementFiles,
  pendingTransactions,
  window,
}) => {
  await appShell.openWorkspace("Import");
  await selectSyntheticStatement(electronApp, window, "csv", pendingStatementFiles.csvPath);
  await pendingTransactions.importCsvFile(pendingStatementFiles.csvPath);

  await window.setViewportSize({ width: 390, height: 844 });
  await window.getByRole("button", { name: "Import history", exact: true }).click();
  const importHistory = window.getByRole("region", { name: "Import history", exact: true });
  const caption = importHistory.getByRole("table").getByRole("caption");
  await expect(caption).toBeVisible();
  const captionBounds = await caption.boundingBox();
  expect(captionBounds?.width ?? 0).toBeGreaterThan(300);
  expect(captionBounds?.height ?? Number.POSITIVE_INFINITY).toBeLessThan(32);
});

test("renders pending amounts at the body text size or larger", async ({
  appShell,
  electronApp,
  pendingStatementFiles,
  pendingTransactions,
  window,
}) => {
  await appShell.openWorkspace("Import");
  await selectSyntheticStatement(electronApp, window, "csv", pendingStatementFiles.csvPath);
  await pendingTransactions.importCsvFile(pendingStatementFiles.csvPath);
  await pendingTransactions.open();

  const amount = window.locator(".pending-observation-amount").first();
  await expect(amount).toBeVisible();
  const amountFontSize = await amount.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize)
  );
  expect(amountFontSize).toBeGreaterThanOrEqual(16);
});
