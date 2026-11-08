import { addMinorUnits as addSafeMinorUnits } from "../domain/money/minorUnits.js";
import { nextYearMonth } from "../domain/date/calendarDate.js";
import { buildDashboardData, queryHouseholdDashboardData } from "./dashboardApi.js";
import { createRecurringCommitmentService } from "./recurringCommitmentService.js";
import { createSpendableCashService } from "./spendableCashService.js";
import type { LocalLedgerDatabase } from "./backup/localLedgerSqlite.js";
import { convertCurrencyAmount } from "../domain/money/convertCurrencyAmount.js";
import {
  calculateCashflowScenario,
  validateCashflowScenarioRequest,
  type CashflowScenarioIncompleteReason,
  type CashflowScenarioRequest,
  type CashflowScenarioResult,
} from "../domain/forecast/cashflowScenarios.js";

export interface CashflowScenarioServiceOptions {
  now?: () => Date;
}

export interface CashflowScenarioService {
  getScenario: (input: CashflowScenarioRequest) => CashflowScenarioResult;
}

function addMinorUnits(total: number, amountMinor: number): number {
  return addSafeMinorUnits(total, amountMinor, "Cashflow scenario exceeds the safe integer range.");
}

function removeLinkedCommitmentPaymentsFromHistory(
  database: LocalLedgerDatabase,
  householdId: string,
  monthlyTotals: readonly { yearMonth: string; totalMinor: number }[],
  includedCommitmentIds: ReadonlySet<string>,
  incompleteCurrencyMonths: readonly string[],
  rates: ReturnType<LocalLedgerDatabase["listExchangeRates"]>
): Array<{ yearMonth: string; totalMinor: number }> {
  const historyMonths = new Set(monthlyTotals.slice(-3).map(({ yearMonth }) => yearMonth));
  if (historyMonths.size === 0 || includedCommitmentIds.size === 0) {
    return [...monthlyTotals];
  }

  const accountsById = new Map(
    database.getAccountsForHousehold(householdId).map((account) => [account.id, account])
  );
  const adjustmentsByMonth = new Map<string, number>();
  for (const link of database.listRecurringCommitmentPaymentLinks(householdId)) {
    if (!includedCommitmentIds.has(link.commitmentId) || link.transactionId === undefined) {
      continue;
    }

    const transaction = database.getTransactionById(link.transactionId);
    if (transaction === undefined || transaction.householdId !== householdId) {
      throw new Error(`Linked commitment payment ${link.id} has no household transaction.`);
    }
    if (transaction.amountMinor >= 0) {
      throw new Error(`Linked commitment payment ${link.id} is not an outgoing transaction.`);
    }

    const yearMonth = transaction.bookedAtIso.slice(0, 7);
    if (!historyMonths.has(yearMonth)) continue;

    const account = accountsById.get(transaction.accountId);
    if (account === undefined) {
      throw new Error(`Linked commitment payment ${link.id} has no household account.`);
    }
    const conversion = convertCurrencyAmount({
      amountMinor: transaction.amountMinor,
      currencyCode: transaction.currencyCode ?? account.currencyCode,
      asOfDateIso: transaction.bookedAtIso.slice(0, 10),
      rates,
    });
    if (conversion.state === "incomplete") {
      if (!incompleteCurrencyMonths.includes(yearMonth)) {
        throw new Error(
          `NOK dashboard totals omitted missing currency history for linked payment ${link.id}.`
        );
      }
      continue;
    }

    adjustmentsByMonth.set(
      yearMonth,
      addMinorUnits(adjustmentsByMonth.get(yearMonth) ?? 0, conversion.nokAmountMinor)
    );
  }

  return monthlyTotals.map((month) => {
    const linkedPaymentAmount = adjustmentsByMonth.get(month.yearMonth);
    return linkedPaymentAmount === undefined
      ? month
      : {
          ...month,
          totalMinor: addMinorUnits(month.totalMinor, -linkedPaymentAmount),
        };
  });
}

function mapBaselineReason(
  reason: {
    code: string;
    message: string;
    currencyCode?: string;
    dateIso?: string;
  }
): CashflowScenarioIncompleteReason {
  switch (reason.code) {
    case "no-accounts-selected":
    case "unknown-account":
    case "missing-balance":
    case "stale-balance":
    case "unverified-balance":
    case "missing-exchange-rate":
    case "unknown-variable-commitment":
    case "missing-reconciled-transaction":
    case "invalid-reconciled-transaction":
      return {
        code: reason.code,
        message: reason.message,
        ...(reason.currencyCode === undefined ? {} : { currencyCode: reason.currencyCode }),
        ...(reason.dateIso === undefined ? {} : { dateIso: reason.dateIso }),
      };
    default:
      return {
        code: "missing-balance",
        message: reason.message,
      };
  }
}

