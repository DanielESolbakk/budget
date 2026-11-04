import { dirname, join } from "node:path";
import { test, expect } from "./fixtures/electron.js";

test.use({ importFileDialogBehavior: "csv-selected" });

test("monthly NOK subtotals refresh after recording a local dated rate", async ({
  appShell, csvImport, dashboard, electronApp, window,
}) => {
  await appShell.openWorkspace("Import");
  await electronApp.evaluate(({ BrowserWindow }, width) => {
    BrowserWindow.getAllWindows()[0]!.setContentSize(width, 960);
  }, 390);
  await expect.poll(() => window.evaluate(() => globalThis.innerWidth)).toBe(390);
  await csvImport.chooseFileButton.click();
  await csvImport.importButton.click();
  await expect(csvImport.previewRegion).toBeVisible();
  await csvImport.confirmImportButton.click();
  await expect(csvImport.successStatus).toBeVisible();
  await appShell.openWorkspace("Review");
  await dashboard.monthSelector.selectOption("2026-05");
  await expect(dashboard.expenseValue).toContainText("2 764,80");
  const currencyWarning = dashboard.monthlyTotalsSection
    .getByRole("status")
    .filter({ hasText: "Incomplete NOK subtotal." });
  await expect(currencyWarning).toContainText(/Incomplete.*GBP/);
  await expect(dashboard.monthlyTotalsSection.getByLabel("Native currency subtotals"))
    .toContainText(/78,00\s+GBP/);
  await expect(window.getByRole("region", { name: "Forecast", exact: true }))
    .toContainText(/incomplete NOK history/i);

  await appShell.openWorkspace("Settings");
  await window.getByRole("combobox", { name: "Rate currency", exact: true }).selectOption("GBP");
  await window.getByLabel("Rate NOK per 1 unit").fill("12.5");
  await window.getByLabel("Rate effective date").fill("2026-05-01");
  await window.getByLabel("Rate source", { exact: true }).fill("Synthetic local rate");
  await window.getByRole("button", { name: "Save local exchange rate", exact: true }).click();
  await expect(window.getByRole("status").filter({ hasText: "Local exchange rate saved." })).toBeVisible();
  await appShell.openWorkspace("Review");
  await expect(dashboard.expenseValue).toContainText("3 739,80");
  await expect(currencyWarning).toHaveCount(0);
  await expect(window.getByRole("region", { name: "Forecast", exact: true }))
    .not.toContainText(/incomplete NOK history/i);
});

test("a missing snapshot reports a recoverable file error", async ({
  recovery,
  electronApp,
  window,
  databasePath,
}) => {
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.setContentSize(390, 960);
  });
  await expect.poll(() => window.evaluate(() => globalThis.innerWidth)).toBe(390);
  await recovery.restorePathInput.fill(join(dirname(databasePath), "missing-snapshot.json"));
  await recovery.reviewSnapshotButton.click();
  const alert = recovery.restoreSection.getByRole("alert");
  await expect(alert).toContainText(/snapshot not found/i);
  await expect(alert).toContainText(/choose.*review/i);
  await expect(recovery.restoreButton).toBeDisabled();
  const diagnostics = alert.getByText("Technical details", { exact: true });
  await expect(diagnostics).toBeVisible();
  await diagnostics.click();
  await expect(alert).toContainText("ENOENT");
});

test("forecast states its net measure, history cutoff and independence from the review month", async ({
  appShell, dashboard, window,
}) => {
  await appShell.openWorkspace("Review");
  await dashboard.monthSelector.selectOption("2026-04");
  const forecast = window.getByRole("region", { name: "Forecast", exact: true });
  await expect(forecast).toContainText(/monthly net/i);
  await expect(forecast).toContainText(/through 2026-05/i);
  await expect(forecast).toContainText(/does not follow the review month/i);
});
