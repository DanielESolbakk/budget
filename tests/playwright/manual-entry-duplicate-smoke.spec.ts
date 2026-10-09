import { test, expect } from "./fixtures/electron.js";
import type { Page } from "@playwright/test";
import type { ManualEntryValues } from "./pom/ManualEntryPage.js";

async function rendererLocalDate(page: Page): Promise<string> {
  return page.evaluate(() => {
    const today = new Date();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    return `${today.getFullYear()}-${month}-${day}`;
  });
}

const manualEntry: ManualEntryValues = {
  accountId: "sample-acc",
  bookedAtIso: "2026-05-23",
  amountMinor: "-1250",
  merchantRaw: "Manual Playwright Entry",
  categoryId: "groceries",
};

test.describe("Manual entry and duplicate detection", () => {
  test("manual entry defaults to the current local date", async ({ manualEntry: entry, window }) => {
    await expect(entry.bookedDateInput).toHaveValue(await rendererLocalDate(window));
  });

  test("reduced motion keeps transaction confirmation visible without button transitions", async ({ window, manualEntry: entry }) => {
    await window.emulateMedia({ reducedMotion: "reduce" });
    await entry.submitEntry(manualEntry);

    await expect(entry.successStatus).toHaveText("Added Manual Playwright Entry to your ledger.");
    await expect(entry.successStatus).toBeVisible();
    const transitionDuration = await entry.submitButton.evaluate((button) =>
      getComputedStyle(button).transitionDuration
    );
    expect(transitionDuration.split(",").every((duration) => duration.trim() === "0s")).toBe(true);
  });

  test("Scenario 1: valid entry displays its fields and refreshes dashboard totals", async ({ appShell, manualEntry: entry, dashboard, window }) => {
    await expect(entry.entrySection).toBeVisible();
    await expect(entry.entryHeading).toBeVisible();
    await expect(entry.accountInput).toHaveValue("sample-acc");
    await expect(entry.bookedDateInput).toHaveValue(await rendererLocalDate(window));
    await expect(entry.submitButton).toBeVisible();

    await appShell.openWorkspace("Review");
    await dashboard.monthSelector.selectOption("2026-05");
    const beforeExpenses = await dashboard.expenseValue.textContent();
    await appShell.openWorkspace("Import");
    await entry.submitEntry(manualEntry);

    await expect(entry.successStatus).toHaveText("Added Manual Playwright Entry to your ledger.");
    await appShell.openWorkspace("Review");
    await expect
      .poll(async () => (await dashboard.expenseValue.textContent()) ?? "", { timeout: 10_000 })
      .not.toBe(beforeExpenses);
  });

  test("Scenario 2: equivalent entry shows a duplicate warning and keeps totals unchanged", async ({ appShell, manualEntry: entry, dashboard }) => {
    await appShell.openWorkspace("Review");
    await dashboard.monthSelector.selectOption("2026-05");
    await expect(dashboard.monthlyTotalsSection).toBeVisible();

    await appShell.openWorkspace("Import");
    await entry.submitEntry(manualEntry);
    await expect(entry.successStatus).toContainText("Added Manual Playwright Entry to your ledger.");
    await appShell.openWorkspace("Review");
    const afterFirstEntryExpenses = await dashboard.expenseValue.textContent();

    await appShell.openWorkspace("Import");
    await entry.submitEntry(manualEntry);
    await expect(entry.resultAlert).toContainText("This transaction is already in your ledger.");
    await expect(entry.resultAlert).toContainText("Check the Ledger section");
    await appShell.openWorkspace("Review");
    await expect(dashboard.expenseValue).toHaveText(afterFirstEntryExpenses ?? "");
  });

  test("Scenario 3: malformed optional category data is rejected by the IPC boundary", async ({ window: page }) => {
    const response = await page.evaluate(async () =>
      window.budgetApi.import.addManualTransaction({
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

  test("Scenario 4: malformed required fields return field-specific IPC errors", async ({ window: page }) => {
    const responses = await page.evaluate(async () => {
      const base = {
        householdId: "sample-hh",
        accountId: "sample-acc",
        bookedAtIso: "2026-05-23",
        amountMinor: -1250,
        merchantRaw: "Malformed field probe",
      };

      return Promise.all([
        window.budgetApi.import.addManualTransaction({ ...base, accountId: 123 as unknown as string }),
        window.budgetApi.import.addManualTransaction({ ...base, bookedAtIso: 123 as unknown as string }),
        window.budgetApi.import.addManualTransaction({ ...base, amountMinor: "-1250" as unknown as number }),
        window.budgetApi.import.addManualTransaction({ ...base, merchantRaw: 123 as unknown as string }),
      ]);
    });

    expect(responses.map((response) => {
      if (response.ok) return "ok";
      return response.reason === "validation" ? response.code : response.reason;
    })).toEqual([
      "INVALID_ACCOUNT_ID",
      "INVALID_BOOKED_AT_ISO",
      "INVALID_AMOUNT_MINOR_INTEGER",
      "INVALID_MERCHANT_RAW",
    ]);
  });
});
