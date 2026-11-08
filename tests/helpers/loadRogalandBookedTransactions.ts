import { expect } from "vitest";
import type { Transaction } from "../../src/domain/types.js";
import { importFixtureCsv } from "../../src/tooling/fixtures/fixtureTransactions.js";

/** Explicit booked projection of the mixed-status synthetic Rogaland fixture. */
export function loadRogalandBookedTransactions(path: string): Transaction[] {
  const result = importFixtureCsv(path);
  expect(result.skipped).toEqual([]);
  expect(result.transactions).toHaveLength(14);
  expect(result.pendingObservations).toMatchObject([
    { sourceRowIndex: 0, amountMinor: -4500, status: "reserved" },
    { sourceRowIndex: 1, amountMinor: -35000, status: "confirmed" },
  ]);
  return result.transactions;
}
