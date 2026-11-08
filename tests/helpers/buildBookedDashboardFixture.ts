import type { Transaction } from "../../src/domain/types.js";
import { readFixtureCsv, rowsToObjects } from "../../src/tooling/fixtures/fixtureCsv.js";
import { buildTransactionsFromFixtureRows } from "../../src/tooling/fixtures/fixtureTransactions.js";

/** Reporting-only synthetic projection: all source rows are treated as booked,
 * preserving the original dashboard totals. Not an import-status expectation. */
export function buildBookedDashboardFixture(
  path: string,
  categoryAssignments: Record<number, string> = {}
): Transaction[] {
  const rows = rowsToObjects(readFixtureCsv(path)).map((row) => ({ ...row, Status: "Bokført" }));
  return buildTransactionsFromFixtureRows(rows).map((transaction, index) => {
    const categoryId = categoryAssignments[index];
    return categoryId === undefined ? transaction : { ...transaction, categoryId };
  });
}
