import { afterEach, describe, expect, it } from "vitest";
import { UNCATEGORIZED_LABEL, queryCategoryBreakdown, queryMonthlyTotals } from "../../src/app/dashboardApi.js";
import { runDefaultLocalWorkflow } from "../../src/app/runDefaultLocalWorkflow.js";
import type { Transaction } from "../../src/domain/types.js";
import { readFixtureCsv, rowsToObjects } from "../../src/tooling/fixtures/fixtureCsv.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv";

function toMinorUnits(value: string): number {
  const normalized = value.trim();
  if (normalized === "") {
    return 0;
  }

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

function parseFixtureTransactions(
  categoryAssignments: Record<number, string> = {}
): Transaction[] {
  const parsed = readFixtureCsv(FIXTURE_PATH);
  const rows = rowsToObjects(parsed);

  return rows.map((row, index) => {
    const amountInMinor = toMinorUnits(row["Beløp inn"] ?? "");
    const amountOutMinor = toMinorUnits(row["Beløp ut"] ?? "");
    if (amountInMinor !== 0 && amountOutMinor !== 0) {
      throw new Error(`Row ${index + 2} has both Beløp inn and Beløp ut populated.`);
    }

    const tx: Transaction = {
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
      merchantRaw: row.Beskrivelse ?? "Unknown",
    };

    const assignedCategory = categoryAssignments[index];
    if (assignedCategory !== undefined) {
      tx.categoryId = assignedCategory;
    }

    return tx;
  });
}

// Row 4 → salary, rows 3 and 8 → groceries; all others remain uncategorized.
const CATEGORY_ASSIGNMENTS: Record<number, string> = {
  4: "salary",
  3: "groceries",
  8: "groceries",
};

describe("default workflow no-network verification", () => {
  const originalFetch = (globalThis as unknown as { fetch?: unknown }).fetch;

  afterEach(() => {
    (globalThis as unknown as { fetch?: unknown }).fetch = originalFetch;
  });

  it("does not invoke fetch in default local workflow", () => {
    let fetchCalled = false;
    (globalThis as unknown as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };

    const output = runDefaultLocalWorkflow({ merchantRaw: " Vy " });
    expect(output.normalizedMerchant).toBe("VY");
    expect(fetchCalled).toBe(false);
  });

  it("queryMonthlyTotals stays local-only and deterministic for fixture requests", () => {
    const transactions = parseFixtureTransactions();
    let fetchCalled = false;
    (globalThis as unknown as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };

    const first = queryMonthlyTotals(transactions, "2026-05");
    const second = queryMonthlyTotals(transactions, "2026-05");

    expect(first).toEqual({
      yearMonth: "2026-05",
      incomeMinor: 5000000,
      expenseMinor: 315280,
      netMinor: 4684720
    });
    expect(second).toEqual(first);
    expect(fetchCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// queryCategoryBreakdown – no-network verification (issue #110)
// ---------------------------------------------------------------------------

describe("queryCategoryBreakdown no-network verification", () => {
  const originalFetch = (globalThis as unknown as { fetch?: unknown }).fetch;

  afterEach(() => {
    (globalThis as unknown as { fetch?: unknown }).fetch = originalFetch;
  });

  it("does not invoke fetch during queryCategoryBreakdown execution", () => {
    const fixtureTransactions = parseFixtureTransactions(CATEGORY_ASSIGNMENTS);
    let fetchCalled = false;
    (globalThis as unknown as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };

    const result = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    expect(result.entries.length).toBeGreaterThan(0);
    expect(fetchCalled).toBe(false);
  });

  it("produces identical results on repeated calls with the same fixture input (determinism)", () => {
    const fixtureTransactions = parseFixtureTransactions(CATEGORY_ASSIGNMENTS);
    const first = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    const second = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    expect(first).toEqual(second);
  });

  it("orders categorized entries by totalMinor descending", () => {
    const fixtureTransactions = parseFixtureTransactions(CATEGORY_ASSIGNMENTS);
    const result = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    const categorized = result.entries.filter(e => e.categoryId !== null);
    for (let i = 0; i < categorized.length - 1; i++) {
      expect(categorized[i]!.totalMinor).toBeGreaterThanOrEqual(categorized[i + 1]!.totalMinor);
    }
  });

  it("places the uncategorized bucket last", () => {
    const fixtureTransactions = parseFixtureTransactions(CATEGORY_ASSIGNMENTS);
    const result = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    const last = result.entries.at(-1);
    expect(last?.categoryId).toBeNull();
    expect(last?.label).toBe(UNCATEGORIZED_LABEL);
  });

  it("uncategorized bucket shape is stable across repeated identical fixture calls", () => {
    const fixtureTransactions = parseFixtureTransactions(CATEGORY_ASSIGNMENTS);
    const first = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    const second = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    const uncategorized1 = first.entries.find(e => e.categoryId === null);
    const uncategorized2 = second.entries.find(e => e.categoryId === null);
    expect(uncategorized1).toEqual(uncategorized2);
    expect(uncategorized1?.transactionCount).toBeGreaterThan(0);
  });
});
