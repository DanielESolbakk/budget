import { test, expect } from "./fixtures/electron.js";
import { resolve } from "node:path";

const CSV_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv");

test.describe("Mobile import preview workflow", () => {
  test("@mobile CSV preview stays readable at 390px", async ({ csvImport, electronApp, window }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
    });

    await csvImport.filePathInput.fill(CSV_FIXTURE_PATH);
    await csvImport.importButton.click();
    await expect(csvImport.previewRegion).toBeVisible();

    const previewTable = csvImport.previewRegion.getByRole("table", {
      name: "Transactions ready from this CSV preview",
    });
    await expect(previewTable).toBeVisible();

    const tableWidth = await previewTable.evaluate((table) => table.getBoundingClientRect().width);
    const viewportWidth = await window.evaluate(() => document.documentElement.clientWidth);
    expect(tableWidth).toBeLessThanOrEqual(viewportWidth - 32);
  });
});
