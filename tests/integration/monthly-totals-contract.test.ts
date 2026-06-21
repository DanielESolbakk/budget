import { describe, expect, it } from "vitest";
import { queryMonthlyTotals } from "../../src/app/dashboardApi.js";
import { readFixtureCsv, rowsToObjects } from "../../src/tooling/fixtures/fixtureCsv.js";
import type { Transaction } from "../../src/domain/types.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv";

function toMinorUnits(value: string): number {
  const amount = Number.parseFloat(value || "0");
  return Math.round(Math.abs(amount) * 100);
}

function toIsoDate(date: string): string {
  const [day, month, year] = date.split(".");
  return `${year}-${month}-${day}T00:00:00Z`;
}

function loadFixtureTransactions(): Transaction[] {
  const parsed = readFixtureCsv(FIXTURE_PATH);
  const rows = rowsToObjects(parsed);

  return rows.map((row, index) => {
    const amountInMinor = toMinorUnits(row["Beløp inn"] ?? "");
    const amountOutMinor = toMinorUnits(row["Beløp ut"] ?? "");

    return {
      id: `fixture-${index + 1}`,
      householdId: "hh-fixture",
      accountId: "acc-fixture",
      bookedAtIso: toIsoDate(row["Utført dato"] ?? ""),
      amountMinor: amountInMinor > 0 ? amountInMinor : -amountOutMinor,
      merchantRaw: row.Beskrivelse ?? "Unknown"
    };
  });
}

describe("monthly totals contract", () => {
  const transactions = loadFixtureTransactions();

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
