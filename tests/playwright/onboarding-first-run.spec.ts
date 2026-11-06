import { _electron as electron } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { AppShellPage } from "./pom/AppShellPage.js";
import { ManualEntryPage } from "./pom/ManualEntryPage.js";
import { OnboardingPage } from "./pom/OnboardingPage.js";
import { test, expect } from "./fixtures/electron.js";

test.describe("first-run household setup", () => {
  test.use({ databaseSeed: "empty" });

  test("creates a local household and uses its first account after restarting Electron", async ({
    databasePath,
    electronApp,
    window,
  }) => {
    const onboarding = new OnboardingPage(window);
    await electronApp.evaluate(({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      if (browserWindow === undefined) throw new Error("Electron window is unavailable.");
      browserWindow.setContentSize(1280, 800);
    });
    await expect(onboarding.heading).toBeVisible();
    await electronApp.evaluate(({ BrowserWindow }) => {
      const browserWindow = BrowserWindow.getAllWindows()[0];
      if (browserWindow === undefined) throw new Error("Electron window is unavailable.");
      browserWindow.setContentSize(390, 844);
    });
    await expect.poll(() => window.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    )).toBeLessThanOrEqual(0);
    await expect(window.getByText("Sample Household", { exact: true })).toHaveCount(0);

    await onboarding.householdNameInput.fill("Test Household");
    await onboarding.accountNameInput.fill("Checking");
    await onboarding.currencyCodeInput.fill("N!");
    await onboarding.createLedgerButton.click();
    await expect(onboarding.heading).toBeVisible();

    await onboarding.currencyCodeInput.fill("NOK");
    await onboarding.createLedgerButton.click();
    await expect(onboarding.heading).toBeHidden();

    const database = new DatabaseSync(databasePath);
    let householdId: string;
    let accountId: string;
    try {
      const household = database
        .prepare("SELECT id FROM households")
        .get() as { id: string } | undefined;
      const account = database
        .prepare("SELECT id, household_id FROM accounts")
        .get() as { id: string; household_id: string } | undefined;
      if (household === undefined || account === undefined) {
        throw new Error("Household setup did not persist its required records.");
      }
      householdId = household.id;
      accountId = account.id;
      expect(account.household_id).toBe(householdId);
      expect(householdId).not.toBe("sample-hh");
      expect(accountId).not.toBe("sample-acc");
    } finally {
      database.close();
    }

    await electronApp.close();
    const restartedApp = await electron.launch({
      args: ["--lang=en-GB", join(process.cwd(), "out", "main", "index.js")],
      env: {
        ...process.env,
        NODE_ENV: "test",
        BUDGET_TEST_LEDGER_SEED: "empty",
        BUDGET_DB_PATH: databasePath,
      },
    });
    try {
      const restartedWindow = await restartedApp.firstWindow();
      await restartedWindow.waitForLoadState("domcontentloaded");
      const restartedShell = new AppShellPage(restartedWindow);
      const restartedOnboarding = new OnboardingPage(restartedWindow);
      await expect(restartedShell.heading).toBeVisible();
      await expect(restartedOnboarding.heading).toHaveCount(0);
      await restartedShell.openWorkspace("Import");
      await restartedShell.selectImportFormat("Manual transaction");
      const manualEntry = new ManualEntryPage(restartedWindow);
      await expect(manualEntry.accountInput).toHaveValue(accountId);
    } finally {
      await restartedApp.close();
    }
  });

  test("shows a household read failure instead of misclassifying the database as first run", async ({
    databasePath,
    window,
  }) => {
    const onboarding = new OnboardingPage(window);
    await expect(onboarding.heading).toBeVisible();

    const database = new DatabaseSync(databasePath);
    try {
      database.exec(`
        DROP TABLE households;
        CREATE VIEW households AS SELECT id FROM missing_households;
      `);
    } finally {
      database.close();
    }

    await window.reload();
    await expect(onboarding.heading).toHaveCount(0);
    await expect(window.getByRole("alert")).toContainText("Household ledger unavailable");
  });
});
