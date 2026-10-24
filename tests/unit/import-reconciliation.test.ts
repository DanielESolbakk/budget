import { describe, expect, it } from "vitest";
import { runCsvImportWorkflow } from "../../src/app/import/importCsv.js";
import { reconcileImportJob } from "../../src/domain/import/importReconciliation.js";
import { validateCsvRow } from "../../src/domain/import/csvRowMapper.js";
import type { ImportJob, Transaction } from "../../src/domain/types.js";

const importJobId = "job-a";

function csvRow(overrides: Partial<Record<string, string>> = {}): Record<string, string> {
  return {
    "Utført dato": "28.05.2026",
    "Bokført dato": "28.05.2026",
    Beskrivelse: "SYNTHETIC MERCHANT",
    "Beløp inn": "",
    "Beløp ut": "-45.00",
    Valuta: "NOK",
    ...overrides,
  };
}

describe("import reconciliation", () => {
  it("rejects currency values that cannot be grouped in reconciliation totals", () => {
    const errors = validateCsvRow(csvRow({ Valuta: "not-a-currency" }));

    expect(errors.map(({ code }) => code)).toContain("INVALID_CURRENCY_CODE");
  });

  it("compares this job's source and persisted totals by currency and direction", () => {
    let persistedTransactions: Transaction[] = [];
    const response = runCsvImportWorkflow(
      {
        filePath: "synthetic.csv",
        householdId: "hh-test",
        accountId: "acc-test",
        rows: [
          csvRow({ Beskrivelse: "SYNTHETIC INCOME", "Beløp inn": "125.00", "Beløp ut": "", Valuta: "NOK" }),
          csvRow({ Beskrivelse: "SYNTHETIC EXPENSE", "Beløp ut": "-45.00", Valuta: "NOK" }),
          csvRow({ Beskrivelse: "SYNTHETIC GBP EXPENSE", "Beløp ut": "-78.00", Valuta: "GBP" }),
        ],
        importJobId,
        startedAtIso: "2026-05-28T00:00:00Z",
        finishedAtIso: "2026-05-28T00:00:00Z",
        sourceIdentity: "synthetic-source",
        sourceScope: "synthetic.csv",
      },
      {
        categoryRules: new Map(),
        loadLedgerSnapshotData: () => ({
          household: { id: "hh-test", name: "Test", createdAtIso: "2026-01-01T00:00:00Z" },
          accounts: [{ id: "acc-test", householdId: "hh-test", name: "Test", currencyCode: "NOK" }],
          transactions: [],
          importJobs: [],
          monthlyCategoryTargets: [],
        }),
        getImportedTransactionsForSource: () => [],
        appendImportJobAndTransactions: (_job: ImportJob, transactions: Transaction[]) => {
          persistedTransactions = transactions;
          return transactions.length;
        },
        getTransactionsForImportJob: () => persistedTransactions,
      });

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response).toHaveProperty("reconciliation");
    expect(response).toMatchObject({
      reconciliation: {
        importJobId,
        amounts: [
          {
            currencyCode: "GBP",
            direction: "incoming",
            sourceTotalMinor: 0,
            persistedTotalMinor: 0,
            differenceMinor: 0,
            matched: true,
          },
          {
            currencyCode: "GBP",
            direction: "outgoing",
            sourceTotalMinor: -7800,
            persistedTotalMinor: -7800,
            differenceMinor: 0,
            matched: true,
          },
          {
            currencyCode: "NOK",
            direction: "incoming",
            sourceTotalMinor: 12500,
            persistedTotalMinor: 12500,
            differenceMinor: 0,
            matched: true,
          },
          {
            currencyCode: "NOK",
            direction: "outgoing",
            sourceTotalMinor: -4500,
            persistedTotalMinor: -4500,
            differenceMinor: 0,
            matched: true,
          },
        ],
        fullyReconciled: true,
      },
    });
  });

  it("keeps signed differences job-scoped and reports each source-row disposition", () => {
    const result = reconcileImportJob(
      importJobId,
      [
        { importJobId, sourceRowIndex: 0, amountMinor: 12_500, currencyCode: "NOK", disposition: "persisted" },
        { importJobId, sourceRowIndex: 1, amountMinor: -4_500, currencyCode: "NOK", disposition: "persisted" },
        { importJobId, sourceRowIndex: 2, amountMinor: -7_800, currencyCode: "GBP", disposition: "duplicate" },
        {
          importJobId,
          sourceRowIndex: 3,
          amountMinor: -1_100,
          currencyCode: "NOK",
          disposition: "unresolved",
          reviewItemId: "job-a:review:4",
        },
        { importJobId, sourceRowIndex: 4, amountMinor: -300, currencyCode: "GBP", disposition: "invalid" },
        { importJobId, sourceRowIndex: 5, amountMinor: -200, currencyCode: "NOK", disposition: "skipped" },
        { importJobId, sourceRowIndex: 6, amountMinor: -50, currencyCode: "NOK", disposition: "not-persisted" },
        { importJobId, sourceRowIndex: 7, amountMinor: -25, currencyCode: "NOK", disposition: "pending" },
        { importJobId, sourceRowIndex: 8, currencyCode: "NOK" },
        { importJobId: "job-b", sourceRowIndex: 0, amountMinor: 99_999, currencyCode: "GBP", disposition: "persisted" },
      ],
      [
        {
          id: "job-a-incoming",
          householdId: "hh-test",
          accountId: "acc-test",
          bookedAtIso: "2026-05-28T00:00:00Z",
          amountMinor: 12_500,
          merchantRaw: "SYNTHETIC INCOME",
          currencyCode: "NOK",
          importJobId,
        },
        {
          id: "job-a-outgoing",
          householdId: "hh-test",
          accountId: "acc-test",
          bookedAtIso: "2026-05-28T00:00:00Z",
          amountMinor: -4_200,
          merchantRaw: "SYNTHETIC EXPENSE",
          currencyCode: "NOK",
          importJobId,
        },
        {
          id: "job-b-incoming",
          householdId: "hh-test",
          accountId: "acc-test",
          bookedAtIso: "2026-05-28T00:00:00Z",
          amountMinor: 99_999,
          merchantRaw: "SYNTHETIC OTHER JOB",
          currencyCode: "GBP",
          importJobId: "job-b",
        },
      ] satisfies Transaction[],
      "NOK"
    );

    expect(result.amounts).toEqual([
      {
        currencyCode: "GBP",
        direction: "incoming",
        sourceTotalMinor: 0,
        persistedTotalMinor: 0,
        differenceMinor: 0,
        matched: true,
      },
      {
        currencyCode: "GBP",
        direction: "outgoing",
        sourceTotalMinor: -8_100,
        persistedTotalMinor: 0,
        differenceMinor: -8_100,
        matched: false,
      },
      {
        currencyCode: "NOK",
        direction: "incoming",
        sourceTotalMinor: 12_500,
        persistedTotalMinor: 12_500,
        differenceMinor: 0,
        matched: true,
      },
      {
        currencyCode: "NOK",
        direction: "outgoing",
        sourceTotalMinor: -5_875,
        persistedTotalMinor: -4_200,
        differenceMinor: -1_675,
        matched: false,
      },
    ]);
    expect(result.rows.map(({ disposition, reviewItemId }) => ({ disposition, reviewItemId }))).toEqual([
      { disposition: "persisted", reviewItemId: undefined },
      { disposition: "persisted", reviewItemId: undefined },
      { disposition: "duplicate", reviewItemId: undefined },
      { disposition: "unresolved", reviewItemId: "job-a:review:4" },
      { disposition: "invalid", reviewItemId: undefined },
      { disposition: "skipped", reviewItemId: undefined },
      { disposition: "not-persisted", reviewItemId: undefined },
      { disposition: "pending", reviewItemId: undefined },
      { disposition: "unaccounted", reviewItemId: undefined },
    ]);
    expect(result.fullyReconciled).toBe(false);
  });

  it("reconciles a 10,000-row import without truncating totals or dispositions", () => {
    const sourceRows = Array.from({ length: 10_000 }, (_, sourceRowIndex) => ({
      importJobId,
      sourceRowIndex,
      amountMinor: sourceRowIndex % 2 === 0 ? 100 : -100,
      currencyCode: "NOK",
      disposition: "persisted" as const,
    }));
    const persistedTransactions: Transaction[] = sourceRows.map((row) => ({
      id: `transaction-${row.sourceRowIndex}`,
      householdId: "hh-test",
      accountId: "acc-test",
      bookedAtIso: "2026-05-28T00:00:00Z",
      amountMinor: row.amountMinor,
      merchantRaw: `SYNTHETIC ROW ${row.sourceRowIndex}`,
      currencyCode: row.currencyCode,
      importJobId,
    }));
    const result = reconcileImportJob(importJobId, sourceRows, persistedTransactions, "NOK");

    expect(result.rows).toHaveLength(10_000);
    expect(result.amounts).toEqual([
      {
        currencyCode: "NOK",
        direction: "incoming",
        sourceTotalMinor: 500_000,
        persistedTotalMinor: 500_000,
        differenceMinor: 0,
        matched: true,
      },
      {
        currencyCode: "NOK",
        direction: "outgoing",
        sourceTotalMinor: -500_000,
        persistedTotalMinor: -500_000,
        differenceMinor: 0,
        matched: true,
      },
    ]);
    expect(result.fullyReconciled).toBe(true);
  });
});
