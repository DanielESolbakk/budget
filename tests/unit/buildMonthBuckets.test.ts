import { describe, expect, it } from "vitest";
import { buildMonthBuckets } from "../../src/domain/forecast/aggregationAdapter.js";
import type { Transaction } from "../../src/domain/types.js";

function createTransaction(id: string, bookedAtIso: string, amountMinor: number): Transaction {
  return {
    id,
    householdId: "hh-1",
    accountId: "acc-1",
    bookedAtIso,
    amountMinor,
    merchantRaw: "Test Merchant"
  };
}

describe("buildMonthBuckets", () => {
  it("AC-1: returns deterministic month ordering independent of transaction input order", () => {
    const transactionsA: Transaction[] = [
      createTransaction("tx-1", "2026-03-02T00:00:00Z", -1000),
      createTransaction("tx-2", "2026-01-15T00:00:00Z", 5000),
      createTransaction("tx-3", "2026-03-20T00:00:00Z", 2000),
      createTransaction("tx-4", "2026-01-25T00:00:00Z", -3000)
    ];

    const transactionsB: Transaction[] = [
      transactionsA[1]!,
      transactionsA[3]!,
      transactionsA[0]!,
      transactionsA[2]!
    ];

    const expected = [
      { yearMonth: "2026-01", totalMinor: 2000 },
      { yearMonth: "2026-02", totalMinor: 0 },
      { yearMonth: "2026-03", totalMinor: 1000 }
    ];

    expect(buildMonthBuckets(transactionsA)).toEqual(expected);
    expect(buildMonthBuckets(transactionsB)).toEqual(expected);
  });

  it("AC-2: inserts missing months with explicit zero totals", () => {
    const transactions: Transaction[] = [
      createTransaction("tx-1", "2026-01-03T00:00:00Z", 1000),
      createTransaction("tx-2", "2026-03-03T00:00:00Z", 400)
    ];

    expect(buildMonthBuckets(transactions)).toEqual([
      { yearMonth: "2026-01", totalMinor: 1000 },
      { yearMonth: "2026-02", totalMinor: 0 },
      { yearMonth: "2026-03", totalMinor: 400 }
    ]);
  });

  it("AC-2: keeps explicit zero-value months when transactions net to zero", () => {
    const transactions: Transaction[] = [
      createTransaction("tx-1", "2026-04-01T00:00:00Z", 1500),
      createTransaction("tx-2", "2026-04-11T00:00:00Z", -1500)
    ];

    expect(buildMonthBuckets(transactions)).toEqual([
      { yearMonth: "2026-04", totalMinor: 0 }
    ]);
  });

  it("returns an explicit empty list for empty input", () => {
    expect(buildMonthBuckets([])).toEqual([]);
  });
});
