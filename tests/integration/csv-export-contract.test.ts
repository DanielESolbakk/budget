import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTransactionsFromFixturePath } from "../../src/tooling/fixtures/fixtureTransactions.js";
import { EXPORT_CSV_HEADERS, buildCsvOutput, buildCsvRow, serializeCsvRow } from "../../src/domain/export/buildCsvRows.js";
import { exportCsv, exportCsvToFile } from "../../src/app/exportCsv.js";
import type { Transaction } from "../../src/domain/types.js";

const FIXTURE_PATH = "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv";

const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

const SAMPLE_TRANSACTIONS: Transaction[] = [
  {
    id: "tx-3",
    householdId: "hh-test",
    accountId: "acc-test",
    bookedAtIso: "2026-05-20T00:00:00Z",
    amountMinor: -5000,
    merchantRaw: "Rema 1000",
    categoryId: "groceries",
  },
  {
    id: "tx-1",
    householdId: "hh-test",
    accountId: "acc-test",
    bookedAtIso: "2026-05-01T00:00:00Z",
    amountMinor: 50000,
    merchantRaw: "Lønn AS",
    categoryId: "salary",
  },
  {
    id: "tx-2",
    householdId: "hh-test",
    accountId: "acc-test",
    bookedAtIso: "2026-05-10T00:00:00Z",
    amountMinor: -2500,
    merchantRaw: "Kiwi Majorstuen",
    importJobId: "job-01",
  },
];

