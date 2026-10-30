import { describe, expect, it } from "vitest";
import {
  buildDashboardViewContract,
  createMonthlyCategoryTargetStore,
  getMonthlyAttentionSummary,
  refreshDashboardViewContractMonth,
} from "../../src/app/dashboardApi.js";
import type { Account, ExchangeRate, Transaction } from "../../src/domain/types.js";

const accounts: Account[] = [
  { id: "account", householdId: "household", name: "Synthetic account", currencyCode: "NOK" },
];
const transactions: Transaction[] = [
  {
    id: "income", householdId: "household", accountId: "account",
    bookedAtIso: "2026-05-20T00:00:00Z", amountMinor: 100_000,
    merchantRaw: "SYNTHETIC SALARY", currencyCode: "NOK", categoryId: "income",
  },
  {
    id: "nok", householdId: "household", accountId: "account",
    bookedAtIso: "2026-05-20T00:00:00Z", amountMinor: -4200,
    merchantRaw: "SYNTHETIC GROCERIES", currencyCode: "NOK", categoryId: "groceries",
  },
  {
    id: "gbp", householdId: "household", accountId: "account",
    bookedAtIso: "2026-05-20T00:00:00Z", amountMinor: -7800,
    merchantRaw: "SYNTHETIC FOREIGN", currencyCode: "GBP",
  },
];
const datedRate: ExchangeRate = {
  id: "gbp-rate", currencyCode: "GBP", rateNokPerUnit: "12.5",
  effectiveDate: "2026-05-19", kind: "dated", source: "Synthetic local rate",
  provenance: "manual",
};

function snapshotFor(
  inputTransactions = transactions,
  rates: ExchangeRate[] = [],
  inputAccounts = accounts,
) {
  const input = {
    transactions: inputTransactions,
    selectedYearMonth: "2026-05",
    accounts: inputAccounts,
    rates,
    monthlyCategoryTargetStore: createMonthlyCategoryTargetStore([
      { yearMonth: "2026-05", categoryId: "groceries", targetMinor: 5000 },
    ]),
  };
  const view = buildDashboardViewContract(input);
  if (view.state === "loading") throw new Error("A synchronous projection must not be loading.");
  return view;
}

