import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "./fixtures/electron.js";

const temporaryDirectories = new Set<string>();

function writeStatement(name: string, content: string): string {
  const directory = mkdtempSync(join(tmpdir(), "budget-currency-display-"));
  temporaryDirectories.add(directory);
  const filePath = join(directory, name);
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

function writeCsvStatement(): string {
  return writeStatement("native-currencies.csv", [
    "Utført dato;Bokført dato;Beskrivelse;Beløp inn;Beløp ut;Valuta;Status",
    "30.05.2026;30.05.2026;FOREIGN BOOKED;;-78.00;GBP;Bokført",
    "29.05.2026;29.05.2026;LOCAL BOOKED;;-42.00;NOK;Bokført",
    "31.05.2026;;FOREIGN PENDING;;-12.50;GBP;Reservert",
  ].join("\n"));
}

test.use({
  importFileDialogBehavior: "csv-selected",
  backupOutputDialogBehavior: "cancel",
  restoreSnapshotDialogBehavior: "cancel",
});

test.afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

test("skipping navigation preserves month, ledger, import and recovery IPC", async ({
  appShell, dashboard, ledger, csvImport, recovery, window,
}) => {
  await appShell.openWorkspace("Review");
  await window.getByRole("link", { name: "Skip to workspace" }).focus();
  await window.keyboard.press("Enter");
  await expect(window.getByRole("main")).toBeFocused();
  await dashboard.monthSelector.selectOption("2026-05");
  await expect(dashboard.expenseValue).toContainText("85,00");
  await expect(dashboard.monthChangeError).toHaveCount(0);
  await appShell.openWorkspace("Transactions");
  await expect(ledger.resultStatus).toContainText("4 ledger transactions");
  await ledger.merchantInput.fill("Rema");
  await expect(ledger.resultStatus).toContainText("1 ledger transaction");
  await appShell.openWorkspace("Import");
  await csvImport.chooseFileButton.click();
  await expect(csvImport.importSection.getByText("rogaland-2026-05-synthetic.csv", { exact: true })).toBeVisible();
  await appShell.openWorkspace("Data safety");
  await recovery.backupBrowseButton.click();
  await expect(recovery.backupCancelled).toBeVisible();
  await recovery.chooseSnapshotButton.click();
  await expect(recovery.restoreSection.getByRole("alert")).toHaveCount(0);
});

test("the over-target fragment preserves subsequent ledger IPC", async ({
  appShell, dashboard, categoryTarget, ledger, window,
}) => {
  await appShell.openWorkspace("Review");
  await dashboard.monthSelector.selectOption("2026-05");
  await categoryTarget.editTargetButton("groceries").click();
  await categoryTarget.targetAmountInput.fill("80");
  await categoryTarget.saveButton.click();
  await expect(dashboard.overTargetLink).toBeVisible();
  await dashboard.overTargetLink.click();
  await expect(window).toHaveURL(/#target-vs-actual$/);
  await appShell.openWorkspace("Transactions");
  await ledger.merchantInput.fill("Rema");
  await expect(ledger.resultStatus).toContainText("1 ledger transaction");
});

for (const destination of ["query", "other-document"] as const) {
  test(`rejects an unapproved ${destination} in the main window`, async ({ electronApp, window }) => {
    await expect(window.getByRole("heading", { name: "Budget Planner" })).toBeVisible();
    const response = await electronApp.evaluate(async ({ BrowserWindow }, destination) => {
      const browser = BrowserWindow.getAllWindows()[0];
      if (browser === undefined) throw new Error("Electron window is unavailable.");
      const target = destination === "query"
        ? `${browser.webContents.getURL()}?unapproved=1#workspace`
        : "data:text/html,<title>Unapproved document</title>";
      if (destination === "other-document") {
        return await browser.loadURL(target).then(
          () => "Unapproved document loaded.",
          (error: unknown) => error instanceof Error ? error.message : String(error),
        );
      }
      await browser.loadURL(target);
      return await browser.webContents.executeJavaScript(
        "window.budgetApi.ledger.list({}).then(() => 'allowed', (error) => error.message)",
      ) as string;
    }, destination);
    expect(response).toContain(destination === "query" ? "Untrusted renderer sender." : "ERR_BLOCKED_BY_CLIENT");
  });
}

test("CSV previews preserve booked, pending and duplicate currencies", async ({ appShell, csvImport }) => {
  const statement = writeCsvStatement();
  await appShell.openWorkspace("Import");
  await csvImport.enterFilePath(statement);
  await csvImport.importButton.click();
  const booked = csvImport.previewRegion.getByRole("row").filter({ hasText: "FOREIGN BOOKED" });
  const pending = csvImport.previewRegion.getByRole("row").filter({ hasText: "FOREIGN PENDING" });
  await expect.soft(booked.getByRole("cell").nth(2)).toHaveText(/78,00\s+GBP/);
  await expect.soft(pending.getByRole("cell").nth(2)).toHaveText(/12,50\s+GBP/);
  await csvImport.confirmImportButton.click();
  await expect(csvImport.successStatus).toBeVisible();
  await csvImport.enterFilePath(statement);
  await csvImport.importButton.click();
  await booked.getByText("Compare existing transaction", { exact: true }).click();
  await expect(booked.locator(".import-duplicate-match")).toContainText(/78,00\s+GBP/);
});

test("digital statement previews preserve booked, pending and duplicate currencies", async ({ pdfImport }) => {
  const statement = writeStatement("native-currencies.txt", [
    "ROGALAND SPAREBANK",
    "Dato       Type          Fra konto      Avsender          Til konto     Mottakernavn       Beløp     Valuta   Status     Melding/KID/Fakt.nr",
    "30.05.2026 Varekjøp      ACCT-001       LOCAL_USER                                          -78,00   GBP      Bokført    29.05 FOREIGN STATEMENT",
    "31.05.2026 Varekjøp      ACCT-001       LOCAL_USER                                          -12,50   GBP      Reservert  30.05 FOREIGN PENDING",
  ].join("\n"));
  await pdfImport.enterFilePath(statement);
  await pdfImport.importButton.click();
  const booked = pdfImport.previewRegion.getByRole("row").filter({ hasText: "FOREIGN STATEMENT" });
  await expect.soft(booked.getByRole("cell").nth(2)).toHaveText(/78,00\s+GBP/);
  await pdfImport.previewRegion.locator("details.import-pending-observations > summary").click();
  await expect.soft(pdfImport.previewRegion.getByRole("listitem").filter({ hasText: "FOREIGN PENDING" }))
    .toContainText(/12,50\s+GBP/);
  await pdfImport.confirmImportButton.click();
  await expect(pdfImport.successStatus).toBeVisible();
  await pdfImport.enterFilePath(statement);
  await pdfImport.importButton.click();
  await booked.getByText("Compare existing transaction", { exact: true }).click();
  await expect(booked.locator(".import-duplicate-match")).toContainText(/78,00\s+GBP/);
});

test("recorded currency survives review, ledger, allocations and pending tracking", async ({
  appShell, csvImport, ledger, reviewQueue, window,
}) => {
  await appShell.openWorkspace("Import");
  await csvImport.submitImport(writeCsvStatement());
  await expect(csvImport.successStatus).toBeVisible();
  await appShell.openWorkspace("Transactions");
  await expect.soft(reviewQueue.reviewItem("FOREIGN BOOKED")).toContainText(/78,00\s+GBP/);
  await expect.soft(ledger.transaction("FOREIGN BOOKED").getByRole("cell").nth(2)).toHaveText(/78,00\s+GBP/);
  await expect(ledger.transaction("LOCAL BOOKED").getByRole("cell").nth(2)).toHaveText(/42,00\s+kr/);
  await ledger.transaction("FOREIGN BOOKED").getByRole("button", { name: /Edit category allocations/ }).click();
  const allocation = window.getByRole("region", { name: "Transaction category allocations for FOREIGN BOOKED" });
  await expect.soft(allocation.locator(".transaction-allocation-summary")).toContainText(/78,00\s+GBP/);
  await allocation.getByRole("button", { name: "Cancel allocation editing" }).click();
  await reviewQueue.categorySelect("FOREIGN BOOKED").selectOption("groceries");
  await reviewQueue.saveButton("FOREIGN BOOKED").click();
  await expect(reviewQueue.savedStatus).toContainText("Category saved.");
  await expect(ledger.transaction("FOREIGN BOOKED").getByRole("cell").nth(2)).toHaveText(/78,00\s+GBP/);
  await appShell.openWorkspace("Pending");
  await expect(appShell.workspace("Pending").getByRole("listitem").filter({ hasText: "FOREIGN PENDING" }))
    .toContainText(/12,50\s+GBP/);
});

for (const width of [1440, 390]) {
  test(`populated category correction stays readable and operable at ${width}px`, async ({
    appShell, csvImport, electronApp, reviewQueue, window,
  }, testInfo) => {
    await electronApp.evaluate(({ BrowserWindow }, width) => {
      const browser = BrowserWindow.getAllWindows()[0];
      if (browser === undefined) throw new Error("Electron window is unavailable.");
      browser.setContentSize(width, 1000);
    }, width);
    await expect.poll(() => window.evaluate(() => globalThis.innerWidth)).toBe(width);
    await appShell.openWorkspace("Import");
    await csvImport.submitImport(writeCsvStatement());
    await expect(csvImport.successStatus).toBeVisible();
    await appShell.openWorkspace("Transactions");
    const item = reviewQueue.reviewItem("FOREIGN BOOKED");
    const action = item.locator(".review-queue-action");
    const explanation = action.locator("p");
    const select = reviewQueue.categorySelect("FOREIGN BOOKED");
    const button = reviewQueue.saveButton("FOREIGN BOOKED");
    await expect(select).toHaveAccessibleDescription(/future transactions matching this merchant/);
    const bounds = await action.boundingBox();
    const copyBounds = await explanation.boundingBox();
    const selectBounds = await select.boundingBox();
    const buttonBounds = await button.boundingBox();
    if (bounds === null || copyBounds === null || selectBounds === null || buttonBounds === null) {
      throw new Error("Category correction controls must be visible.");
    }
    if (width === 390) {
      expect(selectBounds.y).toBeGreaterThanOrEqual(copyBounds.y + copyBounds.height);
      expect(buttonBounds.y).toBeGreaterThanOrEqual(selectBounds.y + selectBounds.height);
      expect(copyBounds.width).toBeGreaterThanOrEqual(bounds.width - 2);
      expect(selectBounds.width).toBeGreaterThanOrEqual(bounds.width - 2);
      expect(buttonBounds.width).toBeGreaterThanOrEqual(bounds.width - 2);
    }
    for (const control of [selectBounds, buttonBounds]) {
      expect(control.height).toBeGreaterThanOrEqual(44);
      expect(control.x + control.width).toBeLessThanOrEqual(width);
    }
    await item.scrollIntoViewIfNeeded();
    await window.screenshot({ path: testInfo.outputPath(`category-review-${width}.png`) });
    await select.selectOption("groceries");
    await button.focus();
    await window.keyboard.press("Enter");
    await expect(reviewQueue.savedStatus).toContainText("Category saved.");
    await expect(reviewQueue.categorySelect("LOCAL BOOKED")).toBeFocused();
  });
}
