import { test as baseTest, expect } from "./fixtures/electron.js";
import type { Locator, Page } from "@playwright/test";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { createRecurringCommitmentService } from "../../src/app/recurringCommitmentService.js";
import type {
  AccountBalanceCheckpoint,
  AccountStatementCoveragePeriod,
  ExchangeRate,
  ImportJob,
  PendingTransactionObservation,
} from "../../src/domain/types.js";

const test = baseTest.extend({});

test.describe("local spendable cash estimate", () => {
  test.use({ nodeEnvironment: "production" });

  test("shows the selected balances, pre-income outflows, reserve, and advisory amount", async ({
    databasePath,
    window,
  }) => {
    const evaluatedAtIso = new Date().toISOString();
    const evaluatedDateIso = evaluatedAtIso.slice(0, 10);
    const nextIncomeDateIso = addUtcDays(evaluatedDateIso, 10);
    const balanceDateRange = previousMonthRange(evaluatedDateIso);

    await createLocalHousehold(window, evaluatedAtIso);
    seedSpendableLedger(databasePath, {
      evaluatedAtIso,
      balanceDateRange,
      pendingDateIso: addUtcDays(evaluatedDateIso, 3),
      commitmentDateIso: addUtcDays(evaluatedDateIso, 5),
    });
    await window.reload();

    const section = window.getByRole("region", {
      name: "Spendable cash until income",
      exact: true,
    });
    await expect(section).toBeVisible();

    const accountCheckbox = section.getByRole("checkbox", {
      name: "Synthetic current account NOK",
      exact: true,
    });
    await accountCheckbox.focus();
    await window.keyboard.press("Space");
    await expect(accountCheckbox).not.toBeChecked();
    await window.keyboard.press("Space");
    await expect(accountCheckbox).toBeChecked();
    await section.getByLabel("Next income date").fill(nextIncomeDateIso);
    await section.getByLabel("Reserve (NOK)").fill("500");
    await section.getByRole("button", { name: "Estimate spendable cash" }).click();

    const estimate = section.getByRole("status", {
      name: "Spendable cash estimate",
      exact: true,
    });
    await expect(estimate).toContainText(/3\s?500,00/);
    await expect(section).toContainText("Synthetic current account");
    await expect(section).toContainText(balanceDateRange.endDateIso);
    await expect(section).toContainText("Synthetic electricity");
    await expect(section).toContainText("Synthetic rent");
    await expect(section).toContainText(nextIncomeDateIso);

    await window.setViewportSize({ width: 1280, height: 800 });
    await expect(estimate).toBeVisible();
    await window.setViewportSize({ width: 390, height: 844 });
    await expect(estimate).toBeVisible();
    await expectNoHorizontalOverflow(window);
  });

  test("labels a shortfall and keeps the ledger unchanged after estimate and reload", async ({
    databasePath,
    window,
  }) => {
    const evaluatedAtIso = new Date().toISOString();
    const evaluatedDateIso = evaluatedAtIso.slice(0, 10);
    const nextIncomeDateIso = addUtcDays(evaluatedDateIso, 10);
    const balanceDateRange = previousMonthRange(evaluatedDateIso);

    await createLocalHousehold(window, evaluatedAtIso);
    seedSpendableLedger(databasePath, {
      evaluatedAtIso,
      balanceDateRange,
      pendingAmountMinor: null,
      balanceMinor: 100_000,
      commitmentAmountMinor: 90_000,
      commitmentDateIso: addUtcDays(evaluatedDateIso, 5),
    });
    const snapshotBeforeEstimate = readLedgerSnapshot(databasePath);
    await window.reload();

    const section = window.getByRole("region", {
      name: "Spendable cash until income",
      exact: true,
    });
    await expect(section).toBeVisible();
    await section.getByLabel("Next income date").fill(nextIncomeDateIso);
    await section.getByLabel("Reserve (NOK)").fill("250");
    await section.getByRole("button", { name: "Estimate spendable cash" }).click();

    const estimate = section.getByRole("status", {
      name: "Spendable cash estimate",
      exact: true,
    });
    await expect(estimate).toContainText("Projected shortfall");
    await expect(estimate).toContainText(/150,00/);
    await window.setViewportSize({ width: 390, height: 844 });
    await expect(estimate).toBeVisible();
    await expectNoHorizontalOverflow(window);

    await window.reload();
    await expect(window.getByRole("region", {
      name: "Spendable cash until income",
      exact: true,
    })).toBeVisible();
    expect(readLedgerSnapshot(databasePath)).toEqual(snapshotBeforeEstimate);
  });

  test("surfaces stale account balances as incomplete instead of showing an amount", async ({
    databasePath,
    window,
  }) => {
    const evaluatedAtIso = new Date().toISOString();
    const evaluatedDateIso = evaluatedAtIso.slice(0, 10);
    await createLocalHousehold(window, evaluatedAtIso);
    seedSpendableLedger(databasePath, {
      evaluatedAtIso,
      balanceDateRange: previousMonthRange(evaluatedDateIso),
      pendingAmountMinor: null,
      staleBalance: true,
      commitmentDateIso: addUtcDays(evaluatedDateIso, 5),
    });
    await window.reload();

    const section = window.getByRole("region", {
      name: "Spendable cash until income",
      exact: true,
    });
    await submitEstimate(section, addUtcDays(evaluatedDateIso, 10), "500");

    const estimate = section.getByRole("status", {
      name: "Spendable cash estimate",
      exact: true,
    });
    await expect(estimate).toContainText("Estimate incomplete");
    await expect(estimate).toContainText("latest balance");
    await expect(estimate).toContainText("stale");
    await expect(estimate).not.toContainText(/NOK|kr/);
  });

  test("surfaces a commitment with an unknown amount as incomplete", async ({
    databasePath,
    window,
  }) => {
    const evaluatedAtIso = new Date().toISOString();
    const evaluatedDateIso = evaluatedAtIso.slice(0, 10);
    await createLocalHousehold(window, evaluatedAtIso);
    seedSpendableLedger(databasePath, {
      evaluatedAtIso,
      balanceDateRange: previousMonthRange(evaluatedDateIso),
      pendingAmountMinor: null,
      commitmentIsVariable: true,
      commitmentDateIso: addUtcDays(evaluatedDateIso, 5),
    });
    await window.reload();

    const section = window.getByRole("region", {
      name: "Spendable cash until income",
      exact: true,
    });
    await submitEstimate(section, addUtcDays(evaluatedDateIso, 10), "500");

    const estimate = section.getByRole("status", {
      name: "Spendable cash estimate",
      exact: true,
    });
    await expect(estimate).toContainText("Estimate incomplete");
    await expect(estimate).toContainText("amount for Synthetic rent is not known");
  });

  test("requires an explicit local monthly rate for foreign-currency commitments", async ({
    databasePath,
    window,
  }) => {
    const evaluatedAtIso = new Date().toISOString();
    const evaluatedDateIso = evaluatedAtIso.slice(0, 10);
    const commitmentDateIso = addUtcDays(evaluatedDateIso, 5);
    const yearMonth = commitmentDateIso.slice(0, 7);
    await createLocalHousehold(window, evaluatedAtIso);
    seedSpendableLedger(databasePath, {
      evaluatedAtIso,
      balanceDateRange: previousMonthRange(evaluatedDateIso),
      pendingAmountMinor: null,
      commitmentDateIso,
      commitmentAmountMinor: 1_000,
      commitmentCurrencyCode: "EUR",
      monthlyReferenceRate: {
        id: "eur-monthly-reference",
        currencyCode: "EUR",
        rateNokPerUnit: "11.5",
        effectiveDate: commitmentDateIso,
        kind: "monthly-reference",
        source: "Synthetic monthly estimate",
        provenance: "manual",
      },
    });
    await window.reload();

    const section = window.getByRole("region", {
      name: "Spendable cash until income",
      exact: true,
    });
    await submitEstimate(section, addUtcDays(evaluatedDateIso, 10), "0");
    const estimate = section.getByRole("status", {
      name: "Spendable cash estimate",
      exact: true,
    });
    await expect(estimate).toContainText("Estimate incomplete");
    await expect(estimate).toContainText(/EUR on/);

    const monthlyRate = section.getByRole("combobox", {
      name: `Monthly estimate for EUR ${yearMonth}`,
      exact: true,
    });
    await expect(monthlyRate).toBeVisible();
    await monthlyRate.selectOption("eur-monthly-reference");
    await section.getByRole("button", { name: "Estimate spendable cash" }).click();
    await expect(estimate).toContainText("Advisory spendable cash");
    await expect(section).toContainText("Monthly estimate");
  });
});