export function createCashflowScenarioService(
  database: LocalLedgerDatabase,
  options: CashflowScenarioServiceOptions = {}
): CashflowScenarioService {
  const now = options.now ?? (() => new Date());

  function getScenario(input: CashflowScenarioRequest): CashflowScenarioResult {
    const request = validateCashflowScenarioRequest(input);
    const evaluatedAt = now();
    const evaluatedAtIso = evaluatedAt.toISOString();
    const runtimeMetadata = database.loadRuntimeMetadata();
    if (runtimeMetadata === null) {
      throw new Error("Local household is not available for a cashflow scenario.");
    }

    const dashboard = queryHouseholdDashboardData(database, runtimeMetadata.household.id);
    const rates = database.listExchangeRates();
    const initialForecastEntries = dashboard.forecast.entries;
    if (initialForecastEntries.length !== 3) {
      throw new Error("The household forecast must contain exactly three months.");
    }
    const horizonEndExclusive = `${nextYearMonth(initialForecastEntries.at(-1)!.yearMonth)}-01`;
    const evaluatedDateIso = evaluatedAtIso.slice(0, 10);
    const scheduledCommitments = createRecurringCommitmentService(database, {
      now: () => evaluatedAt,
    }).getSchedule(evaluatedAtIso, horizonEndExclusive);
    const includedCommitmentIds = new Set(
      scheduledCommitments.occurrences
        .filter((occurrence) =>
          occurrence.dueDateIso >= evaluatedDateIso &&
          occurrence.dueDateIso < horizonEndExclusive
        )
        .map(({ commitmentId }) => commitmentId)
    );
    const baselineMonthlyTotals = removeLinkedCommitmentPaymentsFromHistory(
      database,
      runtimeMetadata.household.id,
      dashboard.monthlyTotals,
      includedCommitmentIds,
      dashboard.incompleteCurrencyMonths ?? [],
      rates
    );
    const adjustedForecastEntries = buildDashboardData({
      monthlyTotals: baselineMonthlyTotals,
      fallbackStartYearMonth: evaluatedAtIso.slice(0, 7),
    }).forecast.entries.map(({ yearMonth, projectedMinor }) => ({
      yearMonth,
      netCashflowNokMinor: projectedMinor,
    }));

    if (
      adjustedForecastEntries.length !== 3 ||
      adjustedForecastEntries.some((entry, index) =>
        entry.yearMonth !== initialForecastEntries[index]?.yearMonth
      )
    ) {
      throw new Error("The household forecast horizon changed while adjusting linked payments.");
    }
    const baselineMonthlyCashflows = adjustedForecastEntries;
    const estimate = createSpendableCashService(database, {
      now: () => evaluatedAt,
    }).getEstimate({
      selectedAccountIds: database
        .getAccountsForHousehold(runtimeMetadata.household.id)
        .map((account) => account.id),
      nextIncomeDateIso: horizonEndExclusive,
      reserveMinor: 0,
    });

    const baselineIncompleteReasons: CashflowScenarioIncompleteReason[] = [];
    if ((dashboard.incompleteCurrencyMonths?.length ?? 0) > 0) {
      baselineIncompleteReasons.push({
        code: "baseline-currency-history-incomplete",
        message: `NOK history is incomplete for ${dashboard.incompleteCurrencyMonths!.join(", ")}.`,
      });
    }
    if (estimate.state === "incomplete") {
      baselineIncompleteReasons.push(...estimate.incompleteReasons.map(mapBaselineReason));
    }

    let startingCashNokMinor = 0;
    let baselineCashEvents: Array<{
      id: string;
      dateIso: string;
      description: string;
      amountNokMinor: number;
    }> = [];
    if (estimate.state === "complete") {
      startingCashNokMinor = estimate.selectedAccounts.reduce(
        (total, account) => addMinorUnits(total, account.balanceNokMinor),
        0
      );
      for (const lineItem of estimate.lineItems) {
        if (lineItem.dateIso <= evaluatedAtIso.slice(0, 10)) {
          startingCashNokMinor = addMinorUnits(
            startingCashNokMinor,
            lineItem.amountNokMinor
          );
        }
      }
      baselineCashEvents = estimate.lineItems
        .filter((lineItem) => lineItem.dateIso > evaluatedAtIso.slice(0, 10))
        .map((lineItem) => ({
          id: lineItem.id,
          dateIso: lineItem.dateIso,
          description: lineItem.description,
          amountNokMinor: lineItem.amountNokMinor,
        }));
    }

    return calculateCashflowScenario({
      evaluatedAtIso,
      startingCashNokMinor,
      baselineMonthlyCashflows,
      baselineCashEvents,
      assumptions: request.assumptions,
      rates,
      useLatestRateScenario: request.useLatestRateScenario,
      ...(baselineIncompleteReasons.length === 0
        ? {}
        : { baselineIncompleteReasons }),
    });
  }

  return { getScenario };
}
