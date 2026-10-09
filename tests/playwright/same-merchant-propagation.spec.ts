import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test as electronTest, expect } from "./fixtures/electron.js";

const sameMerchantCsv = [
  "Utført dato;Bokført dato;Beskrivelse;Beløp inn;Beløp ut;Valuta",
  "30.05.2026;;PROPAGATION TEST SHOP AS;;-12.00;NOK",
  "31.05.2026;;Propagation Test Shop;;-13.00;USD",
  "01.06.2026;;PROPAGATION TEST SHOP ASA;;-14.00;NOK",
  "02.06.2026;;Stavanger Taxi;;-15.00;NOK",
].join("\n");

const test = electronTest.extend<{ sameMerchantCsvPath: string }>({
  sameMerchantCsvPath: async ({ databasePath }, use) => {
    const path = join(dirname(databasePath), "same-merchant-propagation.csv");
    writeFileSync(path, sameMerchantCsv, "utf8");
    await use(path);
  },
});

test("shows categorization review before the ledger on compact Transactions", async ({
  appShell,
  ledger,
  reviewQueue,
  window,
}) => {
  await appShell.openWorkspace("Transactions");
  await window.setViewportSize({ width: 390, height: 844 });
  await expect(reviewQueue.section).toBeVisible();
  await expect(ledger.section).toBeVisible();

  const reviewTop = await reviewQueue.section.evaluate((element) => element.getBoundingClientRect().top);
  const ledgerTop = await ledger.section.evaluate((element) => element.getBoundingClientRect().top);
  expect(reviewTop).toBeLessThan(ledgerTop);
});

test("previews, selectively applies, and undoes same-merchant correction propagation", async ({
  appShell,
  csvImport,
  reviewQueue,
  sameMerchantCsvPath,
}) => {
  await appShell.openWorkspace("Import");
  await appShell.selectImportFormat("CSV statement");
  await csvImport.submitImport(sameMerchantCsvPath);
  await expect(csvImport.successStatus).toHaveText("Added 4 transactions to your ledger.");

  await appShell.openWorkspace("Transactions");
  await expect(reviewQueue.progressStatus).toHaveText("0 reviewed this session; 4 remaining to review");
  await expect(reviewQueue.saveButton("PROPAGATION TEST SHOP AS")).toBeDisabled();
  const confidenceFontSize = await reviewQueue.confidenceLabel("PROPAGATION TEST SHOP AS")
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(confidenceFontSize).toBeGreaterThanOrEqual(12);
  await reviewQueue.categorySelect("PROPAGATION TEST SHOP AS").selectOption("groceries");
  await reviewQueue.saveButton("PROPAGATION TEST SHOP AS").click();

  await expect(reviewQueue.savedStatus).toHaveText(
    "Category saved. Future matching for this merchant will use Groceries & food."
  );
  await expect(reviewQueue.propagationPreviewButton).toHaveText("Preview 2 matching transactions");
  await expect(reviewQueue.reviewItem("Stavanger Taxi")).toBeVisible();

  await reviewQueue.propagationPreviewButton.click();
  await expect(reviewQueue.propagationPreviewDialog).toBeVisible();
  await expect(reviewQueue.propagationCandidateRows).toHaveCount(2);
  await expect(
    reviewQueue.propagationPreviewDialog.getByRole("checkbox", {
      name: "Select transaction: Propagation Test Shop, 2026-05-31",
    })
  ).toBeVisible();
  const firstCandidate = reviewQueue.propagationCandidate("Propagation Test Shop", "2026-05-31");
  await expect(firstCandidate).toContainText("Brukskonto");
  await expect(firstCandidate).toContainText("13,00");
  await expect(firstCandidate).toContainText("USD");
  await expect(firstCandidate).toContainText("Groceries & food");
  await reviewQueue.cancelPropagationPreviewButton.click();
  await expect(reviewQueue.propagationPreviewDialog).not.toBeVisible();
  await expect(reviewQueue.reviewItem("Propagation Test Shop")).toBeVisible();
  await expect(reviewQueue.reviewItem("PROPAGATION TEST SHOP ASA")).toBeVisible();

  await reviewQueue.propagationPreviewButton.click();
  await reviewQueue.propagationCandidateCheckbox("Propagation Test Shop", "2026-05-31").check();
  await reviewQueue.continuePropagationButton.click();
  await expect(reviewQueue.propagationConfirmationDialog).toContainText(
    "Apply Groceries & food to 1 selected transaction?"
  );
  await expect(reviewQueue.propagationConfirmationDialog).toContainText("Propagation Test Shop");
  await expect(reviewQueue.propagationConfirmationDialog).toContainText("2026-05-31");
  await expect(reviewQueue.propagationConfirmationDialog).toContainText("Brukskonto");
  await expect(reviewQueue.propagationConfirmationDialog).toContainText("13,00");
  await expect(reviewQueue.propagationConfirmationDialog).toContainText("USD");
  await expect(reviewQueue.propagationConfirmationDialog).not.toContainText("PROPAGATION TEST SHOP ASA");
  await reviewQueue.confirmPropagationButton.click();

  await expect(reviewQueue.propagationResult).toHaveText(
    "Applied Groceries & food to 1 transaction."
  );
  await expect(reviewQueue.undoPropagationButton).toBeVisible();
  await expect(reviewQueue.reviewItem("Propagation Test Shop")).not.toBeVisible();
  await expect(reviewQueue.reviewItem("PROPAGATION TEST SHOP ASA")).toBeVisible();
  await expect(reviewQueue.reviewItem("PROPAGATION TEST SHOP AS")).not.toBeVisible();

  await reviewQueue.undoPropagationButton.click();
  await expect(reviewQueue.undoPropagationButton).not.toBeVisible();
  await expect(reviewQueue.reviewItem("Propagation Test Shop")).toBeVisible();
  await expect(reviewQueue.reviewItem("PROPAGATION TEST SHOP AS")).not.toBeVisible();

  const followUpPath = join(dirname(sameMerchantCsvPath), "same-merchant-after-undo.csv");
  writeFileSync(
    followUpPath,
    `${sameMerchantCsv.split("\n")[0]}\n03.06.2026;;PROPAGATION TEST SHOP AS;;-16.00;NOK`,
    "utf8"
  );
  await appShell.openWorkspace("Import");
  await csvImport.submitImport(followUpPath);
  await expect(csvImport.successStatus).toHaveText("Added 1 transaction to your ledger.");
  await appShell.openWorkspace("Transactions");
  await expect(reviewQueue.reviewItem("PROPAGATION TEST SHOP AS")).not.toBeVisible();

  await reviewQueue.categorySelect("Stavanger Taxi").selectOption("transport");
  await reviewQueue.saveButton("Stavanger Taxi").click();
  await expect(reviewQueue.savedStatus).toContainText("Category saved.");
  await expect(reviewQueue.propagationPreviewButton).not.toBeVisible();
});

