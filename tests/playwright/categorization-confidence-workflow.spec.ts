import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { ReviewQueuePage } from "./pom/ReviewQueuePage.js";
import { test, expect } from "./fixtures/electron.js";

test("unmatched import persists confidence and is available for local review", async ({
  appShell,
  csvImport,
  databasePath,
  window,
}) => {
  const reviewQueue = new ReviewQueuePage(window);
  const merchant = "UNKNOWN LOCAL MERCHANT";
  const csvPath = join(dirname(databasePath), "confidence-review.csv");
  writeFileSync(
    csvPath,
    `Utført dato;Bokført dato;Beskrivelse;Beløp inn;Beløp ut;Valuta\n28.05.2026;;${merchant};;-5.00;NOK\n`,
    "utf8"
  );

  await csvImport.submitImport(csvPath);
  await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });
  await appShell.openWorkspace("Transactions");
  await expect(reviewQueue.reviewItem(merchant)).toBeVisible();
  await expect(reviewQueue.confidenceLabel(merchant)).toHaveText("Confidence: 0% · No matching rule");

  const database = new DatabaseSync(databasePath);
  try {
    const row = database.prepare(
      "SELECT categorization_json FROM transactions WHERE merchant_raw = ?"
    ).get(merchant) as { categorization_json: string } | undefined;
    expect(row).toBeDefined();
    expect(JSON.parse(row!.categorization_json)).toMatchObject({
      status: "unmatched",
      confidence: 0,
      requiresReview: true,
    });
  } finally {
    database.close();
  }

  await reviewQueue.categorySelect(merchant).selectOption("groceries");
  await reviewQueue.saveButton(merchant).click();
  await window.reload();
  await appShell.openWorkspace("Transactions");
  await expect(reviewQueue.reviewItem(merchant)).not.toBeVisible();

  const reopenedDatabase = new DatabaseSync(databasePath);
  try {
    const corrected = reopenedDatabase.prepare(
      "SELECT category_id, categorization_json FROM transactions WHERE merchant_raw = ?"
    ).get(merchant) as { category_id: string; categorization_json: string } | undefined;
    expect(corrected?.category_id).toBe("groceries");
    expect(JSON.parse(corrected!.categorization_json)).toMatchObject({
      status: "categorized",
      confidenceLevel: "high",
      requiresReview: false,
    });
  } finally {
    reopenedDatabase.close();
  }
});

test("ambiguous decisions show the proposed and competing categories in local review", async ({
  appShell,
  databasePath,
  reviewQueue,
  window,
}) => {
  const merchant = "FJORD KAFE";
  const database = new DatabaseSync(databasePath);

  try {
    const account = database.prepare(
      "SELECT household_id, account_id FROM transactions LIMIT 1"
    ).get() as { household_id: string; account_id: string } | undefined;
    expect(account).toBeDefined();
    if (account === undefined) throw new Error("Expected the test ledger to have a transaction.");

    database.prepare(`
      INSERT INTO transactions (
        id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
        merchant_search, source_type, category_id, categorization_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "tx-ambiguous-review",
      account.household_id,
      account.account_id,
      "2026-05-28T00:00:00Z",
      -1250,
      merchant,
      merchant,
      "csv",
      "groceries",
      JSON.stringify({
        status: "ambiguous",
        categoryId: "groceries",
        confidence: 0.35,
        confidenceLevel: "low",
        requiresReview: true,
        selectedRule: {
          ruleId: "rule-groceries",
          merchantAlias: merchant,
          categoryId: "groceries",
          priority: 10,
        },
        matchingRules: [
          {
            ruleId: "rule-groceries",
            merchantAlias: merchant,
            categoryId: "groceries",
            priority: 10,
          },
          {
            ruleId: "rule-transport",
            merchantAlias: merchant,
            categoryId: "transport",
            priority: 10,
          },
        ],
      })
    );
  } finally {
    database.close();
  }

  await window.reload();
  await appShell.openWorkspace("Transactions");

  await expect(reviewQueue.confidenceLabel(merchant)).toHaveText("Confidence: 35% · Conflicting rules");
  await expect(reviewQueue.proposedCategoryLabel(merchant)).toHaveText("Proposed category: Groceries & food");
  await expect(reviewQueue.matchingRulesLabel(merchant)).toHaveText(
    "Matching rules: rule-groceries (Groceries & food), rule-transport (Transport)"
  );
});
