import { DatabaseSync } from "node:sqlite";
import { _electron as electron } from "@playwright/test";
import { dirname, join } from "node:path";
import { AppShellPage } from "./pom/AppShellPage.js";
import { LedgerPage } from "./pom/LedgerPage.js";
import { ManualEntryPage } from "./pom/ManualEntryPage.js";
import { OnboardingPage } from "./pom/OnboardingPage.js";
import {
  installMainProcessNetworkProbe,
  mainProcessNetworkRequests,
} from "./helpers/networkProbe.js";
import { test, expect } from "./fixtures/electron.js";

const MAIN_ENTRY = join(process.cwd(), "out", "main", "index.js");

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
      .toContainText("Savings account added in SEK.");
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
    await editForm.getByLabel("Account name").fill(" ");
    await editForm.getByRole("button", { name: "Save account changes" }).click();
    await expect(editForm.getByLabel("Account name")).toHaveAttribute("aria-invalid", "true");
    await expect(editForm.getByLabel("Account name")).toBeFocused();
    await expect(editForm.getByRole("alert")).toContainText("Enter an account name.");
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
    await expect(window.getByRole("alert")).toContainText("Unable to save account changes.");
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
    await appShell.openWorkspace("Import");
    await appShell.selectImportFormat("Manual transaction");
    await expect(new ManualEntryPage(window).accountInput).toContainText("Primary");
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