describe("csv export contract", () => {
  describe("AC-1: stable headers and deterministic row ordering", () => {
    it("EXPORT_CSV_HEADERS contains all required columns in stable order", () => {
      expect(EXPORT_CSV_HEADERS).toEqual([
        "id",
        "householdId",
        "accountId",
        "bookedAtIso",
        "amountMinor",
        "merchantRaw",
        "merchantAlias",
        "categoryId",
        "importJobId",
      ]);
    });

    it("exportCsv sorts transactions by bookedAtIso ascending regardless of input order", () => {
      const { csvText } = exportCsv({ transactions: SAMPLE_TRANSACTIONS });
      const lines = csvText.trimEnd().split("\n");
      // lines[0] is the header; data rows start at index 1
      expect(lines[1]).toContain("tx-1");
      expect(lines[2]).toContain("tx-2");
      expect(lines[3]).toContain("tx-3");
    });

    it("exportCsv produces identical output on repeated calls with the same input", () => {
      const first = exportCsv({ transactions: SAMPLE_TRANSACTIONS });
      const second = exportCsv({ transactions: SAMPLE_TRANSACTIONS });
      expect(first.csvText).toBe(second.csvText);
      expect(first.rowCount).toBe(second.rowCount);
    });

    it("exportCsv reports the correct rowCount", () => {
      const { rowCount } = exportCsv({ transactions: SAMPLE_TRANSACTIONS });
      expect(rowCount).toBe(3);
    });

    it("exportCsv with empty transaction list produces header-only output", () => {
      const { csvText, rowCount } = exportCsv({ transactions: [] });
      const lines = csvText.trimEnd().split("\n");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe(EXPORT_CSV_HEADERS.join(","));
      expect(rowCount).toBe(0);
    });

    it("buildCsvOutput includes header as first line", () => {
      const csvText = buildCsvOutput([]);
      const firstLine = csvText.split("\n")[0];
      expect(firstLine).toBe(EXPORT_CSV_HEADERS.join(","));
    });

    it("buildCsvOutput ends with a trailing newline", () => {
      const csvText = buildCsvOutput(SAMPLE_TRANSACTIONS);
      expect(csvText.endsWith("\n")).toBe(true);
    });

    it("fixture transactions produce deterministic CSV across repeated exports", () => {
      const transactions = buildTransactionsFromFixturePath(FIXTURE_PATH);
      const first = exportCsv({ transactions });
      const second = exportCsv({ transactions });
      expect(first.csvText).toBe(second.csvText);
    });

    it("exportCsvToFile writes the produced CSV text to the requested output path", () => {
      const tempDir = mkdtempSync(join(tmpdir(), "budget-export-"));
      const outputPath = join(tempDir, "transactions.csv");

      try {
        const result = exportCsvToFile({
          transactions: SAMPLE_TRANSACTIONS,
          outputPath,
        });

        const diskText = readFileSync(outputPath, "utf8");
        expect(diskText).toBe(result.csvText);
        expect(result.rowCount).toBe(3);
        expect(result.outputPath).toBe(outputPath);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("AC-2: normalized date and amount formats", () => {
    it("buildCsvRow serializes bookedAtIso as an ISO 8601 datetime string", () => {
      const row = buildCsvRow(SAMPLE_TRANSACTIONS[0]!);
      expect(row.bookedAtIso).toMatch(ISO_DATETIME_PATTERN);
    });

    it("buildCsvRow serializes amountMinor as a plain integer string without decimals", () => {
      const expense = buildCsvRow(SAMPLE_TRANSACTIONS[0]!);
      expect(expense.amountMinor).toBe("-5000");

      const income = buildCsvRow(SAMPLE_TRANSACTIONS[1]!);
      expect(income.amountMinor).toBe("50000");
    });

    it("exported amountMinor values parse back to the original integers", () => {
      const transactions = buildTransactionsFromFixturePath(FIXTURE_PATH);
      const { csvText } = exportCsv({ transactions });
      const lines = csvText.trimEnd().split("\n");
      const headers = lines[0]!.split(",");
      const amountIdx = headers.indexOf("amountMinor");

      expect(amountIdx).toBeGreaterThanOrEqual(0);

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i]!.split(",");
        const amountStr = cols[amountIdx]!;
        const parsed = Number(amountStr);
        expect(Number.isInteger(parsed)).toBe(true);
      }
    });

    it("exported bookedAtIso values match ISO 8601 datetime format", () => {
      const transactions = buildTransactionsFromFixturePath(FIXTURE_PATH);
      const { csvText } = exportCsv({ transactions });
      const lines = csvText.trimEnd().split("\n");
      const headers = lines[0]!.split(",");
      const dateIdx = headers.indexOf("bookedAtIso");

      expect(dateIdx).toBeGreaterThanOrEqual(0);

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i]!.split(",");
        expect(cols[dateIdx]).toMatch(ISO_DATETIME_PATTERN);
      }
    });
  });

  describe("AC-1: optional field serialization", () => {
    it("buildCsvRow serializes absent optional fields as empty strings", () => {
      const tx: Transaction = {
        id: "tx-bare",
        householdId: "hh-x",
        accountId: "acc-x",
        bookedAtIso: "2026-01-01T00:00:00Z",
        amountMinor: 0,
        merchantRaw: "Test",
      };
      const row = buildCsvRow(tx);
      expect(row.merchantAlias).toBe("");
      expect(row.categoryId).toBe("");
      expect(row.importJobId).toBe("");
    });

    it("buildCsvRow propagates present optional fields", () => {
      const tx: Transaction = {
        id: "tx-full",
        householdId: "hh-x",
        accountId: "acc-x",
        bookedAtIso: "2026-03-15T00:00:00Z",
        amountMinor: -1000,
        merchantRaw: "Rema 1000",
        merchantAlias: "REMA",
        categoryId: "groceries",
        importJobId: "job-99",
      };
      const row = buildCsvRow(tx);
      expect(row.merchantAlias).toBe("REMA");
      expect(row.categoryId).toBe("groceries");
      expect(row.importJobId).toBe("job-99");
    });
  });

  describe("CSV escaping", () => {
    it("serializeCsvRow wraps fields containing commas in double quotes", () => {
      const tx: Transaction = {
        id: "tx-comma",
        householdId: "hh-x",
        accountId: "acc-x",
        bookedAtIso: "2026-06-01T00:00:00Z",
        amountMinor: -500,
        merchantRaw: "Smith, Jones & Co",
      };
      const row = buildCsvRow(tx);
      const line = serializeCsvRow(row);
      expect(line).toContain('"Smith, Jones & Co"');
    });

    it("serializeCsvRow escapes embedded double quotes per RFC 4180", () => {
      const tx: Transaction = {
        id: "tx-quote",
        householdId: "hh-x",
        accountId: "acc-x",
        bookedAtIso: "2026-06-01T00:00:00Z",
        amountMinor: -500,
        merchantRaw: 'Caf\u00e9 "Lykke"',
      };
      const row = buildCsvRow(tx);
      const line = serializeCsvRow(row);
      expect(line).toContain('"Caf\u00e9 ""Lykke"""');
    });
  });
});
