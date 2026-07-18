import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { exportCsv, exportCsvToFile } from "../../src/app/exportCsv.js";
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

  it("exportCsvToFile does not invoke fetch", () => {
    const transactions = buildTransactionsFromFixturePath(FIXTURE_PATH);
    const tempDir = mkdtempSync(join(tmpdir(), "budget-export-no-network-"));
    const outputPath = join(tempDir, "export.csv");
    let fetchCalled = false;
    (globalThis as unknown as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };

    try {
      const result = exportCsvToFile({ transactions, outputPath });
      expect(result.rowCount).toBeGreaterThan(0);
      expect(fetchCalled).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
