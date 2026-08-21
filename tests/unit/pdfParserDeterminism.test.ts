import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePdfStatementWithRegisteredAdapter } from "../../src/domain/import/parserAdapterRegistry.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-statement.txt";

const OPTIONS = {
  householdId: "hh-determinism",
  accountId: "acc-determinism",
  importJobId: "job-determinism",
  idPrefix: "job-determinism",
};

describe("pdf parser determinism", () => {
  it("returns identical ordered candidates across repeated runs", () => {
    const text = readFileSync(FIXTURE_PATH, "utf8");

    const first = parsePdfStatementWithRegisteredAdapter(text, OPTIONS);
    const second = parsePdfStatementWithRegisteredAdapter(text, OPTIONS);

    expect(first).toEqual(second);
  });

  it("preserves stable transaction order from the source rows", () => {
    const text = readFileSync(FIXTURE_PATH, "utf8");
    const result = parsePdfStatementWithRegisteredAdapter(text, OPTIONS);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const bookedDates = result.transactions.map((transaction) => transaction.bookedAtIso);

    expect(bookedDates.slice(0, 3)).toEqual([
      "2026-05-27T00:00:00Z",
      "2026-05-26T00:00:00Z",
      "2026-05-25T00:00:00Z",
    ]);
  });
});
