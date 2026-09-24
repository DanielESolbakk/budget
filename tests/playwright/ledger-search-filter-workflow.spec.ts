import { test, expect } from "./fixtures/electron.js";

test.describe("Ledger search and filter workflow", () => {
  test("filters transactions by merchant and category", async ({ ledger }) => {
    await expect(ledger.section).toBeVisible();
    await expect(ledger.transaction("Kiwi")).toBeVisible();

    await ledger.merchantInput.fill("Kiwi");
    await ledger.apply();
    await expect(ledger.transaction("Kiwi")).toBeVisible();
    await expect(ledger.transactionsFor("Lønn AS")).toHaveCount(0);

    await ledger.merchantInput.fill("");
    await ledger.categoryInput.fill("salary");
    await ledger.apply();
    await expect(ledger.transaction("Lønn AS")).toBeVisible();
    await expect(ledger.transactionsFor("Kiwi")).toHaveCount(0);
  });

  test("filters transactions by account, date range, and amount", async ({ ledger }) => {
    await ledger.accountInput.fill("sample-acc");
    await ledger.fromDateInput.fill("2026-05-01");
    await ledger.toDateInput.fill("2026-05-31");
    await ledger.amountInput.fill("-8500");
    await ledger.apply();

    await expect(ledger.transaction("Rema 1000")).toBeVisible();
    await expect(ledger.transactionsFor("Lønn AS")).toHaveCount(0);

    await ledger.accountInput.fill("missing-account");
    await ledger.apply();
    await expect(ledger.resultStatus).toHaveText("0 ledger transactions");
  });
});