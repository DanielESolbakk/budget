import { test as baseTest, expect } from "./fixtures/electron.js";
import type { Locator, Page } from "@playwright/test";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { createLoanRegistry } from "../../src/app/loanRegistry.js";
import { createRecurringCommitmentService } from "../../src/app/recurringCommitmentService.js";
import { AppShellPage } from "./pom/AppShellPage.js";
import type {
  AccountBalanceCheckpoint,
  AccountStatementCoveragePeriod,
  Transaction,
} from "../../src/domain/types.js";

const test = baseTest.extend({});

test.describe("local cashflow scenario workflow", () => {
  test.use({ nodeEnvironment: "production" });

  test("compares a dated income reduction with baseline and reset leaves actual records unchanged", async ({
    databasePath,
    window,
  }) => {
    const evaluatedAtIso = new Date().toISOString();
    const evaluatedDateIso = evaluatedAtIso.slice(0, 10);
    const currentYearMonth = evaluatedDateIso.slice(0, 7);
    const firstScenarioMonth = addMonths(currentYearMonth, 1);
    const secondScenarioMonth = addMonths(currentYearMonth, 2);

    await createLocalHousehold(window, evaluatedAtIso);
    seedCashflowScenarioLedger(databasePath, evaluatedAtIso);
    const snapshotBeforeScenario = readLedgerSnapshot(databasePath);
    await window.reload();
    await new AppShellPage(window).openPlanningTools();

    const section = getScenarioSection(window);
    await expect(section).toBeVisible();
    await expect(section).toContainText(
      "Confirmed commitments with future occurrences are included in both paths. Only historical payments linked to those commitments are removed from the moving-average baseline."
    );
    await addScenarioAssumption(section, {
      kind: "income-change",
      direction: "reduction",
      amount: "100",
      currencyCode: "NOK",
      dateIso: `${firstScenarioMonth}-15`,
      durationMonths: "2",
    });
    await expect(section).toContainText("Income reduction");
    const comparison = await compareScenario(section);
    await expect(comparison).toBeVisible();
    const firstMonth = getScenarioMonth(comparison, currentYearMonth);
    const secondMonth = getScenarioMonth(comparison, firstScenarioMonth);
    const thirdMonth = getScenarioMonth(comparison, secondScenarioMonth);
    await expect(firstMonth.getByRole("group", { name: "Baseline cashflow", exact: true }))
      .toContainText(/400,00/);
    await expect(firstMonth.getByRole("group", { name: "Scenario cashflow", exact: true }))
      .toContainText(/400,00/);
    await expect(secondMonth.getByRole("group", { name: "Baseline cashflow", exact: true }))
      .toContainText(/300,00/);
    await expect(secondMonth.getByRole("group", { name: "Scenario cashflow", exact: true }))
      .toContainText(/200,00/);
    await expect(thirdMonth.getByRole("group", { name: "Scenario cashflow", exact: true }))
      .toContainText(/200,00/);
    await expect(comparison.getByRole("group", {
      name: "Baseline cash path",
      exact: true,
    })).toBeVisible();
    const scenarioCashPath = comparison.getByRole("group", {
      name: "Scenario cash path",
      exact: true,
    });
    const firstScenarioDate = `${firstScenarioMonth}-15`;
    const formattedFirstScenarioDate = new Intl.DateTimeFormat("nb-NO", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${firstScenarioDate}T00:00:00.000Z`));
    const pathDate = scenarioCashPath.getByText(formattedFirstScenarioDate, { exact: true });
    await expect(pathDate).toBeVisible();
    const pathDateHeight = await pathDate.evaluate((element) =>
      element.getBoundingClientRect().height
    );
    expect(pathDateHeight).toBeLessThan(20);
    await expect(
      scenarioCashPath.getByRole("group", { name: "Movement", exact: true }).first()
    ).toContainText(/0,00/);
    await expect(comparison.getByRole("group", {
      name: "Minimum projected cash difference",
      exact: true,
    })).toContainText(/0,00/);
    const appliedAssumptions = comparison.getByRole("group", {
      name: "Applied scenario assumptions",
      exact: true,
    });
    await expect(appliedAssumptions).toContainText("Income reduction");
    await expect(appliedAssumptions).toContainText("2 months");

    await window.setViewportSize({ width: 1280, height: 800 });
    await expect(comparison).toBeVisible();
    await expectNoHorizontalOverflow(window);
    const projectedCashValue = scenarioCashPath
      .getByRole("group", { name: "Projected cash", exact: true })
      .first()
      .getByRole("definition");
    const projectedCashValueHeight = await projectedCashValue.evaluate((element) =>
      element.getBoundingClientRect().height
    );
    expect(projectedCashValueHeight).toBeLessThan(40);
    await expectNoHorizontalOverflow(window);
    await expect(comparison.getByRole("group", {
      name: "Baseline cash path",
      exact: true,
    })).toBeVisible();
    await expect(comparison.getByRole("group", {
      name: "Minimum projected cash difference",
      exact: true,
    })).toBeVisible();
    await window.setViewportSize({ width: 390, height: 844 });
    await expect(comparison).toBeVisible();
    await expect(comparison.getByRole("group", {
      name: "Scenario cash path",
      exact: true,
    })).toBeVisible();
    await expectNoHorizontalOverflow(window);

    const resetButton = section.getByRole("button", {
      name: "Reset scenario",
      exact: true,
    });
    await resetButton.focus();
    await expect(resetButton).toBeFocused();
    await window.keyboard.press("Enter");
    await expect(section).toContainText("No temporary assumptions");
    await expect(section.getByRole("status", {
      name: "Scenario comparison",
      exact: true,
    })).toHaveCount(0);
    await window.reload();
    await new AppShellPage(window).openPlanningTools();
    await expect(window.getByRole("region", {
      name: "Cashflow scenarios",
      exact: true,
    })).toBeVisible();
    expect(readLedgerSnapshot(databasePath)).toEqual(snapshotBeforeScenario);
  });

  test("applies a one-time expense to only its projected month", async ({
    databasePath,
    window,
  }) => {
    const evaluatedAtIso = new Date().toISOString();
    const currentYearMonth = evaluatedAtIso.slice(0, 7);
    const firstScenarioMonth = addMonths(currentYearMonth, 1);
    const secondScenarioMonth = addMonths(currentYearMonth, 2);

    await createLocalHousehold(window, evaluatedAtIso);
    seedCashflowScenarioLedger(databasePath, evaluatedAtIso);
    const snapshotBeforeScenario = readLedgerSnapshot(databasePath);
    await window.reload();
    await new AppShellPage(window).openPlanningTools();

    const section = getScenarioSection(window);
    await expect(section).toBeVisible();
    await addScenarioAssumption(section, {
      kind: "one-time-expense",
      amount: "750",
      currencyCode: "NOK",
      dateIso: `${firstScenarioMonth}-15`,
    });
    const comparison = await compareScenario(section);

    await expect(
      getScenarioMonth(comparison, currentYearMonth)
        .getByRole("group", { name: "Scenario cashflow", exact: true })
    ).toContainText(/400,00/);
    await expect(
      getScenarioMonth(comparison, firstScenarioMonth)
        .getByRole("group", { name: "Scenario cashflow", exact: true })
    ).toContainText(/[−-]450,00/);
    await expect(
      getScenarioMonth(comparison, secondScenarioMonth)
        .getByRole("group", { name: "Scenario cashflow", exact: true })
    ).toContainText(/300,00/);
    expect(readLedgerSnapshot(databasePath)).toEqual(snapshotBeforeScenario);
  });

  test("applies a recurring expense increase across the selected duration", async ({
    databasePath,
    window,
  }) => {
    const evaluatedAtIso = new Date().toISOString();
    const currentYearMonth = evaluatedAtIso.slice(0, 7);
    const firstScenarioMonth = addMonths(currentYearMonth, 1);
    const secondScenarioMonth = addMonths(currentYearMonth, 2);

    await createLocalHousehold(window, evaluatedAtIso);
    seedCashflowScenarioLedger(databasePath, evaluatedAtIso);
    const snapshotBeforeScenario = readLedgerSnapshot(databasePath);
    await window.reload();
    await new AppShellPage(window).openPlanningTools();

    const section = getScenarioSection(window);
    await expect(section).toBeVisible();
    await addScenarioAssumption(section, {
      kind: "recurring-expense",
      amount: "100",
      currencyCode: "NOK",
      dateIso: `${firstScenarioMonth}-15`,
      durationMonths: "2",
    });
    const comparison = await compareScenario(section);

    await expect(
      getScenarioMonth(comparison, currentYearMonth)
        .getByRole("group", { name: "Scenario cashflow", exact: true })
    ).toContainText(/400,00/);
    await expect(
      getScenarioMonth(comparison, firstScenarioMonth)
        .getByRole("group", { name: "Scenario cashflow", exact: true })
    ).toContainText(/200,00/);
    await expect(
      getScenarioMonth(comparison, secondScenarioMonth)
        .getByRole("group", { name: "Scenario cashflow", exact: true })
    ).toContainText(/200,00/);
    expect(readLedgerSnapshot(databasePath)).toEqual(snapshotBeforeScenario);
  });

  test("edits a temporary assumption before comparing without changing actual records", async ({
    databasePath,
    window,
  }) => {
    const evaluatedAtIso = new Date().toISOString();
    const firstScenarioMonth = addMonths(evaluatedAtIso.slice(0, 7), 1);

    await createLocalHousehold(window, evaluatedAtIso);
    seedCashflowScenarioLedger(databasePath, evaluatedAtIso);
    const snapshotBeforeScenario = readLedgerSnapshot(databasePath);
    await window.reload();
    await new AppShellPage(window).openPlanningTools();

    const section = getScenarioSection(window);
    await expect(section).toBeVisible();
    await addScenarioAssumption(section, {
      kind: "one-time-expense",
      amount: "100",
      currencyCode: "NOK",
      dateIso: `${firstScenarioMonth}-15`,
    });
    await window.setViewportSize({ width: 1280, height: 800 });
    const editButton = section.getByRole("button", { name: /^Edit One-time expense/ });
    await editButton.focus();
    await expect(editButton).toBeFocused();
    await window.keyboard.press("Enter");
    await section.getByLabel("Scenario amount").fill("200");
    const saveButton = section.getByRole("button", { name: "Save adjustment", exact: true });
    await saveButton.focus();
    await window.keyboard.press("Enter");
    await expect(section).toContainText(/200,00/);
    const comparison = await compareScenario(section);

    await expect(
      getScenarioMonth(comparison, firstScenarioMonth)
        .getByRole("group", { name: "Scenario cashflow", exact: true })
    ).toContainText(/100,00/);
    expect(readLedgerSnapshot(databasePath)).toEqual(snapshotBeforeScenario);
  });

  test("displays equivalent assumptions identically regardless of entry order", async ({
    databasePath,
    window,
  }) => {
    const evaluatedAtIso = new Date().toISOString();
    const firstScenarioMonth = addMonths(evaluatedAtIso.slice(0, 7), 1);
    const secondScenarioMonth = addMonths(evaluatedAtIso.slice(0, 7), 2);

    await createLocalHousehold(window, evaluatedAtIso);
    seedCashflowScenarioLedger(databasePath, evaluatedAtIso);
    const snapshotBeforeScenario = readLedgerSnapshot(databasePath);
    await window.reload();
    await new AppShellPage(window).openPlanningTools();

    const section = getScenarioSection(window);
    await expect(section).toBeVisible();
    const incomeReduction = {
      kind: "income-change" as const,
      direction: "reduction" as const,
      amount: "100",
      currencyCode: "NOK",
      dateIso: `${firstScenarioMonth}-15`,
      durationMonths: "2",
    };
    const oneTimeExpense = {
      kind: "one-time-expense" as const,
      amount: "50",
      currencyCode: "NOK",
      dateIso: `${secondScenarioMonth}-15`,
    };

    await addScenarioAssumption(section, incomeReduction);
    await addScenarioAssumption(section, oneTimeExpense);
    const firstComparison = await compareScenario(section);
    await expect(firstComparison).toBeVisible();
    const firstOutput = await firstComparison.innerText();

    await section.getByRole("button", { name: "Reset scenario", exact: true }).click();
    await addScenarioAssumption(section, oneTimeExpense);
    await addScenarioAssumption(section, incomeReduction);
    const secondComparison = await compareScenario(section);
    await expect(secondComparison).toBeVisible();

    expect(await secondComparison.innerText()).toBe(firstOutput);
    expect(readLedgerSnapshot(databasePath)).toEqual(snapshotBeforeScenario);
  });

  test("uses an explicitly selected latest rate only for a foreign-currency scenario", async ({
    databasePath,
    window,
  }) => {
    const evaluatedAtIso = new Date().toISOString();
    const firstScenarioMonth = addMonths(evaluatedAtIso.slice(0, 7), 1);

    await createLocalHousehold(window, evaluatedAtIso);
    seedCashflowScenarioLedger(databasePath, evaluatedAtIso, {
      futureRateDate: `${firstScenarioMonth}-20`,
    });
    const snapshotBeforeScenario = readLedgerSnapshot(databasePath);
    await window.reload();
    await new AppShellPage(window).openPlanningTools();

    const section = getScenarioSection(window);
    await expect(section).toBeVisible();
    await addScenarioAssumption(section, {
      kind: "one-time-expense",
      amount: "100",
      currencyCode: "EUR",
      dateIso: `${firstScenarioMonth}-15`,
    });
    await section.getByRole("checkbox", {
      name: "Use latest stored rates for foreign-currency assumptions",
      exact: true,
    }).check();
    const comparison = await compareScenario(section);

    await expect(comparison).toContainText("latest stored rate");
    await expect(comparison).toContainText("scenario only");
    const appliedAssumptions = comparison.getByRole("group", {
      name: "Applied scenario assumptions",
      exact: true,
    });
    await expect(appliedAssumptions).toContainText(/1[\s\u00a0\u202f.,]150,00/);
    await expect(appliedAssumptions).toContainText("11.5 NOK per EUR");
    await expect(appliedAssumptions).toContainText(`${firstScenarioMonth}-20`);
    expect(readLedgerSnapshot(databasePath)).toEqual(snapshotBeforeScenario);
  });

  test("shows an incomplete state when selected account balances are unverified", async ({
    databasePath,
    window,
  }) => {
    const evaluatedAtIso = new Date().toISOString();

    await createLocalHousehold(window, evaluatedAtIso);
    seedCashflowScenarioLedger(databasePath, evaluatedAtIso, {
      includeVerifiedBalance: false,
    });
    await window.reload();
    await new AppShellPage(window).openPlanningTools();

    const section = getScenarioSection(window);
    await expect(section).toBeVisible();
    const comparison = await compareScenario(section);

    await expect(comparison).toContainText("incomplete");
    await expect(comparison).toContainText("balance");
  });

  test("shows an incomplete state for a confirmed variable commitment with no known amount", async ({
    databasePath,
    window,
  }) => {
    const evaluatedAtIso = new Date().toISOString();

    await createLocalHousehold(window, evaluatedAtIso);
    seedCashflowScenarioLedger(databasePath, evaluatedAtIso, {
      includeVariableCommitment: true,
    });
    await window.reload();
    await new AppShellPage(window).openPlanningTools();

    const section = getScenarioSection(window);
    await expect(section).toBeVisible();
    const comparison = await compareScenario(section);

    await expect(comparison).toContainText("incomplete");
    await expect(comparison).toContainText("variable");
  });

  test("shows an incomplete state when a foreign-currency assumption has no applicable rate", async ({
    databasePath,
    window,
  }) => {
    const evaluatedAtIso = new Date().toISOString();
    const firstScenarioMonth = addMonths(evaluatedAtIso.slice(0, 7), 1);

    await createLocalHousehold(window, evaluatedAtIso);
    seedCashflowScenarioLedger(databasePath, evaluatedAtIso);
    await window.reload();
    await new AppShellPage(window).openPlanningTools();

    const section = getScenarioSection(window);
    await expect(section).toBeVisible();
    await addScenarioAssumption(section, {
      kind: "one-time-expense",
      amount: "100",
      currencyCode: "EUR",
      dateIso: `${firstScenarioMonth}-15`,
    });
    const comparison = await compareScenario(section);

    await expect(comparison).toContainText("incomplete");
    await expect(comparison).toContainText("EUR");
    await expect(comparison).toContainText(/rate/i);
  });
});

function getScenarioSection(window: Page): Locator {
  return window.getByRole("region", {
    name: "Cashflow scenarios",
    exact: true,
  });
}

function getScenarioMonth(comparison: Locator, yearMonth: string): Locator {
  return comparison.getByRole("group", {
    name: `Scenario month ${yearMonth}`,
    exact: true,
  });
}

async function addScenarioAssumption(
  section: Locator,
  values: {
    kind: "income-change" | "recurring-expense" | "one-time-expense";
    amount: string;
    currencyCode: string;
    dateIso: string;
    direction?: "increase" | "reduction";
    durationMonths?: string;
  }
): Promise<void> {
  await section.getByLabel("Scenario adjustment type").selectOption(values.kind);
  if (values.direction !== undefined) {
    await section.getByLabel("Income change direction").selectOption(values.direction);
  }
  await section.getByLabel("Scenario amount").fill(values.amount);
  await section.getByLabel("Scenario currency").fill(values.currencyCode);
  await section.getByLabel(
    values.kind === "one-time-expense" ? "Scenario expense date" : "Scenario start date"
  ).fill(values.dateIso);
  if (values.durationMonths !== undefined) {
    await section.getByLabel("Duration (months)").fill(values.durationMonths);
  }
  await section.getByRole("button", { name: "Add adjustment", exact: true }).click();
}

async function compareScenario(section: Locator): Promise<Locator> {
  await section.getByRole("button", { name: "Compare scenario", exact: true }).click();
  return section.getByRole("status", {
    name: "Scenario comparison",
    exact: true,
  });
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
  await new AppShellPage(window).openWorkspace("Review");
  await expect(window.getByRole("region", { name: "Review workspace", exact: true }))
    .toHaveAttribute("aria-busy", "false");
  await expect(window.getByRole("region", {
    name: "Recurring commitments", exact: true, includeHidden: true,
  })).toHaveAttribute("aria-busy", "false");
}

function seedCashflowScenarioLedger(
  databasePath: string,
  evaluatedAtIso: string,
  options: {
    includeVerifiedBalance?: boolean;
    includeVariableCommitment?: boolean;
    futureRateDate?: string;
  } = {}
): void {
  const ledger = createLocalLedgerDatabase({ dbPath: databasePath });
  const metadata = ledger.loadRuntimeMetadata();
  if (metadata === null) throw new Error("Synthetic household setup failed.");
  const account = metadata.accounts[0]!;
  const evaluatedYearMonth = evaluatedAtIso.slice(0, 7);
  const historyMonths = [
    addMonths(evaluatedYearMonth, -3),
    addMonths(evaluatedYearMonth, -2),
    addMonths(evaluatedYearMonth, -1),
  ];
  const monthlyAmounts = [50_000, 40_000, 30_000];
  const transactions: Transaction[] = historyMonths.map((yearMonth, index) => ({
    id: `scenario-history-${yearMonth}`,
    householdId: metadata.household.id,
    accountId: account.id,
    bookedAtIso: `${yearMonth}-15T12:00:00.000Z`,
    amountMinor: monthlyAmounts[index]!,
    merchantRaw: `Synthetic income ${yearMonth}`,
    currencyCode: "NOK",
    sourceType: "manual",
  }));
  const initialSnapshot = ledger.loadLedgerSnapshotData();
  ledger.replaceLedgerSnapshotData({ ...initialSnapshot, transactions });

  const latestHistoryMonth = historyMonths[historyMonths.length - 1]!;
  const balanceDateRange = monthDateRange(latestHistoryMonth);
  const period: AccountStatementCoveragePeriod = {
    id: "scenario-coverage",
    accountId: account.id,
    startDateIso: balanceDateRange.startDateIso,
    endDateIso: balanceDateRange.endDateIso,
    currencyCode: "NOK",
    sourceName: "synthetic-scenario-statement.csv",
    sourceType: "manual",
    confirmed: true,
    confirmedAtIso: evaluatedAtIso,
  };
  const openingBalance: AccountBalanceCheckpoint = {
    id: "scenario-opening",
    accountId: account.id,
    dateIso: balanceDateRange.startDateIso,
    currencyCode: "NOK",
    balanceMinor: 160_000,
    source: "Synthetic scenario statement",
    recordedAtIso: evaluatedAtIso,
  };
  const closingBalance: AccountBalanceCheckpoint = {
    id: "scenario-closing",
    accountId: account.id,
    dateIso: balanceDateRange.endDateIso,
    currencyCode: "NOK",
    balanceMinor: 190_000,
    source: "Synthetic scenario statement",
    recordedAtIso: evaluatedAtIso,
  };

  try {
    if (options.includeVerifiedBalance !== false) {
      ledger.saveAccountStatementCoveragePeriod(period);
      ledger.appendAccountBalanceCheckpoint(openingBalance);
      ledger.appendAccountBalanceCheckpoint(closingBalance);
    }

    let commitmentId = 0;
    const commitments = createRecurringCommitmentService(ledger, {
      createId: () => `scenario-commitment-${commitmentId++}`,
      now: () => new Date(evaluatedAtIso),
    });
    const suggested = commitments.create({
      description: "Synthetic rent",
      currencyCode: "NOK",
      amountMinor: 10_000,
      isVariable: false,
      cadence: "monthly",
      firstDueDateIso: `${addMonths(evaluatedYearMonth, 1)}-15`,
      activeFromIso: evaluatedAtIso.slice(0, 10),
    });
    commitments.confirm(suggested.id);

    if (options.includeVariableCommitment) {
      const variable = commitments.create({
        description: "Synthetic variable bill",
        currencyCode: "NOK",
        amountMinor: null,
        isVariable: true,
        cadence: "monthly",
        firstDueDateIso: `${addMonths(evaluatedYearMonth, 1)}-15`,
        activeFromIso: evaluatedAtIso.slice(0, 10),
      });
      commitments.confirm(variable.id);
    }

    if (options.futureRateDate !== undefined) {
      ledger.upsertExchangeRate({
        id: "scenario-future-eur-rate",
        currencyCode: "EUR",
        rateNokPerUnit: "11.5",
        effectiveDate: options.futureRateDate,
        kind: "dated",
        source: "Synthetic future scenario rate",
        provenance: "manual",
      });
    }

    const loans = createLoanRegistry(ledger, {
      createId: () => "scenario-mortgage",
      now: () => new Date(evaluatedAtIso),
    });
    const mortgage = loans.create({
      label: "Synthetic mortgage",
      principalMinor: 30_000_000,
      annualInterestRateBasisPoints: 500,
      termMonths: 300,
      paymentAmountMinor: 1_750_000,
      paymentFrequency: "monthly",
      currencyCode: "NOK",
    });
    loans.appendBalance({
      loanId: mortgage.id,
      effectiveDateIso: evaluatedAtIso.slice(0, 10),
      amountMinor: 29_900_000,
    });
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

function addMonths(yearMonth: string, offset: number): string {
  const [yearText, monthText] = yearMonth.split("-");
  const absoluteMonth = Number(yearText) * 12 + Number(monthText) - 1 + offset;
  const year = Math.floor(absoluteMonth / 12);
  const month = (absoluteMonth % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function monthDateRange(yearMonth: string): { startDateIso: string; endDateIso: string } {
  const [yearText, monthText] = yearMonth.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    startDateIso: `${yearMonth}-01`,
    endDateIso: `${yearMonth}-${String(lastDay).padStart(2, "0")}`,
  };
}

async function expectNoHorizontalOverflow(window: Page): Promise<void> {
  const horizontalOverflow = await window.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(horizontalOverflow).toBe(false);
}