describe("currency-aware monthly review", () => {
  it("retains raw uncategorized attention when the amount cannot be converted", () => {
    expect(getMonthlyAttentionSummary(snapshotFor())).toMatchObject({
      hasUncategorizedTransactions: true,
      categoryReviewCount: 1,
    });
  });

  it("preserves currency context during a month refresh", () => {
    const refreshed = refreshDashboardViewContractMonth(transactions, "2026-05", undefined, {
      accounts,
      rates: [datedRate],
    });
    if (refreshed.state === "loading") throw new Error("A synchronous refresh must not be loading.");
    expect(refreshed.snapshot.monthlyTotals.expenseMinor).toBe(101_700);
    expect(refreshed.snapshot.currencyReport?.incompleteCurrencies).toEqual([]);
  });

  it("keeps 10,000 mixed-currency records separate and reconciles their converted totals", () => {
    const many: Transaction[] = Array.from({ length: 10_000 }, (_, index) => ({
      ...transactions[2]!,
      id: `synthetic-${index}`,
      amountMinor: index % 2 === 0 ? -100 : -200,
      currencyCode: index % 2 === 0 ? "GBP" : "NOK",
    }));
    const partial = snapshotFor(many);
    expect(partial.snapshot.monthlyTotals.expenseMinor).toBe(1_000_000);
    expect(partial.snapshot.currencyReport?.nativeSubtotals).toEqual([
      { currencyCode: "GBP", totalMinor: -500_000 },
      { currencyCode: "NOK", totalMinor: -1_000_000 },
    ]);
    expect(snapshotFor(many, [datedRate]).snapshot.monthlyTotals.expenseMinor).toBe(7_250_000);
  });

  it("excludes unconverted foreign units from the known NOK headline and retains their native subtotal", () => {
    const { snapshot } = snapshotFor();
    expect(snapshot.monthlyTotals).toEqual({
      yearMonth: "2026-05", incomeMinor: 100_000, expenseMinor: 4200, netMinor: 95_800,
    });
    expect(snapshot.currencyReport?.incompleteCurrencies).toEqual(["GBP"]);
    expect(snapshot.currencyReport?.nokSubtotalMinor).toBeNull();
    expect(snapshot.currencyReport?.nativeSubtotals).toEqual([
      { currencyCode: "GBP", totalMinor: -7800 },
      { currencyCode: "NOK", totalMinor: 95_800 },
    ]);
    expect(snapshot.categoryReviewCount).toBe(1);
    expect(snapshot.categoryBreakdown.entries.some((entry) => entry.categoryId === null)).toBe(false);
  });

  it("uses the applicable dated rate consistently for headline, category and target actuals", () => {
    const foreign = { ...transactions[2]!, categoryId: "groceries" };
    const { snapshot } = snapshotFor([...transactions.slice(0, 2), foreign], [datedRate]);
    expect(snapshot.monthlyTotals).toEqual({
      yearMonth: "2026-05", incomeMinor: 100_000, expenseMinor: 101_700, netMinor: -1700,
    });
    expect(snapshot.categoryBreakdown.entries.find((entry) => entry.categoryId === "groceries")?.totalMinor)
      .toBe(101_700);
    expect(snapshot.targetVsActualCategoryRows.rows.find((row) => row.categoryId === "groceries"))
      .toEqual({ categoryId: "groceries", targetMinor: 5000, actualMinor: 101_700, deltaMinor: 96_700 });
    expect(snapshot.currencyReport?.incompleteCurrencies).toEqual([]);
    expect(snapshot.currencyReport?.transactions.find((transaction) => transaction.transactionId === "gbp"))
      .toMatchObject({ nativeAmountMinor: -7800, nokAmountMinor: -97_500, exchangeRate: datedRate });
    expect(foreign.amountMinor).toBe(-7800);
    expect(foreign.currencyCode).toBe("GBP");
  });

  it("does not use a future dated rate or an unselected monthly-reference estimate", () => {
    const { snapshot } = snapshotFor(transactions, [
      { ...datedRate, effectiveDate: "2026-05-21" },
      { ...datedRate, id: "monthly-rate", kind: "monthly-reference" },
    ]);
    expect(snapshot.monthlyTotals.expenseMinor).toBe(4200);
    expect(snapshot.currencyReport?.incompleteCurrencies).toEqual(["GBP"]);
  });

  it("uses account currency for legacy records without an explicit transaction currency", () => {
    const legacy = { ...transactions[2]! };
    delete legacy.currencyCode;
    const { snapshot } = snapshotFor([legacy], [datedRate], [{ ...accounts[0]!, currencyCode: "GBP" }]);
    expect(snapshot.monthlyTotals.expenseMinor).toBe(97_500);
    expect(snapshot.currencyReport?.nativeSubtotals).toEqual([{ currencyCode: "GBP", totalMinor: -7800 }]);
  });

  it("retains a populated incomplete month when none of its transactions can be converted", () => {
    const view = snapshotFor([transactions[2]!]);
    expect(view.state).toBe("ready");
    expect(view.snapshot.monthlyTotals).toEqual({
      yearMonth: "2026-05", incomeMinor: 0, expenseMinor: 0, netMinor: 0,
    });
    expect(view.snapshot.currencyReport?.incompleteCurrencies).toEqual(["GBP"]);
    expect(view.snapshot.categoryReviewCount).toBe(1);
  });

  it("reconciles allocation rounding to the converted source amount without mutating native splits", () => {
    const split: Transaction = {
      ...transactions[2]!, amountMinor: -2,
      categoryAllocations: [
        { categoryId: "groceries", amountMinor: -1 },
        { categoryId: "transport", amountMinor: -1 },
      ],
    };
    const { snapshot } = snapshotFor([split], [{ ...datedRate, rateNokPerUnit: "0.5" }]);
    expect(snapshot.monthlyTotals.expenseMinor).toBe(1);
    expect(snapshot.categoryBreakdown.entries.find((entry) => entry.categoryId === "groceries")?.totalMinor)
      .toBe(1);
    expect(snapshot.categoryBreakdown.entries.find((entry) => entry.categoryId === "transport")?.totalMinor)
      .toBe(0);
    expect(split.categoryAllocations).toEqual([
      { categoryId: "groceries", amountMinor: -1 },
      { categoryId: "transport", amountMinor: -1 },
    ]);
  });
});
