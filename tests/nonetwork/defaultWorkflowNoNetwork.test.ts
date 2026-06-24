import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { UNCATEGORIZED_LABEL, queryCategoryBreakdown } from "../../src/app/dashboardApi.js";
import { runDefaultLocalWorkflow } from "../../src/app/runDefaultLocalWorkflow.js";
import { parseFixtureCsv, rowsToObjects } from "../../src/tooling/fixtures/fixtureCsv.js";
import type { Transaction } from "../../src/domain/types.js";

// ---------------------------------------------------------------------------
// Fixture helpers (mirrors category-breakdown.test.ts)
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

// Row 4 → salary, rows 3 and 8 → groceries; all others remain uncategorized.
const CATEGORY_ASSIGNMENTS: Record<number, string> = {
  4: "salary",
  3: "groceries",
  8: "groceries",
};

const fixtureTransactions = buildTransactionsFromFixture(fixtureRows, CATEGORY_ASSIGNMENTS);

// ---------------------------------------------------------------------------
// Default local workflow – no-network
// ---------------------------------------------------------------------------

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
    const first = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    const second = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    expect(first).toEqual(second);
  });

  it("orders categorized entries by totalMinor descending on repeated calls", () => {
    const first = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    const second = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    const categorized = first.entries.filter(e => e.categoryId !== null);
    const categorized2 = second.entries.filter(e => e.categoryId !== null);
    expect(categorized.map(e => e.categoryId)).toEqual(categorized2.map(e => e.categoryId));
    for (let i = 0; i < categorized.length - 1; i++) {
      expect(categorized[i]!.totalMinor).toBeGreaterThanOrEqual(categorized[i + 1]!.totalMinor);
    }
  });

  it("places the uncategorized bucket last", () => {
    const result = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    const last = result.entries.at(-1);
    expect(last?.categoryId).toBeNull();
    expect(last?.label).toBe(UNCATEGORIZED_LABEL);
  });

  it("uncategorized bucket shape is stable across repeated identical fixture calls", () => {
    const first = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    const second = queryCategoryBreakdown(fixtureTransactions, "2026-05");
    const uncategorized1 = first.entries.find(e => e.categoryId === null);
    const uncategorized2 = second.entries.find(e => e.categoryId === null);
    expect(uncategorized1).toEqual(uncategorized2);
    expect(uncategorized1?.transactionCount).toBeGreaterThan(0);
  });
});