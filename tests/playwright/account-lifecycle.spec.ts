import { DatabaseSync } from "node:sqlite";
import { AppShellPage } from "./pom/AppShellPage.js";
import { ManualEntryPage } from "./pom/ManualEntryPage.js";
import { OnboardingPage } from "./pom/OnboardingPage.js";
import {
  installMainProcessNetworkProbe,
  mainProcessNetworkRequests,
} from "./helpers/networkProbe.js";
import { test, expect } from "./fixtures/electron.js";

test.describe("account creation", () => {
  test.use({ databaseSeed: "empty" });

  test("adds an account after first-run setup and makes it available for transactions", async ({
    databasePath,
    electronApp,
    window,
  }) => {
    const onboarding = new OnboardingPage(window);
    await expect(onboarding.heading).toBeVisible();
    await onboarding.submit("Test Household", "Checking", "NOK");
    await expect(onboarding.heading).toBeHidden();

    const database = new DatabaseSync(databasePath);
    let existingTransaction: Record<string, unknown>;
    try {
      const account = database.prepare("SELECT id, household_id FROM accounts")
        .get() as { id: string; household_id: string } | undefined;
      if (account === undefined) throw new Error("First-run setup did not persist its account.");
      database.prepare(`
        INSERT INTO transactions (
          id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
          merchant_search, currency_code, source_type, source_reference, category_id,
          import_job_id, categorization_json, category_allocations_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "tx-account-lifecycle",
        account.household_id,
        account.id,
        "2026-05-12T00:00:00Z",
        -12_500,
        "Synthetic grocery",
        "SYNTHETIC GROCERY",
        "NOK",
        "manual",
        "synthetic-entry",
        null,
        null,
        null,
        null
      );
      existingTransaction = database.prepare(`
        SELECT id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
          merchant_search, currency_code, source_type, source_reference, category_id,
          import_job_id, categorization_json, category_allocations_json
        FROM transactions WHERE id = ?
      `).get("tx-account-lifecycle") as Record<string, unknown>;
    } finally {
      database.close();
    }

    await installMainProcessNetworkProbe(electronApp);
    const appShell = new AppShellPage(window);
    await appShell.openWorkspace("Accounts");
    await electronApp.evaluate(({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      if (browserWindow === undefined) throw new Error("Electron window is unavailable.");
      browserWindow.setContentSize(1280, 800);
    });
    await expect.poll(() => window.evaluate(() => (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ))).toBeLessThanOrEqual(0);
    await electronApp.evaluate(({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      if (browserWindow === undefined) throw new Error("Electron window is unavailable.");
      browserWindow.setContentSize(390, 844);
    });
    await expect.poll(() => window.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    )).toBeLessThanOrEqual(0);
    await expect(window.getByRole("heading", { name: "Household accounts" })).toBeVisible();

    await window.getByLabel("Account name", { exact: true }).fill(" ");
    await window.getByRole("button", { name: "Add account" }).click();
    await expect(window.getByLabel("Account name", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(window.getByLabel("Account name", { exact: true })).toBeFocused();
    await expect(window.getByRole("alert")).toContainText("Enter an account name.");

    await window.getByLabel("Account name", { exact: true }).fill("Savings");
    await window.getByLabel("Currency code", { exact: true }).fill("N!");
    await window.getByRole("button", { name: "Add account" }).click();
    await expect(window.getByLabel("Currency code", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(window.getByLabel("Currency code", { exact: true })).toBeFocused();
    await expect(window.getByLabel("Currency code", { exact: true }))
      .toHaveAccessibleDescription("Enter a three-letter currency code, such as NOK.");
    await expect(window.getByRole("list", { name: "Household accounts" }).getByRole("listitem"))
      .toHaveCount(1);

    await window.getByLabel("Currency code", { exact: true }).fill("SEK");
    await window.getByRole("button", { name: "Add account" }).click();
    await expect(window.getByRole("status", { name: "Account management status" }))
      .toContainText("Savings account added.");
    await expect(window.getByLabel("Coverage account")).toContainText("Savings (SEK)");
    await expect.poll(() => window.evaluate(() => (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ))).toBeLessThanOrEqual(0);

    const verifiedDatabase = new DatabaseSync(databasePath);
    try {
      const persistedTransaction = verifiedDatabase.prepare(`
        SELECT id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
          merchant_search, currency_code, source_type, source_reference, category_id,
          import_job_id, categorization_json, category_allocations_json
        FROM transactions WHERE id = ?
      `).get("tx-account-lifecycle");
      expect(persistedTransaction).toEqual(existingTransaction);
    } finally {
      verifiedDatabase.close();
    }

    await window.reload();
    await expect(appShell.heading).toBeVisible();
    await appShell.openWorkspace("Accounts");
    await expect(window.getByRole("list", { name: "Household accounts" }))
      .toContainText("Savings");
    await appShell.openWorkspace("Import");
    await appShell.selectImportFormat("Manual transaction");
    await expect(new ManualEntryPage(window).accountInput).toContainText("Savings");
    expect(await mainProcessNetworkRequests(electronApp)).toEqual([]);
  });
});

test.describe("account editing", () => {
  test.use({ databaseSeed: "empty" });

  test("preserves drafts on save failure and renames an account with history", async ({
    databasePath,
    electronApp,
    window,
  }) => {
    const onboarding = new OnboardingPage(window);
    await expect(onboarding.heading).toBeVisible();
    await onboarding.submit("Test Household", "Checking", "NOK");

    const database = new DatabaseSync(databasePath);
    let accountId: string;
    try {
      const account = database.prepare("SELECT id, household_id FROM accounts")
        .get() as { id: string; household_id: string } | undefined;
      if (account === undefined) throw new Error("First-run setup did not persist its account.");
      accountId = account.id;
      database.prepare(`
        INSERT INTO transactions (
          id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
          merchant_search, currency_code, source_type, source_reference, category_id,
          import_job_id, categorization_json, category_allocations_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "tx-account-edit",
        account.household_id,
        account.id,
        "2026-05-12T00:00:00Z",
        -12_500,
        "Synthetic grocery",
        "SYNTHETIC GROCERY",
        "NOK",
        "manual",
        "synthetic-entry",
        null,
        null,
        null,
        null
      );
      database.prepare(`
        INSERT INTO account_statement_coverage_periods (
          id, account_id, start_date_iso, end_date_iso, currency_code, source_name,
          source_type, confirmed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "period-account-edit",
        account.id,
        "2026-05-01",
        "2026-05-31",
        "NOK",
        "synthetic-may-statement",
        "manual",
        1
      );
      database.prepare(`
        INSERT INTO account_balance_checkpoints (
          id, account_id, date_iso, currency_code, balance_minor, source, recorded_at_iso
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        "checkpoint-account-edit",
        account.id,
        "2026-05-31",
        "NOK",
        87_500,
        "synthetic statement",
        "2026-06-01T00:00:00Z"
      );
      database.exec(`
        CREATE TRIGGER reject_account_update
        BEFORE UPDATE OF name ON accounts
        BEGIN SELECT RAISE(ABORT, 'synthetic account update failure'); END;
      `);
    } finally {
      database.close();
    }

    await installMainProcessNetworkProbe(electronApp);
    const appShell = new AppShellPage(window);
    await appShell.openWorkspace("Accounts");
    await electronApp.evaluate(({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      if (browserWindow === undefined) throw new Error("Electron window is unavailable.");
      browserWindow.setContentSize(1280, 800);
    });
    await expect.poll(() => window.evaluate(() => (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ))).toBeLessThanOrEqual(0);

    await window.getByRole("button", { name: "Edit account Checking" }).click();
    const editForm = window.getByRole("form", { name: "Edit account Checking" });
    await expect(editForm.getByLabel("Currency code")).toBeDisabled();
    await expect(editForm.getByText(/Currency cannot be changed.*Create another account instead\./))
      .toBeVisible();
    await editForm.getByLabel("Account name").fill("Discarded draft");
    await editForm.getByRole("button", { name: "Cancel edit" }).click();
    await expect(window.getByRole("list", { name: "Household accounts" }))
      .toContainText("Checking");
    await expect(window.getByRole("list", { name: "Household accounts" }))
      .not.toContainText("Discarded draft");

    await window.getByRole("button", { name: "Edit account Checking" }).click();
    const retryForm = window.getByRole("form", { name: "Edit account Checking" });
    await retryForm.getByLabel("Account name").fill("Primary");
    await retryForm.getByRole("button", { name: "Save account changes" }).click();
    await expect(window.getByRole("alert"))
      .toContainText("synthetic account update failure");
    await expect(retryForm.getByLabel("Account name")).toHaveValue("Primary");

    const unblockDatabase = new DatabaseSync(databasePath);
    try {
      unblockDatabase.exec("DROP TRIGGER reject_account_update");
    } finally {
      unblockDatabase.close();
    }
    await retryForm.getByRole("button", { name: "Save account changes" }).click();
    await expect(window.getByRole("status", { name: "Account management status" }))
      .toContainText("Account updated.");
    await expect(window.getByRole("list", { name: "Household accounts" }))
      .toContainText("Primary");
    await expect(window.getByLabel("Coverage account")).toContainText("Primary (NOK)");

    const persistedDatabase = new DatabaseSync(databasePath);
    try {
      expect(persistedDatabase.prepare(
        "SELECT name, currency_code FROM accounts WHERE id = ?"
      ).get(accountId)).toEqual({ name: "Primary", currency_code: "NOK" });
      expect(persistedDatabase.prepare(
        "SELECT COUNT(*) AS count FROM transactions WHERE account_id = ?"
      ).get(accountId)).toEqual({ count: 1 });
      expect(persistedDatabase.prepare(
        "SELECT COUNT(*) AS count FROM account_statement_coverage_periods WHERE account_id = ?"
      ).get(accountId)).toEqual({ count: 1 });
      expect(persistedDatabase.prepare(
        "SELECT COUNT(*) AS count FROM account_balance_checkpoints WHERE account_id = ?"
      ).get(accountId)).toEqual({ count: 1 });
    } finally {
      persistedDatabase.close();
    }

    await window.reload();
    await expect(appShell.heading).toBeVisible();
    await appShell.openWorkspace("Accounts");
    await expect(window.getByRole("list", { name: "Household accounts" }))
      .toContainText("Primary");
    await expect.poll(() => window.evaluate(() => (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ))).toBeLessThanOrEqual(0);

    await electronApp.evaluate(({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      if (browserWindow === undefined) throw new Error("Electron window is unavailable.");
      browserWindow.setContentSize(390, 844);
    });
    await expect.poll(() => window.evaluate(() => (
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    ))).toBeLessThanOrEqual(0);
    expect(await mainProcessNetworkRequests(electronApp)).toEqual([]);
  });
});
