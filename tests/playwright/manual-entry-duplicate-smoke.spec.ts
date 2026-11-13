import { test, expect } from "./fixtures/electron.js";
import type { ManualEntryValues } from "./pom/ManualEntryPage.js";
import { LedgerPage } from "./pom/LedgerPage.js";
import { DatabaseSync } from "node:sqlite";

const manualEntry: ManualEntryValues = {
  accountId: "sample-acc",
  bookedAtIso: "2026-05-23",
  amountNok: "-12,50",
  merchantRaw: "Manual Playwright Entry",
  categoryId: "groceries",
};

test.describe("Manual entry and duplicate detection", () => {
  test("manual entry is a distinct transaction task and keeps input when returning from statements", async ({
    manualEntry: entry, window, appShell,
  }) => {
    const workspace = appShell.workspace("Import");
    await expect(workspace.getByRole("heading", { name: "Add a transaction", exact: true })).toBeVisible();
    await expect(workspace.getByRole("heading", { name: "Add a transaction", exact: true })).toBeFocused();
    await expect(workspace.getByRole("group", { name: "Import sections" })).toBeHidden();
    await entry.merchantInput.fill("Synthetic task separation");
    await workspace.getByRole("button", { name: "Back to statement imports" }).click();
    await expect(workspace.getByRole("button", { name: "Choose statement file", exact: true })).toBeVisible();
    await appShell.selectImportFormat("Manual transaction");
    await expect(entry.merchantInput).toHaveValue("Synthetic task separation");
    await expect(window.getByRole("form", { name: "Manual transaction entry form" })).toBeVisible();
  });

  test("merchant validation clears only when its field is corrected and allows resubmission", async ({
    manualEntry: entry,
  }) => {
    await entry.submitEntry({ ...manualEntry, merchantRaw: "   " });
    await expect(entry.resultAlert).toContainText("Enter a description or merchant");
    await expect(entry.merchantInput).toHaveAttribute("aria-invalid", "true");
    await entry.amountInput.fill("-13,50");
    await expect(entry.resultAlert).toBeVisible();
    await entry.merchantInput.fill("Corrected synthetic merchant");
    await expect(entry.resultAlert).toBeHidden();
    await expect(entry.merchantInput).not.toHaveAttribute("aria-invalid", "true");
    await entry.submitButton.click();
    await expect(entry.successStatus).toContainText("Corrected synthetic merchant");
  });

  test("a local save failure keeps input and offers safe ledger-first recovery", async ({
    manualEntry: entry, databasePath, appShell, window,
  }) => {
    const database = new DatabaseSync(databasePath);
    try {
      database.exec("BEGIN IMMEDIATE");
      await entry.submitEntry({ ...manualEntry, merchantRaw: "Synthetic locked database entry" });
      await expect(entry.resultAlert).toContainText("Check the ledger before trying again");
      await expect(entry.merchantInput).toHaveValue("Synthetic locked database entry");
      await expect(entry.amountInput).toHaveValue("-12,50");
      await expect(entry.resultAlert.getByRole("button", { name: "Open ledger" })).toBeVisible();
      database.exec("ROLLBACK");
      await entry.resultAlert.getByRole("button", { name: "Open ledger" }).click();
      await expect(new LedgerPage(window).transaction("Synthetic locked database entry")).toHaveCount(0);
      await appShell.openWorkspace("Import");
      await expect(entry.merchantInput).toHaveValue("Synthetic locked database entry");
      await entry.submitButton.click();
      await expect(entry.successStatus).toContainText("Synthetic locked database entry");
    } finally {
      database.close();
    }
  });

  test("malformed NOK input stays associated with the amount until corrected", async ({ manualEntry: entry }) => {
    await entry.submitEntry({ ...manualEntry, amountNok: "12,345" });
    await expect(entry.amountInput).toHaveAttribute("aria-invalid", "true");
    await expect(entry.resultAlert).toContainText("up to two decimals");
    await entry.merchantInput.fill("Synthetic corrected amount");
    await expect(entry.resultAlert).toBeVisible();
    await entry.amountInput.fill("-12,34");
    await expect(entry.resultAlert).toBeHidden();
    await expect(entry.amountInput).not.toHaveAttribute("aria-invalid", "true");
    await entry.submitButton.click();
    await expect(entry.successStatus).toContainText("Synthetic corrected amount");
  });

  test("manual entry accepts a signed NOK decimal and stores the corresponding minor units", async ({
    appShell,
    manualEntry: entry,
    window,
  }) => {
    const amountInput = entry.entrySection.getByLabel("Amount (NOK)");
    await expect(amountInput).toBeVisible();
    await entry.accountInput.selectOption("sample-acc");
    await entry.bookedDateInput.fill("2026-05-23");
    await amountInput.fill("-12,50");
    await entry.merchantInput.fill("NOK decimal entry");
    await entry.categoryInput.selectOption("groceries");
    await entry.submitButton.click();

    await expect(entry.successStatus).toHaveText("Added NOK decimal entry to your ledger.");
    await appShell.openWorkspace("Transactions");
    const row = new LedgerPage(window).transaction("NOK decimal entry");
    await expect(row).toContainText("12,50");
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
    await expect(entry.submitButton).toBeVisible();

    await appShell.openWorkspace("Review");
    await dashboard.selectMonth("2026-05");
    await expect(dashboard.expenseValue).toContainText("85,00");
    await appShell.openWorkspace("Import");
    await entry.submitEntry(manualEntry);

    await expect(entry.successStatus).toHaveText("Added Manual Playwright Entry to your ledger.");
    await appShell.openWorkspace("Review");
    await expect(dashboard.expenseValue).toContainText("97,50", { timeout: 10_000 });
    await appShell.openWorkspace("Transactions");
    const row = new LedgerPage(window).transaction(manualEntry.merchantRaw);
    await expect(row).toContainText("23. mai 2026");
    await expect(row).toContainText("12,50");
    await expect(row).toContainText("Groceries");
    await expect(row).toContainText("Brukskonto");
  });

  test("Scenario 2: equivalent entry shows a duplicate warning and keeps totals unchanged", async ({ appShell, manualEntry: entry, dashboard, window }) => {
    await appShell.openWorkspace("Review");
    await dashboard.selectMonth("2026-05");
    await expect(dashboard.monthlyTotalsSection).toBeVisible();

    await appShell.openWorkspace("Import");
    await entry.submitEntry(manualEntry);
    await expect(entry.successStatus).toContainText("Added Manual Playwright Entry to your ledger.");
    await appShell.openWorkspace("Review");
    await expect(dashboard.expenseValue).toContainText("97,50");

    await appShell.openWorkspace("Import");
    await entry.submitEntry(manualEntry);
    await expect(entry.resultAlert).toContainText("This transaction is already in your ledger.");
    await expect(entry.resultAlert).toContainText("Check the Ledger section");
    await appShell.openWorkspace("Review");
    await expect(dashboard.expenseValue).toContainText("97,50");
    await appShell.openWorkspace("Transactions");
    await expect(new LedgerPage(window).transaction(manualEntry.merchantRaw)).toHaveCount(1);
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
