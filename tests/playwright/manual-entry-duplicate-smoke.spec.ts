import { test, expect } from "./fixtures/electron.js";
import type { ManualEntryValues } from "./pom/ManualEntryPage.js";

const manualEntry: ManualEntryValues = {
  accountId: "sample-acc",
  bookedAtIso: "2026-05-23",
  amountMinor: "-1250",
  merchantRaw: "Manual Playwright Entry",
  categoryId: "groceries",
};

test.describe("Manual entry and duplicate detection", () => {
  test("Scenario 1: valid entry displays its fields and refreshes dashboard totals", async ({ manualEntry: entry, dashboard }) => {
    await expect(entry.entrySection).toBeVisible();
    await expect(entry.entryHeading).toBeVisible();
    await expect(entry.accountInput).toHaveValue("sample-acc");
    await expect(entry.bookedDateInput).toHaveValue("2026-05-23");
    await expect(entry.submitButton).toBeVisible();

    const beforeExpenses = await dashboard.expenseValue.textContent();
    await entry.submitEntry(manualEntry);

    await expect(entry.successStatus).toContainText("Transaction added");
    await expect(entry.successStatus).toContainText("Manual Playwright Entry");
    await expect(entry.successStatus).toContainText("account sample-acc");
    await expect(entry.successStatus).toContainText("date 2026-05-23");
    await expect(entry.successStatus).toContainText("amount -1250 minor units");
    await expect(entry.successStatus).toContainText("category groceries");
    await expect
      .poll(async () => (await dashboard.expenseValue.textContent()) ?? "", { timeout: 10_000 })
      .not.toBe(beforeExpenses);
  });

  test("Scenario 2: equivalent entry shows a duplicate warning and keeps totals unchanged", async ({ manualEntry: entry, dashboard }) => {
    await expect(dashboard.monthlyTotalsSection).toBeVisible();

    await entry.submitEntry(manualEntry);
    await expect(entry.successStatus).toContainText("Transaction added");
    const afterFirstEntryExpenses = await dashboard.expenseValue.textContent();

    await entry.submitEntry(manualEntry);
    await expect(entry.resultAlert).toContainText("Duplicate transaction detected");
    await expect(entry.resultAlert).toContainText("Matching ledger row:");
    await expect(entry.resultAlert).toContainText("Fingerprint:");
    await expect(dashboard.expenseValue).toHaveText(afterFirstEntryExpenses ?? "");
  });

  test("Scenario 3: malformed optional category data is rejected by the IPC boundary", async ({ window }) => {
    const response = await window.evaluate(async () =>
      globalThis.budgetApi.import.addManualTransaction({
        householdId: "sample-hh",
        accountId: "sample-acc",
        bookedAtIso: "2026-05-23",
        amountMinor: -1250,
        merchantRaw: "Malformed category probe",
        categoryId: 123 as unknown as string,
      })
    );

    expect(response).toMatchObject({
      ok: false,
      reason: "validation",
      code: "INVALID_CATEGORY_ID",
    });
  });
});
