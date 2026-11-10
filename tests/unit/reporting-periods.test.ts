import { describe, expect, it } from "vitest";
import { computeDateRangeTotals } from "../../src/domain/aggregation/computeMonthlyTotals.js";
import { computeCategoryBreakdownForDateRange } from "../../src/domain/aggregation/computeCategoryBreakdown.js";
import { buildDashboardViewContract } from "../../src/shared/dashboard.js";
import {
  getAdjacentReportingPeriod,
  resolveCurrentReportingPeriod,
  resolveReportingPeriod,
} from "../../src/domain/date/reportingPeriods.js";
import {
  type ReportingPeriodRule,
  DEFAULT_REPORTING_PERIOD_RULE,
  validateReportingPeriodRule,
} from "../../src/shared/applicationPreferences.js";
import type { Account, ExchangeRate, Transaction } from "../../src/domain/types.js";

describe("reporting period boundaries", () => {
  it("clamps fixed-day boundaries independently to each month's last day", () => {
    expect(resolveReportingPeriod({ type: "fixed-day", dayOfMonth: 31 }, "2026-01")).toEqual({
      startDateIso: "2026-01-31",
      endDateExclusiveIso: "2026-02-28",
    });
  });

  it("uses the first day of a month for calendar-month reporting", () => {
    expect(resolveReportingPeriod(DEFAULT_REPORTING_PERIOD_RULE, "2026-02")).toEqual({
      startDateIso: "2026-02-01",
      endDateExclusiveIso: "2026-03-01",
    });
  });

  it("clamps fixed-day reporting to leap day without carrying the clamp into March", () => {
    expect(resolveReportingPeriod({ type: "fixed-day", dayOfMonth: 31 }, "2028-02")).toEqual({
      startDateIso: "2028-02-29",
      endDateExclusiveIso: "2028-03-31",
    });
  });

  it("uses the last configured weekday in each month", () => {
    expect(resolveReportingPeriod({ type: "last-weekday", weekday: 4 }, "2026-10")).toEqual({
      startDateIso: "2026-10-29",
      endDateExclusiveIso: "2026-11-26",
    });
  });

  it("selects the preceding payday period before the current month's boundary", () => {
    expect(resolveCurrentReportingPeriod({ type: "last-weekday", weekday: 4 }, "2026-11-10")).toEqual({
      startDateIso: "2026-10-29",
      endDateExclusiveIso: "2026-11-26",
    });
  });

  it("selects the next payday period on its exact boundary", () => {
    expect(resolveCurrentReportingPeriod({ type: "last-weekday", weekday: 4 }, "2026-11-26")).toEqual({
      startDateIso: "2026-11-26",
      endDateExclusiveIso: "2026-12-31",
    });
  });

  it("navigates adjacent periods across a year boundary", () => {
    expect(getAdjacentReportingPeriod({ type: "last-weekday", weekday: 4 }, "2026-12-31", "next")).toEqual({
      startDateIso: "2027-01-28",
      endDateExclusiveIso: "2027-02-25",
    });
  });

  it("rejects malformed reporting preferences instead of substituting a default", () => {
    expect(validateReportingPeriodRule({ type: "last-weekday", weekday: 4 }))
      .toEqual({ type: "last-weekday", weekday: 4 });
    for (const invalidRule of [
      { type: "fixed-day", dayOfMonth: 0 },
      { type: "fixed-day", dayOfMonth: 32 },
      { type: "fixed-day", dayOfMonth: 1.5 },
      { type: "last-weekday", weekday: 8 },
      { type: "unknown" },
    ]) {
      expect(() => validateReportingPeriodRule(invalidRule)).toThrow();
    }
  });

  it("rejects invalid dates and empty or reversed reporting ranges", () => {
    expect(() => resolveCurrentReportingPeriod(
      { type: "calendar-month" },
      "2026-02-30"
    )).toThrow(RangeError);
    expect(() => computeDateRangeTotals([], "2026-02-01", "2026-02-01")).toThrow(RangeError);
    expect(() => computeCategoryBreakdownForDateRange(
      [],
      "2026-03-01",
      "2026-02-28"
    )).toThrow(RangeError);
  });

  it("aggregates transactions across the inclusive start and exclusive end dates", () => {
    const transactions: Transaction[] = [
      {
        id: "before", householdId: "hh-1", accountId: "acc-1",
        bookedAtIso: "2026-10-28T23:59:59Z", amountMinor: 90_000, merchantRaw: "Before",
      },
      {
        id: "start", householdId: "hh-1", accountId: "acc-1",
        bookedAtIso: "2026-10-29T00:00:00Z", amountMinor: 50_000, merchantRaw: "Start",
      },
      {
        id: "last-included", householdId: "hh-1", accountId: "acc-1",
        bookedAtIso: "2026-11-25T23:59:59Z", amountMinor: -10_000, merchantRaw: "Last included",
      },
      {
        id: "end", householdId: "hh-1", accountId: "acc-1",
        bookedAtIso: "2026-11-26T00:00:00Z", amountMinor: -80_000, merchantRaw: "End",
      },
    ];

    expect(computeDateRangeTotals(transactions, "2026-10-29", "2026-11-26")).toEqual({
      startDateIso: "2026-10-29",
      endDateExclusiveIso: "2026-11-26",
      incomeMinor: 50_000,
      expenseMinor: 10_000,
      netMinor: 40_000,
    });
  });

  it("returns zero totals and no categories for an empty payday period", () => {
    expect(computeDateRangeTotals([], "2026-10-29", "2026-11-26")).toEqual({
      startDateIso: "2026-10-29",
      endDateExclusiveIso: "2026-11-26",
      incomeMinor: 0,
      expenseMinor: 0,
      netMinor: 0,
    });
    expect(computeCategoryBreakdownForDateRange([], "2026-10-29", "2026-11-26"))
      .toEqual({ yearMonth: "2026-10", entries: [] });
  });

  it("uses the same exclusive date range for category spending across months", () => {
    const transactions: Transaction[] = [
      {
        id: "before", householdId: "hh-1", accountId: "acc-1",
        bookedAtIso: "2026-10-28T00:00:00Z", amountMinor: -3_000,
        merchantRaw: "Before", categoryId: "groceries",
      },
      {
        id: "start", householdId: "hh-1", accountId: "acc-1",
        bookedAtIso: "2026-10-29T00:00:00Z", amountMinor: -1_000,
        merchantRaw: "Start", categoryId: "groceries",
      },
      {
        id: "last-included", householdId: "hh-1", accountId: "acc-1",
        bookedAtIso: "2026-11-25T00:00:00Z", amountMinor: -2_500,
        merchantRaw: "Last included", categoryId: "groceries",
      },
      {
        id: "end", householdId: "hh-1", accountId: "acc-1",
        bookedAtIso: "2026-11-26T00:00:00Z", amountMinor: -5_000,
        merchantRaw: "End", categoryId: "groceries",
      },
    ];

    expect(computeCategoryBreakdownForDateRange(
      transactions,
      "2026-10-29",
      "2026-11-26",
      "spending"
    )).toEqual({
      yearMonth: "2026-10",
      entries: [
        { categoryId: "groceries", label: "groceries", totalMinor: 3_500, transactionCount: 2 },
      ],
    });
  });

  it("uses the selected payday range for dashboard totals and categories", () => {
    const transactions: Transaction[] = [
      {
        id: "before", householdId: "hh-1", accountId: "acc-1",
        bookedAtIso: "2026-10-28T00:00:00Z", amountMinor: -3_000,
        merchantRaw: "Before", categoryId: "groceries",
      },
      {
        id: "start", householdId: "hh-1", accountId: "acc-1",
        bookedAtIso: "2026-10-29T00:00:00Z", amountMinor: 50_000,
        merchantRaw: "Start", categoryId: "salary",
      },
      {
        id: "last-included", householdId: "hh-1", accountId: "acc-1",
        bookedAtIso: "2026-11-25T00:00:00Z", amountMinor: -10_000,
        merchantRaw: "Last included", categoryId: "groceries",
      },
      {
        id: "end", householdId: "hh-1", accountId: "acc-1",
        bookedAtIso: "2026-11-26T00:00:00Z", amountMinor: -80_000,
        merchantRaw: "End", categoryId: "groceries",
      },
    ];
    const reportingPeriodRule: ReportingPeriodRule = { type: "last-weekday", weekday: 4 };
    const input = {
      transactions,
      selectedYearMonth: "2026-10",
      reportingPeriodRule,
    };

    const view = buildDashboardViewContract(input);
    expect(view.state).toBe("ready");
    if (view.state !== "ready") return;
    expect(view.snapshot.monthlyTotals).toEqual({
      yearMonth: "2026-10",
      incomeMinor: 50_000,
      expenseMinor: 10_000,
      netMinor: 40_000,
    });
    expect(view.snapshot.categoryBreakdown.entries).toEqual([
      { categoryId: "salary", label: "salary", totalMinor: 50_000, transactionCount: 1 },
      { categoryId: "groceries", label: "groceries", totalMinor: 10_000, transactionCount: 1 },
    ]);
  });

  it("uses the transaction-date FX rate and preserves missing-rate native subtotals", () => {
    const accounts: Account[] = [
      { id: "acc-eur", householdId: "hh-1", name: "Synthetic EUR", currencyCode: "EUR" },
      { id: "acc-sek", householdId: "hh-1", name: "Synthetic SEK", currencyCode: "SEK" },
    ];
    const transactions: Transaction[] = [
      {
        id: "eur-in-range", householdId: "hh-1", accountId: "acc-eur",
        bookedAtIso: "2026-11-25T12:00:00Z", amountMinor: -10_000,
        merchantRaw: "Synthetic EUR expense", currencyCode: "EUR", categoryId: "groceries",
      },
      {
        id: "sek-in-range", householdId: "hh-1", accountId: "acc-sek",
        bookedAtIso: "2026-11-25T12:00:00Z", amountMinor: -5_000,
        merchantRaw: "Synthetic SEK expense", currencyCode: "SEK", categoryId: "groceries",
      },
      {
        id: "eur-at-exclusive-end", householdId: "hh-1", accountId: "acc-eur",
        bookedAtIso: "2026-11-26T00:00:00Z", amountMinor: -20_000,
        merchantRaw: "Outside payday period", currencyCode: "EUR", categoryId: "groceries",
      },
    ];
    const rates: ExchangeRate[] = [
      {
        id: "eur-transaction-date", currencyCode: "EUR", rateNokPerUnit: "11.5",
        effectiveDate: "2026-11-25", kind: "dated", source: "Synthetic transaction-date rate",
        provenance: "manual",
      },
      {
        id: "eur-later", currencyCode: "EUR", rateNokPerUnit: "12",
        effectiveDate: "2026-11-26", kind: "dated", source: "Synthetic later rate",
        provenance: "manual",
      },
    ];
    const view = buildDashboardViewContract({
      transactions,
      accounts,
      rates,
      selectedYearMonth: "2026-10",
      reportingPeriodRule: { type: "last-weekday", weekday: 4 },
    });
    if (view.state === "loading") throw new Error("A synchronous projection must not be loading.");

    expect(view.snapshot.reportingPeriodRange).toEqual({
      startDateIso: "2026-10-29",
      endDateExclusiveIso: "2026-11-26",
    });
    expect(view.snapshot.monthlyTotals).toEqual({
      yearMonth: "2026-10",
      incomeMinor: 0,
      expenseMinor: 115_000,
      netMinor: -115_000,
    });
    expect(view.snapshot.currencyReport?.transactions.map((transaction) => transaction.transactionId).sort())
      .toEqual(["eur-in-range", "sek-in-range"]);
    expect(view.snapshot.currencyReport?.transactions.find(
      (transaction) => transaction.transactionId === "eur-in-range"
    )).toMatchObject({
      nativeAmountMinor: -10_000,
      nokAmountMinor: -115_000,
      exchangeRate: rates[0],
    });
    expect(view.snapshot.currencyReport).toMatchObject({
      nokSubtotalMinor: null,
      incompleteCurrencies: ["SEK"],
      nativeSubtotals: [
        { currencyCode: "EUR", totalMinor: -10_000 },
        { currencyCode: "SEK", totalMinor: -5_000 },
      ],
    });
  });
});
