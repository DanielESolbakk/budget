import { join } from "node:path";
import { tmpdir } from "node:os";
import { test, expect } from "./fixtures/electron.js";

test.use({ importFileDialogBehavior: "csv-selected" });

for (const width of [1440, 390]) {
test(`monthly NOK subtotals refresh after recording a local dated rate at ${width}px`, async ({
  appShell, csvImport, dashboard, electronApp, window,
}) => {
  await appShell.openWorkspace("Import");
  await electronApp.evaluate(({ BrowserWindow }, width) => {
    BrowserWindow.getAllWindows()[0]!.setContentSize(width, 960);
  }, width);
  await expect.poll(() => window.evaluate(() => globalThis.innerWidth)).toBe(width);
  await csvImport.chooseFileButton.click();
  await csvImport.importButton.click();
  await expect(csvImport.previewRegion).toBeVisible();
  await csvImport.confirmImportButton.click();
  await expect(csvImport.successStatus).toBeVisible();
  await appShell.openWorkspace("Review");
  await dashboard.monthSelector.selectOption("2026-05");
  await expect(dashboard.expenseValue).toContainText("2 764,80");
  await expect(dashboard.monthlyTotalsSection.getByRole("status")).toContainText(/Incomplete.*GBP/);
  await expect(dashboard.monthlyTotalsSection.getByLabel("Native currency subtotals"))
    .toContainText(/78,00\s+GBP/);
  await expect(window.getByRole("region", { name: "Forecast", exact: true }))
    .toContainText(/incomplete NOK history/i);
  await dashboard.monthlyTotalsSection.screenshot({ path: test.info().outputPath(`monthly-incomplete-${width}.png`) });

  await appShell.openWorkspace("Settings");
  await window.getByRole("combobox", { name: "Rate currency", exact: true }).selectOption("GBP");
  await window.getByLabel("Rate NOK per 1 unit").fill("12.5");
  await window.getByLabel("Rate effective date").fill("2026-05-01");
  await window.getByLabel("Rate source", { exact: true }).fill("Synthetic local rate");
  await window.getByRole("button", { name: "Save local exchange rate", exact: true }).click();
  await expect(window.getByRole("status").filter({ hasText: "Local exchange rate saved." })).toBeVisible();
  await appShell.openWorkspace("Review");
  await expect(dashboard.expenseValue).toContainText("3 739,80");
  await expect(dashboard.monthlyTotalsSection.getByRole("status")).toHaveCount(0);
  await expect(window.getByRole("region", { name: "Forecast", exact: true }))
    .not.toContainText(/incomplete NOK history/i);
  await dashboard.monthlyTotalsSection.screenshot({ path: test.info().outputPath(`monthly-complete-${width}.png`) });
  await window.getByRole("region", { name: "Forecast", exact: true })
    .screenshot({ path: test.info().outputPath(`forecast-${width}.png`) });
});
}

