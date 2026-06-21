import { describe, expect, it } from "vitest";
import {
  renderMonthlyDashboardView,
  switchMonthlyDashboardMonth,
} from "../../src/renderer/dashboard/monthlyDashboardView.js";
import type { Transaction } from "../../src/domain/types.js";

const transactions: Transaction[] = [
  {
    id: "tx-1",
    householdId: "hh-1",
    accountId: "acc-1",
    bookedAtIso: "2026-05-02T10:00:00Z",
    amountMinor: 50000,
    merchantRaw: "Lønn AS",
    categoryId: "salary",
  },
  {
    id: "tx-2",
    householdId: "hh-1",
    accountId: "acc-1",
    bookedAtIso: "2026-05-10T10:00:00Z",
    amountMinor: -10000,
    merchantRaw: "Rema 1000",
    categoryId: "groceries",
  },
  {
    id: "tx-3",
    householdId: "hh-1",
    accountId: "acc-1",
    bookedAtIso: "2026-06-10T10:00:00Z",
    amountMinor: 40000,
    merchantRaw: "Lønn AS",
    categoryId: "salary",
  },
];

describe("dashboard month switch smoke", () => {
  it("renders month data and refreshes deterministically when switching month", () => {
    const may = renderMonthlyDashboardView({
      transactions,
      selectedYearMonth: "2026-05",
    });
    expect(may.state).toBe("ready");
    if (may.state !== "ready") {
      return;
    }
    expect(may.snapshot.monthlyTotals.netMinor).toBe(40000);

    const june = switchMonthlyDashboardMonth(may, transactions, "2026-06");
    const juneAgain = switchMonthlyDashboardMonth(may, transactions, "2026-06");

    expect(june).toEqual(juneAgain);
    expect(june).not.toEqual(may);
    expect(june.state).toBe("ready");
    if (june.state !== "ready") {
      return;
    }
    expect(june.snapshot.monthlyTotals.netMinor).toBe(40000);

    const juneNoChange = switchMonthlyDashboardMonth(june, transactions, "2026-06");
    expect(juneNoChange).toBe(june);
  });
});
