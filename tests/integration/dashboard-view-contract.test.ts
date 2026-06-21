import { describe, expect, it } from "vitest";
import {
  buildDashboardViewContract,
  refreshDashboardViewContractMonth,
} from "../../src/app/dashboardApi.js";
import type { Transaction } from "../../src/domain/types.js";

function makeTx(
  overrides: Partial<Transaction> & { amountMinor: number; bookedAtIso: string }
): Transaction {
  return {
    id: crypto.randomUUID(),
    householdId: "hh-1",
    accountId: "acc-1",
    merchantRaw: "Test Merchant",
    ...overrides,
  };
}

const transactions: Transaction[] = [
  makeTx({ id: "m1", bookedAtIso: "2026-05-01T10:00:00Z", amountMinor: 80000, categoryId: "salary" }),
  makeTx({ id: "m2", bookedAtIso: "2026-05-05T11:00:00Z", amountMinor: -20000, categoryId: "groceries" }),
  makeTx({ id: "j1", bookedAtIso: "2026-06-01T10:00:00Z", amountMinor: 30000, categoryId: "salary" }),
  makeTx({ id: "j2", bookedAtIso: "2026-06-10T11:00:00Z", amountMinor: -5000, categoryId: "transport" }),
];

describe("dashboard view contract", () => {
  it("AC-1: returns monthly totals and category breakdown for selected month", () => {
    const view = buildDashboardViewContract({
      transactions,
      selectedYearMonth: "2026-05",
    });

    expect(view.state).toBe("ready");
    if (view.state !== "ready") {
      return;
    }

    expect(view.snapshot.selectedYearMonth).toBe("2026-05");
    expect(view.snapshot.monthlyTotals).toEqual({
      yearMonth: "2026-05",
      incomeMinor: 80000,
      expenseMinor: 20000,
      netMinor: 60000,
    });
    expect(view.snapshot.categoryBreakdown.yearMonth).toBe("2026-05");
    expect(view.snapshot.categoryBreakdown.entries.length).toBeGreaterThan(0);
  });

  it("AC-2: month refresh returns deterministic updated values", () => {
    const mayView = refreshDashboardViewContractMonth(transactions, "2026-05");
    const juneView = refreshDashboardViewContractMonth(transactions, "2026-06");
    const juneViewRepeated = refreshDashboardViewContractMonth(transactions, "2026-06");

    expect(mayView).not.toEqual(juneView);
    expect(juneView).toEqual(juneViewRepeated);

    if (juneView.state !== "ready") {
      return;
    }

    expect(juneView.snapshot.monthlyTotals).toEqual({
      yearMonth: "2026-06",
      incomeMinor: 30000,
      expenseMinor: 5000,
      netMinor: 25000,
    });
  });

  it("AC-3: supports explicit loading and empty states", () => {
    const loadingView = buildDashboardViewContract({
      transactions,
      selectedYearMonth: "2026-05",
      isLoading: true,
    });
    expect(loadingView).toEqual({
      state: "loading",
      selectedYearMonth: "2026-05",
    });

    const emptyView = buildDashboardViewContract({
      transactions,
      selectedYearMonth: "2026-07",
    });
    expect(emptyView.state).toBe("empty");
    if (emptyView.state !== "empty") {
      return;
    }

    expect(emptyView.snapshot.monthlyTotals).toEqual({
      yearMonth: "2026-07",
      incomeMinor: 0,
      expenseMinor: 0,
      netMinor: 0,
    });
    expect(emptyView.snapshot.categoryBreakdown.entries).toEqual([]);
  });
});
