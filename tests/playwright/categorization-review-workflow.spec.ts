import { _electron as electron } from "@playwright/test";
import { test, expect } from "./fixtures/electron.js";
import { DatabaseSync } from "node:sqlite";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { buildBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { AppShellPage } from "./pom/AppShellPage.js";
import { CsvImportPage } from "./pom/CsvImportPage.js";
import { RecoveryPage } from "./pom/RecoveryPage.js";
import { ReviewQueuePage } from "./pom/ReviewQueuePage.js";

const CSV_FIXTURE_PATH = resolve(process.cwd(), "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv");
const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");
const temporaryDirectories = new Set<string>();

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "budget-playwright-categorization-"));
  temporaryDirectories.add(directory);
  return directory;
}

test.afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.clear();
});

function writeFutureMerchantFixture(date = "31.05.2026", fileName = "merchant-rule-follow-up.csv"): string {
  const directory = createTemporaryDirectory();
  const filePath = join(directory, fileName);
  writeFileSync(
    filePath,
    `Utført dato;Bokført dato;Beskrivelse;Beløp inn;Beløp ut;Valuta\n${date};;MERCHANT-005;;-12.00;NOK\n`,
    "utf8"
  );
  return filePath;
}

function writeReviewQueueFixture(): string {
  const directory = createTemporaryDirectory();
  const filePath = join(directory, "review-queue.csv");
  writeFileSync(
    filePath,
    "Utført dato;Bokført dato;Beskrivelse;Beløp inn;Beløp ut;Valuta\n30.05.2026;;MERCHANT-005;;-12.00;NOK\n31.05.2026;;MERCHANT-006;;-13.00;NOK\n",
    "utf8"
  );
  return filePath;
}

function writeOutOfOrderReviewQueueFixture(): string {
  const directory = createTemporaryDirectory();
  const filePath = join(directory, "out-of-order-review-queue.csv");
  writeFileSync(
    filePath,
    "Utført dato;Bokført dato;Beskrivelse;Beløp inn;Beløp ut;Valuta\n30.05.2026;;MERCHANT-005;;-12.00;NOK\n29.05.2026;;MERCHANT-000;;-11.00;NOK\n31.05.2026;;MERCHANT-006;;-13.00;NOK\n",
    "utf8"
  );
  return filePath;
}

function readCategoryForMerchant(databasePath: string, bookedAtIso: string): string | undefined {
  const database = new DatabaseSync(databasePath);
  try {
    const row = database.prepare(
      "SELECT category_id FROM transactions WHERE merchant_raw = ? AND booked_at_iso = ?"
    ).get("MERCHANT-005", bookedAtIso) as { category_id: string | null } | undefined;
    return row?.category_id ?? undefined;
  } finally {
    database.close();
  }
}

