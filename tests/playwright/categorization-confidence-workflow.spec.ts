import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { test, expect } from "./fixtures/electron.js";

test("unmatched import persists confidence and is available for local review", async ({
  csvImport,
  reviewQueue,
  databasePath,
  window,
}) => {
  const merchant = "UNKNOWN LOCAL MERCHANT";
  const csvPath = join(dirname(databasePath), "confidence-review.csv");
  writeFileSync(
    csvPath,
    `Utført dato;Bokført dato;Beskrivelse;Beløp inn;Beløp ut;Valuta\n28.05.2026;;${merchant};;-5.00;NOK\n`,
    "utf8"
  );

  await csvImport.submitImport(csvPath);
  await expect(csvImport.successStatus).toBeVisible({ timeout: 10_000 });
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
