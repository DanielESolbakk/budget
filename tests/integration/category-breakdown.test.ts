import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  UNCATEGORIZED_LABEL,
  queryCategoryBreakdown,
} from "../../src/app/dashboardApi.js";
import { parseFixtureCsv, rowsToObjects } from "../../src/tooling/fixtures/fixtureCsv.js";
import type { Transaction } from "../../src/domain/types.js";

// ---------------------------------------------------------------------------
// Fixture loading helpers
// ---------------------------------------------------------------------------

function parseDateToIso(ddMmYyyy: string): string {
  const parts = ddMmYyyy.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Error(`parseDateToIso: expected DD.MM.YYYY, got "${ddMmYyyy}"`);
  }
  return `${parts[2]}-${parts[1]}-${parts[0]}T00:00:00Z`;
}

function buildTransactionsFromFixture(
  rows: Array<Record<string, string>>,
  categoryAssignments: Record<number, string> = {}
): Transaction[] {
  return rows.map((row, index) => {
    const dateRaw = row["Bokført dato"] || row["Utført dato"] || "";
    const bookedAtIso = parseDateToIso(dateRaw);
    const amountIn = parseFloat(row["Beløp inn"] || "0") || 0;
    const amountOut = parseFloat(row["Beløp ut"] || "0") || 0;
    // "Beløp inn" is already a positive number; "Beløp ut" is already negative in the CSV.
    // Summing them gives the correct signed amountMinor (positive = income, negative = expense).
    const amountMinor = Math.round((amountIn + amountOut) * 100);
    const tx: Transaction = {
      id: `fixture-${index + 1}`,
      householdId: "hh-fixture",
      accountId: "acc-fixture",
      bookedAtIso,
      amountMinor,
      merchantRaw: row["Beskrivelse"] ?? "",
    };
    const assignedCategory = categoryAssignments[index];
    if (assignedCategory !== undefined) {
      tx.categoryId = assignedCategory;
    }
    return tx;
  });
}

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv";
const fixtureRows = rowsToObjects(parseFixtureCsv(readFileSync(FIXTURE_PATH, "utf8")));

// Assign categories to specific fixture rows (0-indexed):
//   row 4 (SALARY, +50000.00 NOK)  → "salary"
//   row 3 (MERCHANT_003, -1000.00 NOK) → "groceries"
//   row 8 (MERCHANT_008, -973.10 NOK)  → "groceries"
//   all remaining rows: uncategorized
const CATEGORY_ASSIGNMENTS: Record<number, string> = {
  4: "salary",
  3: "groceries",
  8: "groceries",
};

const fixtureTransactions = buildTransactionsFromFixture(fixtureRows, CATEGORY_ASSIGNMENTS);

// Expected totals derived from fixture amounts (in minor units, øre):
//   salary:      abs(50000.00 × 100) = 5_000_000
//   groceries:   abs(-1000.00 × 100) + abs(-973.10 × 100) = 100_000 + 97_310 = 197_310
//   uncategorized: sum of all remaining absolute values
//     MERCHANT_001 (-45.00):   4_500
//     PAYMENT_EF  (-350.00):  35_000
//     MERCHANT_002  (-6.00):     600
//     MERCHANT-005 (-97.70):   9_770
//     MERCHANT_005(-458.00):  45_800
//     MERCHANT_007 (-78.00):   7_800
//     MERCHANT_009(-145.00):  14_500
//                          --------
//                           117_970
const EXPECTED_SALARY_TOTAL = 5_000_000;
const EXPECTED_GROCERIES_TOTAL = 197_310;
const EXPECTED_UNCATEGORIZED_TOTAL = 117_970;

// ---------------------------------------------------------------------------
// AC-1: Category breakdown query returns category amount rows for a month
// ---------------------------------------------------------------------------

describe("queryCategoryBreakdown – AC-1: category rows for fixture month", () => {
  it("returns entries for the 2026-05 fixture month", () => {
    const result = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    expect(result.yearMonth).toBe("2026-05");
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it("returns the correct totalMinor for the salary category", () => {
    const result = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    const salary = result.entries.find(e => e.categoryId === "salary");
    expect(salary).toBeDefined();
    expect(salary?.totalMinor).toBe(EXPECTED_SALARY_TOTAL);
    expect(salary?.transactionCount).toBe(1);
  });

  it("returns the correct totalMinor for the groceries category", () => {
    const result = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    const groceries = result.entries.find(e => e.categoryId === "groceries");
    expect(groceries).toBeDefined();
    expect(groceries?.totalMinor).toBe(EXPECTED_GROCERIES_TOTAL);
    expect(groceries?.transactionCount).toBe(2);
  });

  it("returns an empty entries array when queried for a month with no transactions", () => {
    const result = queryCategoryBreakdown(fixtureTransactions, "2026-03");
    expect(result.entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC-2: Repeating the same request returns identical deterministic order
// ---------------------------------------------------------------------------

describe("queryCategoryBreakdown – AC-2: deterministic ordering", () => {
  it("produces identical results on repeated calls with the same fixture input", () => {
    const first = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    const second = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    expect(first).toEqual(second);
  });

  it("orders categorized entries by totalMinor descending", () => {
    const result = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    const categorized = result.entries.filter(e => e.categoryId !== null);
    for (let i = 0; i < categorized.length - 1; i++) {
      expect(categorized[i]!.totalMinor).toBeGreaterThanOrEqual(categorized[i + 1]!.totalMinor);
    }
  });

  it("places salary before groceries because its total is larger", () => {
    const result = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    const salaryIndex = result.entries.findIndex(e => e.categoryId === "salary");
    const groceriesIndex = result.entries.findIndex(e => e.categoryId === "groceries");
    expect(salaryIndex).toBeLessThan(groceriesIndex);
  });
});

// ---------------------------------------------------------------------------
// AC-3: Uncategorized transactions appear in an explicit predictable bucket
// ---------------------------------------------------------------------------

describe("queryCategoryBreakdown – AC-3: uncategorized bucket", () => {
  it("places the uncategorized entry last", () => {
    const result = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    const last = result.entries.at(-1);
    expect(last?.categoryId).toBeNull();
  });

  it("assigns the stable UNCATEGORIZED_LABEL to the uncategorized entry", () => {
    const result = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    const uncategorized = result.entries.find(e => e.categoryId === null);
    expect(uncategorized?.label).toBe(UNCATEGORIZED_LABEL);
  });

  it("sums all uncategorized fixture transactions correctly", () => {
    const result = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    const uncategorized = result.entries.find(e => e.categoryId === null);
    expect(uncategorized?.totalMinor).toBe(EXPECTED_UNCATEGORIZED_TOTAL);
    expect(uncategorized?.transactionCount).toBe(7);
  });

  it("represents uncategorized as a single bucket even when all transactions lack a category", () => {
    const allUncategorized = buildTransactionsFromFixture(fixtureRows);
    const result = queryCategoryBreakdown(allUncategorized, "2026-05");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.categoryId).toBeNull();
    expect(result.entries[0]?.label).toBe(UNCATEGORIZED_LABEL);
    expect(result.entries[0]?.transactionCount).toBe(fixtureRows.length);
  });

  it("omits the uncategorized bucket when all transactions have a category", () => {
    const allCategorized: Transaction[] = fixtureTransactions.map(tx => ({
      ...tx,
      categoryId: "shopping",
    }));
    const result = queryCategoryBreakdown(allCategorized, "2026-05");
    const hasUncategorized = result.entries.some(e => e.categoryId === null);
    expect(hasUncategorized).toBe(false);
  });
});
