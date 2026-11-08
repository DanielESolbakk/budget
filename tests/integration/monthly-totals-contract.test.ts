import { describe, expect, it } from "vitest";
import { queryMonthlyTotals } from "../../src/app/dashboardApi.js";
import { buildBookedDashboardFixture } from "../helpers/buildBookedDashboardFixture.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv";

describe("monthly totals contract", () => {
  const transactions = buildBookedDashboardFixture(FIXTURE_PATH);

  it("keeps all synthetic dashboard rows, signs and category indexes explicit", () => {
    expect(transactions.map((transaction) => transaction.amountMinor)).toEqual([
      -4500, -35000, -600, -100000, 5000000, -9770, -45800, -7800, -97310, -14500, 0, 0, 0, 0, 0, 0,
    ]);
    const categorized = buildBookedDashboardFixture(FIXTURE_PATH, { 4: "salary", 3: "groceries", 8: "groceries" });
    expect(categorized.filter((transaction) => transaction.categoryId !== undefined).map(({ amountMinor, categoryId }) => ({ amountMinor, categoryId }))).toEqual([
      { amountMinor: -100000, categoryId: "groceries" },
      { amountMinor: 5000000, categoryId: "salary" },
      { amountMinor: -97310, categoryId: "groceries" },
    ]);
  });
  it("AC-1: returns income, expense, and net for a requested month", () => {
    const result = queryMonthlyTotals(transactions, "2026-05");

    expect(result).toEqual({
      yearMonth: "2026-05",
      incomeMinor: 5000000,
      expenseMinor: 315280,
      netMinor: 4684720
    });
  });

  it("AC-2: returns identical totals for repeated requests with the same fixture", () => {
    const first = queryMonthlyTotals(transactions, "2026-05");
    const second = queryMonthlyTotals(transactions, "2026-05");

    expect(first).toEqual(second);
  });

  it("AC-3: returns explicit zero totals for an empty month with no null/undefined fields", () => {
    const result = queryMonthlyTotals(transactions, "2026-04");

    expect(result).toEqual({
      yearMonth: "2026-04",
      incomeMinor: 0,
      expenseMinor: 0,
      netMinor: 0
    });
  });
});