test("keeps propagation errors and the selected transaction in confirmation", async ({
  appShell,
  csvImport,
  databasePath,
  reviewQueue,
  sameMerchantCsvPath,
}) => {
  await appShell.openWorkspace("Import");
  await appShell.selectImportFormat("CSV statement");
  await csvImport.submitImport(sameMerchantCsvPath);
  await appShell.openWorkspace("Transactions");
  await reviewQueue.categorySelect("PROPAGATION TEST SHOP AS").selectOption("groceries");
  await reviewQueue.saveButton("PROPAGATION TEST SHOP AS").click();
  await reviewQueue.propagationPreviewButton.click();
  await reviewQueue.propagationCandidateCheckbox("Propagation Test Shop", "2026-05-31").check();
  await reviewQueue.continuePropagationButton.click();

  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      CREATE TRIGGER fail_same_merchant_propagation
      BEFORE INSERT ON same_merchant_propagation_changes
      BEGIN
        SELECT RAISE(ABORT, 'Injected propagation write failure.');
      END;
    `);
  } finally {
    database.close();
  }

  await reviewQueue.confirmPropagationButton.click();

  await expect(reviewQueue.propagationConfirmationDialog.getByRole("alert"))
    .toContainText("Injected propagation write failure.");
  await expect(reviewQueue.propagationConfirmationDialog).toContainText("Propagation Test Shop");
  await expect(reviewQueue.propagationConfirmationDialog).toContainText("2026-05-31");
  await expect(reviewQueue.confirmPropagationButton).toBeVisible();
  await expect(reviewQueue.reviewItem("Propagation Test Shop")).toBeVisible();
});