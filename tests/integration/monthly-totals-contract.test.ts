import { describe, expect, it } from "vitest";
import { queryMonthlyTotals } from "../../src/app/dashboardApi.js";
import { readFixtureCsv, rowsToObjects } from "../../src/tooling/fixtures/fixtureCsv.js";
import type { Transaction } from "../../src/domain/types.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv";

function toMinorUnits(value: string): number {
  const normalized = value.trim();
  if (normalized === "") return 0;

  const amount = Number.parseFloat(normalized);
  if (!Number.isFinite(amount)) {
    throw new Error(`Invalid amount value: "${value}"`);
  }

  return Math.round(amount * 100);
}

function toIsoDate(date: string): string {
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(date)) {
    throw new Error(`Invalid fixture date: "${date}"`);
  }
  const [day, month, year] = date.split(".");
  return `${year}-${month}-${day}T00:00:00Z`;
}

function parseFixtureTransactions(): Transaction[] {
  const parsed = readFixtureCsv(FIXTURE_PATH);
  const rows = rowsToObjects(parsed);

  return rows.map((row, index) => {
    const amountInMinor = toMinorUnits(row["Beløp inn"] ?? "");
    const amountOutMinor = toMinorUnits(row["Beløp ut"] ?? "");
    if (amountInMinor !== 0 && amountOutMinor !== 0) {
      throw new Error(`Row ${index + 2} has both Beløp inn and Beløp ut populated.`);
    }

    return {
      id: `fixture-${index + 1}`,
      householdId: "hh-fixture",
      accountId: "acc-fixture",
      bookedAtIso: toIsoDate(row["Utført dato"] ?? ""),
      amountMinor:
        amountInMinor !== 0
          ? amountInMinor
          : amountOutMinor !== 0
            ? -Math.abs(amountOutMinor)
            : 0,
      merchantRaw: row.Beskrivelse ?? "Unknown"
    };
  });
}

describe("monthly totals contract", () => {
  const transactions = parseFixtureTransactions();

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
