import { test, expect } from "./fixtures/electron.js";

const DEFAULT_YEAR_MONTH = "2026-05";
const GROCERIES_ACTUAL_MINOR = 8500;
const GROCERIES_BASELINE_TARGET_MINOR = 9000;
const GROCERIES_UPDATED_TARGET_MINOR = 9500;
const SALARY_ACTUAL_MINOR = 54000;
const nokCurrencyFormatter = new Intl.NumberFormat("nb-NO", {
  style: "currency",
  currency: "NOK",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMinor(minor: number): string {
  return nokCurrencyFormatter.format(minor / 100);
}

test.describe("Dashboard target-vs-actual renderer smoke", () => {
  test("renders target-vs-actual section with visible target, actual, and delta values", async ({ dashboardTarget: targetPage }) => {
    await expect(targetPage.section).toBeVisible();
    await expect(targetPage.heading).toBeVisible();
    await expect(targetPage.table).toBeVisible();
    await expect(targetPage.targetColumn).toBeVisible();
    await expect(targetPage.actualColumn).toBeVisible();
    await expect(targetPage.deltaColumn).toBeVisible();

    await expect(targetPage.categoryCell("groceries")).toBeVisible();
    await expect(targetPage.targetCell("groceries")).toHaveText(formatMinor(GROCERIES_BASELINE_TARGET_MINOR));
    await expect(targetPage.actualCell("groceries")).toHaveText(formatMinor(GROCERIES_ACTUAL_MINOR));
    await expect(targetPage.deltaCell("groceries")).toHaveText(
      formatMinor(GROCERIES_ACTUAL_MINOR - GROCERIES_BASELINE_TARGET_MINOR)
    );
  });

  test("shows the explicit no-target policy for categories without configured targets", async ({ dashboardTarget: targetPage }) => {
    await expect(targetPage.categoryRow("salary")).toBeVisible();
    await expect(targetPage.actualCell("salary")).toHaveText(formatMinor(SALARY_ACTUAL_MINOR));
    await expect(targetPage.targetCell("salary")).toHaveText("No target");
    await expect(targetPage.deltaCell("salary")).toHaveText("No target");
    await expect(targetPage.noTargetIndicators("salary")).toHaveCount(2);
  });
});

test.describe("Dashboard target-vs-actual renderer smoke — refresh path", () => {
  test("reflects the latest saved target values after a refresh", async ({ window, dashboardTarget: targetPage, categoryTarget }) => {
    await expect(targetPage.section).toBeVisible();
    await expect(targetPage.targetCell("groceries")).toHaveText(formatMinor(GROCERIES_BASELINE_TARGET_MINOR));
    await expect(targetPage.deltaCell("groceries")).toHaveText(
      formatMinor(GROCERIES_ACTUAL_MINOR - GROCERIES_BASELINE_TARGET_MINOR)
    );

    await categoryTarget.categoryIdInput.fill("groceries");
    await categoryTarget.targetAmountInput.fill("95");
    await categoryTarget.saveButton.click();
    await expect(categoryTarget.savedConfirmation).toContainText("Target saved.");
    await window.reload();
    await window.waitForLoadState("domcontentloaded");

    await expect(targetPage.targetCell("groceries")).toHaveText(formatMinor(GROCERIES_UPDATED_TARGET_MINOR));
    await expect(targetPage.actualCell("groceries")).toHaveText(formatMinor(GROCERIES_ACTUAL_MINOR));
    await expect(targetPage.deltaCell("groceries")).toHaveText(
      formatMinor(GROCERIES_ACTUAL_MINOR - GROCERIES_UPDATED_TARGET_MINOR)
    );
    await expect(window.getByRole("combobox", { name: "Select month" })).toHaveValue(DEFAULT_YEAR_MONTH);
  });
});
