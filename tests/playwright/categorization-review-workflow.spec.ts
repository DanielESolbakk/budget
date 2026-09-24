import { _electron as electron } from "@playwright/test";
import { test, expect } from "./fixtures/electron.js";
import { join, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { CsvImportPage } from "./pom/CsvImportPage.js";
import { ReviewQueuePage } from "./pom/ReviewQueuePage.js";

const CSV_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv");
const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");

function writeFutureMerchantFixture(): string {
  const directory = join(tmpdir(), "budget-playwright-categorization");
  mkdirSync(directory, { recursive: true });
  const filePath = join(directory, "merchant-rule-follow-up.csv");
  writeFileSync(
    filePath,
    "Utført dato;Bokført dato;Beskrivelse;Beløp inn;Beløp ut;Valuta\n31.05.2026;;MERCHANT-005;;-12.00;NOK\n",
    "utf8"
  );
  return filePath;
}

test.describe("Categorization review workflow", () => {
  test("known merchants are categorized and unknown imports can be corrected from the review queue", async ({
    csvImport,
    reviewQueue,
    dashboard,
    electronApp,
    databasePath,
  }) => {
    await csvImport.submitImport(CSV_FIXTURE_PATH);
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });

    await expect(reviewQueue.section).toBeVisible();
    await expect(reviewQueue.reviewItem("MERCHANT-005")).toBeVisible();
    await expect(reviewQueue.reviewItem("SALARY")).not.toBeVisible();

    await reviewQueue.categorySelect("MERCHANT-005").selectOption("groceries");
    await reviewQueue.saveButton("MERCHANT-005").click();

    await expect(reviewQueue.reviewItem("MERCHANT-005")).not.toBeVisible();
    await expect(dashboard.categoryBreakdownSection).toContainText("groceries");

    await electronApp.close();

    const restartedApp = await electron.launch({
      args: [MAIN_ENTRY],
      env: {
        ...process.env,
        NODE_ENV: "test",
        BUDGET_DB_PATH: databasePath,
      },
    });

    try {
      const restartedWindow = await restartedApp.firstWindow();
      await restartedWindow.waitForLoadState("domcontentloaded");
      const restartedCsvImport = new CsvImportPage(restartedWindow);
      const restartedReviewQueue = new ReviewQueuePage(restartedWindow);

      await expect(restartedReviewQueue.reviewItem("MERCHANT-005")).not.toBeVisible();
      await restartedCsvImport.submitImport(writeFutureMerchantFixture());
      await expect(restartedCsvImport.successStatus).toBeVisible({ timeout: 10_000 });
      await expect(restartedReviewQueue.reviewItem("MERCHANT-005")).not.toBeVisible();
    } finally {
      await restartedApp.close();
    }
  });
});