for (const width of [1440, 390]) {
  test(`populated category review leaves ledger search immediately reachable at ${width}px`, async ({
    appShell, csvImport, ledger, electronApp, window,
  }) => {
    await appShell.openWorkspace("Import");
    await csvImport.chooseFileButton.click();
    await csvImport.importButton.click();
    await csvImport.confirmImportButton.click();
    await expect(csvImport.successStatus).toBeVisible();
    await electronApp.evaluate(({ BrowserWindow }, width) => {
      BrowserWindow.getAllWindows()[0]!.setContentSize(width, 960);
    }, width);
    await expect.poll(() => window.evaluate(() => globalThis.innerWidth)).toBe(width);
    await appShell.openWorkspace("Transactions");
    const workspace = window.getByRole("region", { name: "Transactions workspace", exact: true });
    const heading = workspace.getByRole("heading", { name: "Transactions", exact: true });
    const positions = await heading.evaluate((element) => {
      const region = element.closest("section")!;
      const input = region.querySelector<HTMLInputElement>("#ledger-merchant") ??
        Array.from(region.querySelectorAll<HTMLInputElement>("input"))
          .find((candidate) => candidate.type === "text");
      if (input === undefined || input === null) throw new Error("Ledger search is missing.");
      return { heading: element.getBoundingClientRect().top, search: input.getBoundingClientRect().top };
    });
    expect(positions.search - positions.heading).toBeLessThan(700);
    await expect(ledger.merchantInput).toBeInViewport();
    await window.screenshot({ path: test.info().outputPath(`transactions-${width}.png`) });
    await workspace.getByRole("button", { name: /^Review category decisions \(/ }).click();
    await expect(workspace.getByRole("region", { name: "Categorization Review" }).getByRole("combobox").first())
      .toBeFocused();
    const queue = workspace.getByRole("region", { name: "Categorization Review" });
    const queueBounds = await queue.getByRole("list").first().evaluate((element) => ({
      height: element.clientHeight,
      contentHeight: element.scrollHeight,
      viewportHeight: globalThis.innerHeight,
    }));
    expect(queueBounds.height).toBeLessThan(queueBounds.viewportHeight * 0.75);
    expect(queueBounds.contentHeight).toBeGreaterThan(queueBounds.height);
    await queue.screenshot({ path: test.info().outputPath(`review-queue-${width}.png`) });
    await ledger.merchantInput.fill("Rema");
    await expect(ledger.resultStatus).toContainText(/ledger transaction/);
  });

  test(`CSV evidence precedes confirmation and automatic mapping stays optional at ${width}px`, async ({
    appShell, csvImport, electronApp, window,
  }) => {
    await appShell.openWorkspace("Import");
    await electronApp.evaluate(({ BrowserWindow }, width) => {
      BrowserWindow.getAllWindows()[0]!.setContentSize(width, 960);
    }, width);
    await expect.poll(() => window.evaluate(() => globalThis.innerWidth)).toBe(width);
    await csvImport.chooseFileButton.click();
    await csvImport.importButton.click();
    await expect(csvImport.previewRegion).toBeVisible();
    const mapping = csvImport.previewRegion.locator("details").filter({ hasText: "Match your CSV columns" }).first();
    await expect(mapping).not.toHaveAttribute("open");
    const evidenceBeforeConfirmation = await csvImport.previewRegion.evaluate((region) => {
      const evidence = region.querySelector("table");
      const confirm = document.getElementById("csv-confirm-button");
      return evidence !== null && confirm !== null &&
        Boolean(evidence.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(evidenceBeforeConfirmation).toBe(true);
    await csvImport.previewRegion.screenshot({ path: test.info().outputPath(`csv-preview-${width}.png`) });
    await csvImport.confirmImportButton.click();
    await expect(csvImport.successStatus).toBeVisible();
  });

  test(`missing snapshot has a readable recovery action without exposing transport errors at ${width}px`, async ({
    recovery, electronApp, window,
  }) => {
    await expect(recovery.restoreSection).toBeVisible();
    await electronApp.evaluate(({ BrowserWindow }, width) => {
      BrowserWindow.getAllWindows()[0]!.setContentSize(width, 960);
    }, width);
    await expect.poll(() => window.evaluate(() => globalThis.innerWidth)).toBe(width);
    await recovery.restorePathInput.fill(join(tmpdir(), "synthetic-missing-snapshot-with-a-long-name-for-layout-checking.json"));
    await recovery.reviewSnapshotButton.click();
    const alert = recovery.restoreSection.getByRole("alert");
    await expect(alert).toContainText(/snapshot not found/i);
    await expect(alert).toContainText(/choose.*review/i);
    await expect(recovery.restoreButton).toBeDisabled();
    const diagnostics = alert.getByText("Technical details", { exact: true });
    await expect(diagnostics).toBeVisible();
    await diagnostics.click();
    await expect(alert).toContainText("ENOENT");
    const fits = await alert.evaluate((element) => element.scrollWidth <= element.clientWidth);
    expect(fits).toBe(true);
    await alert.screenshot({ path: test.info().outputPath(`restore-error-${width}.png`) });
  });
}

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

test("digital statement evidence precedes its explicit import confirmation", async ({ pdfImport }) => {
  await pdfImport.enterFilePath(join(process.cwd(), "tests", "fixtures", "synthetic", "rogaland-2026-05-binary.pdf"));
  await pdfImport.importButton.click();
  await expect(pdfImport.previewRegion).toBeVisible();
  const evidenceBeforeConfirmation = await pdfImport.previewRegion.evaluate((region) => {
    const evidence = region.querySelector("table");
    const confirm = document.getElementById("pdf-confirm-button");
    return evidence !== null && confirm !== null &&
      Boolean(evidence.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(evidenceBeforeConfirmation).toBe(true);
  await pdfImport.confirmImportButton.click();
  await expect(pdfImport.successStatus).toBeVisible();
});
