import { test, expect } from "./fixtures/electron.js";
import { resolve } from "node:path";

const CSV_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv");
const PDF_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-binary.pdf");

test.describe("Mobile import preview workflow", () => {
  test("keeps the shared statement action and manual entry usable at 390px", async ({ appShell, electronApp, window }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
    });
    await appShell.openWorkspace("Import");

    const statementChoice = window.getByRole("button", { name: "Choose statement file", exact: true });
    const manualChoice = window.getByRole("button", { name: "Enter transaction manually", exact: true });
    const statementBounds = await statementChoice.boundingBox();
    const manualBounds = await manualChoice.boundingBox();

    expect(statementBounds?.width ?? 0).toBeGreaterThan(300);
    expect(manualBounds?.width ?? 0).toBeGreaterThan(180);
    const dimensions = await window.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
  });

  test("@mobile CSV preview stays readable at 390px", async ({ csvImport, electronApp, window }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
    });

    await csvImport.enterFilePath(CSV_FIXTURE_PATH);
    await csvImport.importButton.click();
    await expect(csvImport.previewRegion).toBeVisible();

    const previewTable = csvImport.previewRegion.getByRole("table", {
      name: "CSV statement preview rows and validation states",
    });
    await expect(previewTable).toBeVisible();

    const tableWidth = await previewTable.evaluate((table) => table.getBoundingClientRect().width);
    const viewportWidth = await window.evaluate(() => document.documentElement.clientWidth);
    expect(tableWidth).toBeLessThanOrEqual(viewportWidth - 32);
  });

  test("@mobile PDF preview keeps its caption and selected file readable at 390px", async ({ pdfImport, electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
    });

    await pdfImport.enterFilePath(PDF_FIXTURE_PATH);
    await pdfImport.importButton.click();
    await expect(pdfImport.previewRegion).toBeVisible();

    const caption = pdfImport.previewRegion.getByRole("table", {
      name: "PDF statement preview rows and duplicate decisions",
    }).locator("caption");
    const captionWidth = await caption.evaluate((element) => element.getBoundingClientRect().width);
    const chooseFileBounds = await pdfImport.chooseFileButton.boundingBox();
    const selectedFileBounds = await pdfImport.importSection.locator(".import-selected-file").boundingBox();

    expect(captionWidth).toBeGreaterThan(240);
    expect((selectedFileBounds?.y ?? Number.POSITIVE_INFINITY) + (selectedFileBounds?.height ?? 0))
      .toBeLessThanOrEqual(chooseFileBounds?.y ?? 0);
  });
});