test.describe("account archiving", () => {
  test.use({ databaseSeed: "empty" });

  test("confirms archive, excludes active workflows, and keeps searchable history", async ({
    databasePath,
    electronApp,
    window,
  }) => {
    const onboarding = new OnboardingPage(window);
    await expect(onboarding.heading).toBeVisible();
    await onboarding.submit("Test Household", "Checking", "NOK");

    await installMainProcessNetworkProbe(electronApp);
    const appShell = new AppShellPage(window);
    await appShell.openWorkspace("Accounts");
    await window.getByLabel("Account name", { exact: true }).fill("Savings");
    await window.getByLabel("Currency code", { exact: true }).fill("NOK");
    await window.getByRole("button", { name: "Add account" }).click();
    await expect(window.getByRole("status", { name: "Account management status" }))
      .toContainText("Savings account added in NOK.");

    await window.getByRole("button", { name: "Edit account Checking" }).click();
    const checkingEditForm = window.getByRole("form", { name: "Edit account Checking" });
    await checkingEditForm.getByLabel("Account name").fill("Checking");
    await checkingEditForm.getByRole("button", { name: "Save account changes" }).click();
    await expect(window.getByRole("status", { name: "Account management status" }))
      .toHaveText("Account updated.");

    const database = new DatabaseSync(databasePath);
    let checkingAccountId: string;
    try {
      const account = database.prepare(
        "SELECT id, household_id FROM accounts WHERE name = ?"
      ).get("Checking") as { id: string; household_id: string } | undefined;
      if (account === undefined) throw new Error("Initial account was not persisted.");
      checkingAccountId = account.id;
      database.prepare(`
        INSERT INTO transactions (
          id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
          merchant_search, currency_code, source_type, source_reference, category_id,
          import_job_id, categorization_json, category_allocations_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "tx-account-archive",
        account.household_id,
        account.id,
        "2026-05-12T00:00:00Z",
        -12_500,
        "Synthetic archive grocery",
        "SYNTHETIC ARCHIVE GROCERY",
        "NOK",
        "manual",
        "synthetic-archive-entry",
        null,
        null,
        null,
        null
      );
      database.prepare(`
        INSERT INTO account_statement_coverage_periods (
          id, account_id, start_date_iso, end_date_iso, currency_code, source_name,
          source_type, confirmed, confirmed_at_iso
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "period-account-archive",
        account.id,
        "2026-05-01",
        "2026-05-31",
        "NOK",
        "synthetic-may-statement",
        "manual",
        1,
        "2026-06-01T00:00:00Z"
      );
      database.prepare(`
        INSERT INTO account_balance_checkpoints (
          id, account_id, date_iso, currency_code, balance_minor, source, recorded_at_iso
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        "checkpoint-account-archive",
        account.id,
        "2026-05-31",
        "NOK",
        87_500,
        "synthetic statement",
        "2026-06-01T00:00:00Z"
      );
    } finally {
      database.close();
    }

    const archiveAccountButton = window.getByRole("button", { name: "Archive account Checking" });
    await expect(archiveAccountButton).toBeVisible();
    let cancelDialogMessage = "";
    window.once("dialog", async (dialog) => {
      cancelDialogMessage = dialog.message();
      await dialog.dismiss();
    });
    await archiveAccountButton.click();
    expect(cancelDialogMessage).toContain("Checking");
    expect(cancelDialogMessage)
      .toContain("no longer appear in account pickers for new transactions or imports");
    expect(cancelDialogMessage).toContain("active-balance summaries");
    expect(cancelDialogMessage)
      .toContain("transactions, statement periods, checkpoints, and exports will remain available");
    await expect(window.getByRole("list", { name: "Household accounts" }))
      .toContainText("Checking");

    let archiveDialogMessage = "";
    window.once("dialog", async (dialog) => {
      archiveDialogMessage = dialog.message();
      await dialog.accept();
    });
    await archiveAccountButton.click();
    expect(archiveDialogMessage).toContain("Checking");
    const accountManagementStatus = window.getByRole("status", {
      name: "Account management status",
    });
    await expect(accountManagementStatus).toHaveCount(1);
    await expect(accountManagementStatus).toHaveText("Checking has been archived.");
    await expect(window.getByRole("list", { name: "Household accounts" })
      .getByRole("listitem").filter({ hasText: "Checking" })).toContainText("Archived");
    await expect(window.getByRole("button", { name: "Edit account Checking" })).toHaveCount(0);

    const archivedDatabase = new DatabaseSync(databasePath);
    try {
      expect(archivedDatabase.prepare(
        "SELECT name, archived_at_iso FROM accounts WHERE id = ?"
      ).get(checkingAccountId)).toMatchObject({
        name: "Checking",
        archived_at_iso: expect.any(String),
      });
      expect(archivedDatabase.prepare(
        "SELECT id FROM transactions WHERE account_id = ?"
      ).all(checkingAccountId)).toEqual([{ id: "tx-account-archive" }]);
      expect(archivedDatabase.prepare(
        "SELECT id FROM account_statement_coverage_periods WHERE account_id = ?"
      ).all(checkingAccountId)).toEqual([{ id: "period-account-archive" }]);
      expect(archivedDatabase.prepare(
        "SELECT id FROM account_balance_checkpoints WHERE account_id = ?"
      ).all(checkingAccountId)).toEqual([{ id: "checkpoint-account-archive" }]);
    } finally {
      archivedDatabase.close();
    }

    await appShell.openWorkspace("Review");
    await window.getByText("Plan ahead", { exact: true }).click();
    const liquidAccounts = window.getByRole("group", { name: "Liquid accounts" });
    await expect(liquidAccounts.getByText("Savings", { exact: true })).toBeVisible();
    await expect(liquidAccounts.getByText("Checking", { exact: true })).toHaveCount(0);

    await appShell.openWorkspace("Import");
    await appShell.selectImportFormat("Manual transaction");
    const manualEntry = new ManualEntryPage(window);
    await expect(manualEntry.accountInput).toContainText("Savings");
    await expect(manualEntry.accountInput).not.toContainText("Checking");

    await appShell.openWorkspace("Transactions");
    const ledger = new LedgerPage(window);
    await expect(ledger.transaction("Synthetic archive grocery")).toBeVisible();

    await appShell.openWorkspace("Coverage");
    await window.getByLabel("Coverage account").selectOption(checkingAccountId);
    await expect(window.getByRole("option", { name: "Checking (NOK) — Archived" }))
      .toBeAttached();
    await expect(window.getByRole("status", { name: "Archived account history" }))
      .toHaveText("Archived account. Historical coverage and checkpoints are read-only. Restore this account to make changes.");
    await expect(window.getByRole("button", { name: "Save statement period" })).toBeDisabled();
    await expect(window.getByRole("button", { name: "Save balance checkpoint" })).toBeDisabled();
    await expect(window.getByRole("list", { name: "Balance checkpoint history" }))
      .toContainText("875,00");
    await expect(window.getByText("synthetic-may-statement", { exact: true })).toBeVisible();

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

  test("restores an archived account to active workflows", async ({
    databasePath,
    electronApp,
    window,
  }) => {
    const onboarding = new OnboardingPage(window);
    await expect(onboarding.heading).toBeVisible();
    await onboarding.submit("Test Household", "Checking", "NOK");

    await installMainProcessNetworkProbe(electronApp);
    const appShell = new AppShellPage(window);
    await appShell.openWorkspace("Accounts");
    await window.getByLabel("Account name", { exact: true }).fill("Savings");
    await window.getByLabel("Currency code", { exact: true }).fill("NOK");
    await window.getByRole("button", { name: "Add account" }).click();

    const database = new DatabaseSync(databasePath);
    let checkingAccountId: string;
    try {
      const account = database.prepare(
        "SELECT id FROM accounts WHERE name = ?"
      ).get("Checking") as { id: string } | undefined;
      if (account === undefined) throw new Error("Initial account was not persisted.");
      checkingAccountId = account.id;
    } finally {
      database.close();
    }

    window.once("dialog", async (dialog) => dialog.accept());
    await window.getByRole("button", { name: "Archive account Checking" }).click();
    await expect(window.getByRole("status", { name: "Account management status" }))
      .toContainText("Checking has been archived.");

    const restoreButton = window.getByRole("button", { name: "Restore account Checking" });
    await expect(restoreButton).toBeVisible();
    await restoreButton.click();
    await expect(window.getByRole("status", { name: "Account management status" }))
      .toContainText("Checking has been restored.");
    await expect(window.getByRole("list", { name: "Household accounts" })
      .getByRole("listitem").filter({ hasText: "Checking" })).not.toContainText("Archived");

    await appShell.openWorkspace("Import");
    await appShell.selectImportFormat("Manual transaction");
    const manualEntry = new ManualEntryPage(window);
    await expect(manualEntry.accountInput).toContainText("Checking");
    await expect(manualEntry.accountInput).toContainText("Savings");

    await appShell.openWorkspace("Coverage");
    await window.getByLabel("Coverage account").selectOption(checkingAccountId);
    await expect(window.getByRole("button", { name: "Save statement period" })).toBeEnabled();
    await expect(window.getByRole("button", { name: "Save balance checkpoint" })).toBeEnabled();

    const restoredDatabase = new DatabaseSync(databasePath);
    try {
      expect(restoredDatabase.prepare(
        "SELECT archived_at_iso FROM accounts WHERE id = ?"
      ).get(checkingAccountId)).toEqual({ archived_at_iso: null });
    } finally {
      restoredDatabase.close();
    }
    expect(await mainProcessNetworkRequests(electronApp)).toEqual([]);
  });

  test("restores archived state and history after an Electron relaunch", async ({
    databasePath,
    electronApp,
    window,
  }) => {
    const recordedAtIso = new Date().toISOString();
    const nextIncomeDateIso = new Date(
      Date.parse(recordedAtIso) + 86_400_000
    ).toISOString().slice(0, 10);
    const onboarding = new OnboardingPage(window);
    await expect(onboarding.heading).toBeVisible();
    await onboarding.submit("Test Household", "Checking", "NOK");

    const appShell = new AppShellPage(window);
    await appShell.openWorkspace("Accounts");
    await window.getByLabel("Account name", { exact: true }).fill("Savings");
    await window.getByLabel("Currency code", { exact: true }).fill("NOK");
    await window.getByRole("button", { name: "Add account" }).click();
    await expect(window.getByRole("status", { name: "Account management status" }))
      .toContainText("Savings account added in NOK.");

    const database = new DatabaseSync(databasePath);
    let checkingAccountId: string;
    try {
      const account = database.prepare(
        "SELECT id, household_id FROM accounts WHERE name = ?"
      ).get("Checking") as { id: string; household_id: string } | undefined;
      if (account === undefined) throw new Error("Initial account was not persisted.");
      checkingAccountId = account.id;
      const activeAccount = database.prepare(
        "SELECT id FROM accounts WHERE name = ?"
      ).get("Savings") as { id: string } | undefined;
      if (activeAccount === undefined) throw new Error("Active account was not persisted.");
      database.prepare(`
        INSERT INTO transactions (
          id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
          merchant_search, currency_code, source_type, source_reference, category_id,
          import_job_id, categorization_json, category_allocations_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "tx-account-relaunch",
        account.household_id,
        account.id,
        "2026-05-12T00:00:00Z",
        -12_500,
        "Synthetic relaunch grocery",
        "SYNTHETIC RELAUNCH GROCERY",
        "NOK",
        "manual",
        "synthetic-relaunch-entry",
        null,
        null,
        null,
        null
      );
      database.prepare(`
        INSERT INTO account_statement_coverage_periods (
          id, account_id, start_date_iso, end_date_iso, currency_code, source_name,
          source_type, confirmed, confirmed_at_iso
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "period-account-relaunch",
        account.id,
        "2026-05-01",
        "2026-05-31",
        "NOK",
        "synthetic-relaunch-statement",
        "manual",
        1,
        "2026-06-01T00:00:00Z"
      );
      database.prepare(`
        INSERT INTO account_balance_checkpoints (
          id, account_id, date_iso, currency_code, balance_minor, source, recorded_at_iso
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        "checkpoint-account-relaunch",
        account.id,
        "2026-05-31",
        "NOK",
        87_500,
        "synthetic statement",
        "2026-06-01T00:00:00Z"
      );
      const activeBalanceDateIso = recordedAtIso.slice(0, 10);
      database.prepare(`
        INSERT INTO account_statement_coverage_periods (
          id, account_id, start_date_iso, end_date_iso, currency_code, source_name,
          source_type, confirmed, confirmed_at_iso
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "period-active-account-relaunch",
        activeAccount.id,
        activeBalanceDateIso,
        activeBalanceDateIso,
        "NOK",
        "synthetic-active-statement",
        "manual",
        1,
        recordedAtIso
      );
      database.prepare(`
        INSERT INTO account_balance_checkpoints (
          id, account_id, date_iso, currency_code, balance_minor, source, recorded_at_iso
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        "checkpoint-active-account-relaunch",
        activeAccount.id,
        activeBalanceDateIso,
        "NOK",
        50_000,
        "synthetic active account",
        recordedAtIso
      );
    } finally {
      database.close();
    }

    window.once("dialog", async (dialog) => dialog.accept());
    await window.getByRole("button", { name: "Archive account Checking" }).click();
    await expect(window.getByRole("status", { name: "Account management status" }))
      .toContainText("Checking has been archived.");

    await electronApp.close();
    const restartedApp = await electron.launch({
      args: [
        "--lang=en-GB",
        `--user-data-dir=${join(dirname(databasePath), "electron-profile")}`,
        MAIN_ENTRY,
      ],
      env: {
        ...process.env,
        BUDGET_DB_PATH: databasePath,
        BUDGET_TEST_LEDGER_SEED: "empty",
        NODE_ENV: "test",
      },
    });

    try {
      const restartedWindow = await restartedApp.firstWindow();
      await restartedWindow.waitForLoadState("domcontentloaded");
      const restartedShell = new AppShellPage(restartedWindow);
      await restartedShell.openWorkspace("Accounts");
      const householdAccounts = restartedWindow.getByRole("list", { name: "Household accounts" });
      await expect(householdAccounts.getByRole("listitem").filter({ hasText: "Checking" }))
        .toContainText("Archived");
      await expect(restartedWindow.getByRole("button", { name: "Edit account Checking" }))
        .toHaveCount(0);
      await expect(restartedWindow.getByRole("button", { name: "Restore account Checking" }))
        .toBeVisible();

      await restartedShell.openWorkspace("Review");
      await restartedWindow.getByText("Plan ahead", { exact: true }).click();
      const liquidAccounts = restartedWindow.getByRole("group", { name: "Liquid accounts" });
      await expect(liquidAccounts.getByText("Savings", { exact: true })).toBeVisible();
      await expect(liquidAccounts.getByText("Checking", { exact: true })).toHaveCount(0);

      const spendableCash = restartedWindow.getByRole("region", {
        name: "Spendable cash until income",
      });
      await spendableCash.getByLabel("Next income date").fill(nextIncomeDateIso);
      await spendableCash.getByLabel("Reserve (NOK)").fill("0");
      await spendableCash.getByRole("button", { name: "Estimate spendable cash" }).click();
      const selectedBalancesHeading = spendableCash.getByRole("heading", {
        name: "Selected balances",
        exact: true,
      });
      const selectedBalances = selectedBalancesHeading.locator("..");
      await expect(selectedBalances.getByRole("list")).toContainText("Savings");
      await expect(selectedBalances.getByRole("list")).toContainText("500,00");
      await expect(selectedBalances.getByRole("list")).not.toContainText("Checking");

      await restartedShell.openWorkspace("Import");
      await restartedShell.selectImportFormat("Manual transaction");
      const manualEntry = new ManualEntryPage(restartedWindow);
      await expect(manualEntry.accountInput).toContainText("Savings");
      await expect(manualEntry.accountInput).not.toContainText("Checking");

      await restartedShell.openWorkspace("Transactions");
      await expect(new LedgerPage(restartedWindow).transaction("Synthetic relaunch grocery"))
        .toBeVisible();

      await restartedShell.openWorkspace("Coverage");
      await restartedWindow.getByLabel("Coverage account").selectOption(checkingAccountId);
      await expect(restartedWindow.getByRole("status", { name: "Archived account history" }))
        .toBeVisible();
      await expect(restartedWindow.getByRole("button", { name: "Save statement period" }))
        .toBeDisabled();
      await expect(restartedWindow.getByRole("button", { name: "Save balance checkpoint" }))
        .toBeDisabled();
      await expect(restartedWindow.getByRole("list", { name: "Balance checkpoint history" }))
        .toContainText("875,00");
      await expect(restartedWindow.getByText("synthetic-relaunch-statement", { exact: true }))
        .toBeVisible();
    } finally {
      await restartedApp.close();
    }
  });

  test("explains why the last active account cannot be archived", async ({
    electronApp,
    window,
  }) => {
    const onboarding = new OnboardingPage(window);
    await expect(onboarding.heading).toBeVisible();
    await onboarding.submit("Test Household", "Checking", "NOK");
    await installMainProcessNetworkProbe(electronApp);

    await new AppShellPage(window).openWorkspace("Accounts");
    const archiveButton = window.getByRole("button", { name: "Archive account Checking" });
    await expect(archiveButton).toBeDisabled();
    await expect(archiveButton).toHaveAccessibleDescription(
      "You cannot archive the last active account. Add another active account first."
    );
    await window.setViewportSize({ width: 390, height: 844 });
    const hasHorizontalOverflow = await window.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalOverflow).toBe(false);
    expect(await mainProcessNetworkRequests(electronApp)).toEqual([]);
  });
});