test.describe("Categorization review workflow", () => {
  test("tracks queue progress, future matching, and focus after a correction", async ({
    appShell,
    csvImport,
    ledger,
    reviewQueue,
  }) => {
    await appShell.openWorkspace("Import");
    await csvImport.submitImport(writeReviewQueueFixture());
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });

    await appShell.openWorkspace("Transactions");
    await expect(reviewQueue.progressStatus).toHaveText("0 reviewed this session; 2 remaining to review");
    await expect(ledger.reviewUncategorizedButton).toHaveText("Review uncategorized (2)");
    await ledger.reviewUncategorizedButton.click();
    await expect(reviewQueue.firstCategorySelect).toBeFocused();
    await reviewQueue.categorySelect("MERCHANT-005").selectOption("groceries");
    await reviewQueue.saveButton("MERCHANT-005").click();

    await expect(reviewQueue.progressStatus).toHaveText("1 reviewed this session; 1 remaining to review");
    await expect(ledger.reviewUncategorizedButton).toHaveText("Review uncategorized (1)");
    await expect(reviewQueue.firstCategorySelect).toBeFocused();
    await expect(reviewQueue.savedStatus).toHaveText(
      "Category saved. Future matching for this merchant will use Groceries & food."
    );
  });

  test("opens the review queue at the oldest booking regardless of import order", async ({
    appShell,
    csvImport,
    ledger,
    reviewQueue,
  }) => {
    await appShell.openWorkspace("Import");
    await csvImport.submitImport(writeOutOfOrderReviewQueueFixture());
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });

    await appShell.openWorkspace("Transactions");
    await expect(reviewQueue.progressStatus).toHaveText("0 reviewed this session; 3 remaining to review");
    await ledger.reviewUncategorizedButton.click();

    await expect(reviewQueue.firstCategorySelect).toHaveAttribute(
      "aria-label",
      "Category for MERCHANT-000"
    );
    await expect(reviewQueue.firstCategorySelect).toBeFocused();
  });

  test("waits for a fresh queue count before exposing the review action", async ({
    appShell,
    csvImport,
    electronApp,
    ledger,
    reviewQueue,
  }) => {
    await appShell.openWorkspace("Import");
    await csvImport.submitImport(writeReviewQueueFixture());
    await expect(csvImport.successStatus).toHaveText("Added 2 transactions to your ledger.");
    await expect(csvImport.importSection.getByText("0 duplicate rows skipped.", { exact: true })).toBeVisible();

    await appShell.openWorkspace("Transactions");
    await expect(reviewQueue.progressStatus).toHaveText("0 reviewed this session; 2 remaining to review");
    await expect(ledger.reviewUncategorizedButton).toHaveText("Review uncategorized (2)");

    await electronApp.evaluate(() => {
      process.env["BUDGET_TEST_REVIEW_LIST_DELAY_MS"] = "800";
    });
    await appShell.openWorkspace("Import");
    await csvImport.submitImport(writeFutureMerchantFixture("29.05.2026", "queue-count-refresh.csv"));
    await expect(csvImport.successStatus).toHaveText("Added 1 transaction to your ledger.");
    await expect(csvImport.importSection.getByText("0 duplicate rows skipped.", { exact: true })).toBeVisible();

    await appShell.openWorkspace("Transactions");
    const updatingStatus = reviewQueue.section.getByRole("status").filter({
      hasText: "Updating categorization queue...",
    });
    await expect(updatingStatus).toBeVisible();
    await expect(ledger.reviewUncategorizedButton).toHaveCount(0);
    await expect(reviewQueue.progressStatus).not.toBeVisible();

    await expect(reviewQueue.progressStatus).toHaveText("0 reviewed this session; 3 remaining to review");
    await expect(ledger.reviewUncategorizedButton).toHaveText("Review uncategorized (3)");
  });

  test("clarifies that the review count is independent of ledger filters", async ({
    appShell,
    csvImport,
    ledger,
    reviewQueue,
  }) => {
    await appShell.openWorkspace("Import");
    await csvImport.submitImport(writeReviewQueueFixture());
    await expect(csvImport.successStatus).toHaveText("Added 2 transactions to your ledger.");
    await expect(csvImport.importSection.getByText("0 duplicate rows skipped.", { exact: true })).toBeVisible();

    await appShell.openWorkspace("Transactions");
    await expect(reviewQueue.progressStatus).toHaveText("0 reviewed this session; 2 remaining to review");
    await ledger.merchantInput.fill("no ledger matches");
    await expect(ledger.resultStatus).toHaveText("0 ledger transactions");
    await expect(ledger.reviewUncategorizedButton).toHaveText("Review uncategorized (2)");
    await expect(ledger.reviewUncategorizedScope).toBeVisible();
  });

  test("keeps the review action in view on a compact Transactions workspace", async ({
    appShell,
    csvImport,
    electronApp,
    ledger,
    reviewQueue,
  }) => {
    await appShell.openWorkspace("Import");
    await csvImport.submitImport(writeReviewQueueFixture());
    await expect(csvImport.successStatus).toHaveText("Added 2 transactions to your ledger.");
    await expect(csvImport.importSection.getByText("0 duplicate rows skipped.", { exact: true })).toBeVisible();

    await appShell.openWorkspace("Transactions");
    await expect(reviewQueue.progressStatus).toHaveText("0 reviewed this session; 2 remaining to review");
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 1100);
    });
    await expect(ledger.reviewUncategorizedButton).toHaveText("Review uncategorized (2)");

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
    });

    await expect(ledger.reviewUncategorizedButton).toHaveText("Review uncategorized (2)");
    await expect(ledger.reviewUncategorizedButton).toBeInViewport();
  });

  test("@visual Visual: review action preserves desktop and compact layouts", async ({
    appShell,
    csvImport,
    electronApp,
    ledger,
    reviewQueue,
    window,
  }) => {
    await appShell.openWorkspace("Import");
    await csvImport.submitImport(writeReviewQueueFixture());
    await expect(csvImport.successStatus).toHaveText("Added 2 transactions to your ledger.");
    await expect(csvImport.importSection.getByText("0 duplicate rows skipped.", { exact: true })).toBeVisible();

    await appShell.openWorkspace("Transactions");
    await expect(reviewQueue.progressStatus).toHaveText("0 reviewed this session; 2 remaining to review");
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 1100);
    });
    await expect(ledger.reviewUncategorizedButton).toHaveText("Review uncategorized (2)");
    await expect(window).toHaveScreenshot("review-action-desktop.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    });

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setContentSize(390, 844);
    });
    await expect(ledger.reviewUncategorizedButton).toBeInViewport();
    await expect(window).toHaveScreenshot("review-action-compact.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.015,
    });
  });

  test("distinguishes queue loading, empty, and retryable error states", async ({
    appShell,
    electronApp,
    reviewQueue,
    window,
  }) => {
    await electronApp.evaluate(() => {
      process.env["BUDGET_TEST_REVIEW_LIST_DELAY_MS"] = "800";
    });
    await window.reload();
    await appShell.openWorkspace("Transactions");

    await expect(reviewQueue.loadingStatus).toBeVisible();
    await expect(reviewQueue.emptyState).not.toBeVisible();
    await expect(reviewQueue.emptyState).toBeVisible();

    await electronApp.evaluate(() => {
      delete process.env["BUDGET_TEST_REVIEW_LIST_DELAY_MS"];
      process.env["BUDGET_TEST_REVIEW_LIST_FAILURE"] = "1";
    });
    await window.reload();
    await appShell.openWorkspace("Transactions");

    await expect(reviewQueue.errorAlert).toContainText("Synthetic review list failure.");
    await expect(reviewQueue.emptyState).not.toBeVisible();

    await electronApp.evaluate(() => {
      delete process.env["BUDGET_TEST_REVIEW_LIST_FAILURE"];
    });
    await reviewQueue.retryButton.click();
    await expect(reviewQueue.emptyState).toBeVisible();
  });

  test("known merchants are categorized and unknown imports can be corrected from the review queue", async ({
    appShell,
    csvImport,
    reviewQueue,
    dashboard,
    electronApp,
    databasePath,
  }) => {
    await appShell.openWorkspace("Import");
    await csvImport.submitImport(CSV_FIXTURE_PATH);
    await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });

    await appShell.openWorkspace("Review");
    await expect(dashboard.monthlyAttention).toContainText("Uncategorized transactions need a category this month.");
    await dashboard.reviewQueueAction.click();

    await appShell.openWorkspace("Transactions");
    await expect(reviewQueue.section).toBeVisible();
    await expect(reviewQueue.reviewItem("MERCHANT-005")).toBeVisible();
    await expect(reviewQueue.reviewItem("SALARY")).not.toBeVisible();

    await reviewQueue.categorySelect("MERCHANT-005").selectOption("groceries");
    await reviewQueue.saveButton("MERCHANT-005").click();

    await expect(reviewQueue.reviewItem("MERCHANT-005")).not.toBeVisible();
    await appShell.openWorkspace("Review");
    await expect(dashboard.categoryBreakdownSection).toContainText("groceries");

    await electronApp.close();

    let restartedApp = await electron.launch({
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
      const restartedShell = new AppShellPage(restartedWindow);
      const restartedCsvImport = new CsvImportPage(restartedWindow);
      const restartedReviewQueue = new ReviewQueuePage(restartedWindow);

      await restartedShell.openWorkspace("Transactions");
      await expect(restartedReviewQueue.reviewItem("MERCHANT-005")).not.toBeVisible();
      await restartedShell.openWorkspace("Import");
      await restartedShell.selectImportFormat("CSV statement");
      await restartedCsvImport.submitImport(writeFutureMerchantFixture());
      await expect(restartedCsvImport.successStatus).toBeVisible({ timeout: 10_000 });
      await restartedShell.openWorkspace("Transactions");
      await expect(restartedReviewQueue.reviewItem("MERCHANT-005")).not.toBeVisible();

      const restoredSnapshotPath = join(dirname(databasePath), "restored-rules.json");
      const restoredSnapshot = buildBackupSnapshot({
        household: {
          id: "sample-hh",
          name: "Sample Household",
          createdAtIso: "2026-01-01T00:00:00Z",
        },
        accounts: [
          { id: "sample-acc", householdId: "sample-hh", name: "Brukskonto", currencyCode: "NOK" },
        ],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
        merchantCategoryRules: [{ merchantAlias: "MERCHANT-005", categoryId: "transport" }],
        createdAtIso: "2026-09-24T00:00:00Z",
      });
      writeFileSync(restoredSnapshotPath, JSON.stringify(restoredSnapshot), "utf8");

      const recovery = new RecoveryPage(restartedWindow);
        await restartedShell.openWorkspace("Data safety");
      await recovery.restorePathInput.fill(restoredSnapshotPath);
      restartedWindow.once("dialog", async (dialog) => await dialog.accept());
      await recovery.restoreButton.click();
      await expect(recovery.restoreSuccess).toContainText("0 transactions restored");

      await restartedApp.close();
      restartedApp = await electron.launch({
        args: [MAIN_ENTRY],
        env: {
          ...process.env,
          NODE_ENV: "test",
          BUDGET_DB_PATH: databasePath,
        },
      });
      const restoredWindow = await restartedApp.firstWindow();
      await restoredWindow.waitForLoadState("domcontentloaded");
      const restoredShell = new AppShellPage(restoredWindow);
      const restoredCsvImport = new CsvImportPage(restoredWindow);
      const restoredReviewQueue = new ReviewQueuePage(restoredWindow);
      await restoredShell.openWorkspace("Import");
      await restoredShell.selectImportFormat("CSV statement");
      await restoredCsvImport.submitImport(writeFutureMerchantFixture("01.06.2026", "merchant-after-rule-restore.csv"));
      await expect(restoredCsvImport.successStatus).toBeVisible({ timeout: 10_000 });
      await restoredShell.openWorkspace("Transactions");
      await expect(restoredReviewQueue.reviewItem("MERCHANT-005")).not.toBeVisible();
      expect(readCategoryForMerchant(databasePath, "2026-06-01T00:00:00Z")).toBe("transport");
    } finally {
      await restartedApp.close();
    }
  });
});