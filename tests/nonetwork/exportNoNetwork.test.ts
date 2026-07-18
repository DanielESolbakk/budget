import { afterEach, describe, expect, it } from "vitest";
import { exportCsv } from "../../src/app/exportCsv.js";
import { buildCsvOutput } from "../../src/domain/export/buildCsvRows.js";
import { buildTransactionsFromFixturePath } from "../../src/tooling/fixtures/fixtureTransactions.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv";

describe("export no-network verification", () => {
  const originalFetch = (globalThis as unknown as { fetch?: unknown }).fetch;

  afterEach(() => {
    (globalThis as unknown as { fetch?: unknown }).fetch = originalFetch;
  });

  it("exportCsv does not invoke fetch", () => {
    const transactions = buildTransactionsFromFixturePath(FIXTURE_PATH);
    let fetchCalled = false;
    (globalThis as unknown as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };

    const result = exportCsv({ transactions });

    expect(result.rowCount).toBeGreaterThan(0);
    expect(fetchCalled).toBe(false);
  });

  it("buildCsvOutput does not invoke fetch", () => {
    const transactions = buildTransactionsFromFixturePath(FIXTURE_PATH);
    let fetchCalled = false;
    (globalThis as unknown as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };

    const csvText = buildCsvOutput(transactions);

    expect(csvText.length).toBeGreaterThan(0);
    expect(fetchCalled).toBe(false);
  });

  it("exportCsv produces identical results on repeated offline calls (determinism)", () => {
    const transactions = buildTransactionsFromFixturePath(FIXTURE_PATH);
    let fetchCalled = false;
    (globalThis as unknown as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };

    const first = exportCsv({ transactions });
    const second = exportCsv({ transactions });

    expect(first.csvText).toBe(second.csvText);
    expect(first.rowCount).toBe(second.rowCount);
    expect(fetchCalled).toBe(false);
  });
});