async function submitEstimate(
  section: Locator,
  nextIncomeDateIso: string,
  reserveNok: string
): Promise<void> {
  await section.getByLabel("Next income date").fill(nextIncomeDateIso);
  await section.getByLabel("Reserve (NOK)").fill(reserveNok);
  await section.getByRole("button", { name: "Estimate spendable cash" }).click();
}

async function createLocalHousehold(window: Page, frozenTimeIso: string): Promise<void> {
  await expect(window.getByRole("heading", { name: "Set up your household", exact: true }))
    .toBeVisible();
  await window.clock.install({ time: new Date(frozenTimeIso) });
  await window.getByLabel("Household name").fill("Synthetic household");
  await window.getByLabel("Account name").fill("Synthetic current account");
  await window.getByRole("button", { name: "Create local ledger", exact: true }).click();
  await expect(window.getByRole("heading", { name: "Budget Planner", exact: true }))
    .toBeVisible();
  await expect(window.getByRole("region", { name: "Review workspace", exact: true }))
    .toHaveAttribute("aria-busy", "false");
}

function seedSpendableLedger(
  databasePath: string,
  input: {
    evaluatedAtIso: string;
    balanceDateRange: { startDateIso: string; endDateIso: string };
    pendingDateIso?: string;
    commitmentDateIso: string;
    pendingAmountMinor?: number | null;
    balanceMinor?: number;
    commitmentAmountMinor?: number | null;
    commitmentCurrencyCode?: string;
    commitmentIsVariable?: boolean;
    monthlyReferenceRate?: ExchangeRate;
    staleBalance?: boolean;
  }
): void {
  const ledger = createLocalLedgerDatabase({ dbPath: databasePath });
  const metadata = ledger.loadRuntimeMetadata();
  if (metadata === null) throw new Error("Synthetic household setup failed.");
  const accountId = metadata.accounts[0]!.id;
  const householdId = metadata.household.id;
  const importedAtIso = input.evaluatedAtIso;
  const period: AccountStatementCoveragePeriod = {
    id: "coverage-previous-month",
    accountId,
    startDateIso: input.balanceDateRange.startDateIso,
    endDateIso: input.balanceDateRange.endDateIso,
    currencyCode: "NOK",
    sourceName: "synthetic-statement.csv",
    sourceType: "manual",
    confirmed: true,
    confirmedAtIso: importedAtIso,
  };
  const openingBalance: AccountBalanceCheckpoint = {
    id: "balance-opening",
    accountId,
    dateIso: input.balanceDateRange.startDateIso,
    currencyCode: "NOK",
    balanceMinor: input.balanceMinor ?? 500_000,
    source: "Synthetic statement",
    recordedAtIso: importedAtIso,
  };
  const closingBalance: AccountBalanceCheckpoint = {
    id: "balance-closing",
    accountId,
    dateIso: input.balanceDateRange.endDateIso,
    currencyCode: "NOK",
    balanceMinor: input.balanceMinor ?? 500_000,
    source: "Synthetic statement",
    recordedAtIso: importedAtIso,
  };
  const importJob: ImportJob = {
    id: "job-pending-electricity",
    householdId,
    sourceType: "csv",
    sourceName: "synthetic-pending.csv",
    startedAtIso: importedAtIso,
  };
  const pendingObservations: PendingTransactionObservation[] =
    input.pendingAmountMinor === null
      ? []
      : [{
          id: "pending-electricity",
          householdId,
          accountId,
          transactionDateIso: input.pendingDateIso ?? input.evaluatedAtIso.slice(0, 10),
          amountMinor: input.pendingAmountMinor ?? -40_000,
          merchantRaw: "Synthetic electricity",
          sourceRowIndex: 1,
          currencyCode: "NOK",
          sourceType: "csv",
          sourceReference: "electricity-next-payment",
          importJobId: importJob.id,
          status: "confirmed",
          sourceStatus: "Bekreftet",
        }];

  try {
    ledger.saveAccountStatementCoveragePeriod(period);
    ledger.appendAccountBalanceCheckpoint(openingBalance);
    if (input.staleBalance !== true) ledger.appendAccountBalanceCheckpoint(closingBalance);
    ledger.appendImportJobAndTransactions(importJob, [], [], pendingObservations);
    const commitments = createRecurringCommitmentService(ledger, {
      createId: () => "commitment-rent",
      now: () => new Date(input.evaluatedAtIso),
    });
    const suggested = commitments.create({
      description: "Synthetic rent",
      currencyCode: input.commitmentCurrencyCode ?? "NOK",
      amountMinor: input.commitmentIsVariable
        ? null
        : input.commitmentAmountMinor ?? 60_000,
      isVariable: input.commitmentIsVariable ?? false,
      cadence: "monthly",
      firstDueDateIso: input.commitmentDateIso,
      activeFromIso: input.evaluatedAtIso.slice(0, 10),
    });
    commitments.confirm(suggested.id);
    if (input.monthlyReferenceRate !== undefined) {
      ledger.upsertExchangeRate(input.monthlyReferenceRate);
    }
  } finally {
    ledger.close();
  }

}

function readLedgerSnapshot(databasePath: string) {
  const ledger = createLocalLedgerDatabase({ dbPath: databasePath });
  try {
    return ledger.loadLedgerSnapshotData();
  } finally {
    ledger.close();
  }
}

function addUtcDays(dateIso: string, days: number): string {
  const date = new Date(`${dateIso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function previousMonthRange(dateIso: string): { startDateIso: string; endDateIso: string } {
  const start = new Date(`${dateIso}T00:00:00.000Z`);
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - 1);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  return {
    startDateIso: start.toISOString().slice(0, 10),
    endDateIso: end.toISOString().slice(0, 10),
  };
}

async function expectNoHorizontalOverflow(window: Page): Promise<void> {
  const horizontalOverflow = await window.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(horizontalOverflow).toBe(false);
}
