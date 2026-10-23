import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { runCsvImportWorkflow } from "../../src/app/import/importCsv.js";
import { runPdfImportWorkflow } from "../../src/app/import/importPdf.js";
import { CSV_COLUMN_NAMES } from "../../src/domain/import/csvRowMapper.js";
import { defaultParserAdapterRegistry } from "../../src/domain/import/parserAdapterRegistry.js";
import type { Account, Household, Transaction } from "../../src/domain/types.js";

const HOUSEHOLD: Household = {
  id: "hh-reconciliation-integration",
  name: "Reconciliation integration household",
  createdAtIso: "2026-01-01T00:00:00Z",
};

const ACCOUNT: Account = {
  id: "acc-reconciliation-integration",
  householdId: HOUSEHOLD.id,
  name: "Main account",
  currencyCode: "NOK",
};

describe("import reconciliation integration contract", () => {
  it("counts raw CSV amounts for invalid rows and excludes transactions from other jobs", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-csv-reconciliation-"));
    const ledger = createLocalLedgerDatabase({
      dbPath: join(directory, "ledger.sqlite"),
      seedData: {
        household: HOUSEHOLD,
        accounts: [ACCOUNT],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });
    const otherJobTransaction: Transaction = {
      id: "csv-other-job-transaction",
      householdId: HOUSEHOLD.id,
      accountId: ACCOUNT.id,
      bookedAtIso: "2026-05-28T00:00:00Z",
      amountMinor: 999_999,
      merchantRaw: "SYNTHETIC OTHER JOB",
      currencyCode: "GBP",
      importJobId: "job-b",
    };

    try {
      ledger.appendTransactions([otherJobTransaction]);
      const response = runCsvImportWorkflow(
        {
          filePath: "synthetic-reconciliation.csv",
          householdId: HOUSEHOLD.id,
          accountId: ACCOUNT.id,
          rows: [
            {
              [CSV_COLUMN_NAMES.executionDate]: "29.05.2026",
              [CSV_COLUMN_NAMES.description]: "SYNTHETIC INCOME",
              [CSV_COLUMN_NAMES.amountIn]: "125.00",
              [CSV_COLUMN_NAMES.amountOut]: "",
              [CSV_COLUMN_NAMES.currency]: "NOK",
            },
            {
              [CSV_COLUMN_NAMES.executionDate]: "28.05.2026",
              [CSV_COLUMN_NAMES.description]: "SYNTHETIC EXPENSE",
              [CSV_COLUMN_NAMES.amountIn]: "",
              [CSV_COLUMN_NAMES.amountOut]: "-45.00",
              [CSV_COLUMN_NAMES.currency]: "NOK",
            },
            {
              [CSV_COLUMN_NAMES.executionDate]: "27.05.2026",
              [CSV_COLUMN_NAMES.description]: "SYNTHETIC GBP EXPENSE",
              [CSV_COLUMN_NAMES.amountIn]: "",
              [CSV_COLUMN_NAMES.amountOut]: "-78.00",
              [CSV_COLUMN_NAMES.currency]: "GBP",
            },
            {
              [CSV_COLUMN_NAMES.executionDate]: "99.05.2026",
              [CSV_COLUMN_NAMES.description]: "SYNTHETIC INVALID DATE",
              [CSV_COLUMN_NAMES.amountIn]: "",
              [CSV_COLUMN_NAMES.amountOut]: "-3.00",
              [CSV_COLUMN_NAMES.currency]: "NOK",
            },
          ],
          importJobId: "job-csv",
          startedAtIso: "2026-05-29T00:00:00Z",
          finishedAtIso: "2026-05-29T00:00:01Z",
          sourceIdentity: "synthetic-csv-source",
          sourceScope: "synthetic-reconciliation.csv",
        },
        {
          categoryRules: new Map(),
          loadLedgerSnapshotData: ledger.loadLedgerSnapshotData,
          getImportedTransactionsForSource: ledger.getImportedTransactionsForSource,
          appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
          getTransactionsForImportJob: ledger.getTransactionsForImportJob,
        }
      );

      expect(response.ok).toBe(true);
      if (!response.ok) return;
      expect(response.reconciliation).toMatchObject({
        importJobId: "job-csv",
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
            sourceTotalMinor: -4800,
            persistedTotalMinor: -4500,
            differenceMinor: -300,
            matched: false,
          },
        ],
        rows: [
          { sourceRowIndex: 0, disposition: "persisted" },
          { sourceRowIndex: 1, disposition: "persisted" },
          { sourceRowIndex: 2, disposition: "persisted" },
          { sourceRowIndex: 3, disposition: "invalid" },
        ],
        fullyReconciled: false,
      });
      expect(ledger.getTransactionsForImportJob("job-csv")).toHaveLength(3);
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses raw PDF source rows and only transactions persisted for the same import job", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-import-reconciliation-"));
    const ledger = createLocalLedgerDatabase({
      dbPath: join(directory, "ledger.sqlite"),
      seedData: {
        household: HOUSEHOLD,
        accounts: [ACCOUNT],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });
    const otherJobTransaction: Transaction = {
      id: "other-job-transaction",
      householdId: HOUSEHOLD.id,
      accountId: ACCOUNT.id,
      bookedAtIso: "2026-05-28T00:00:00Z",
      amountMinor: 999_999,
      merchantRaw: "SYNTHETIC OTHER JOB",
      currencyCode: "GBP",
      importJobId: "job-b",
    };
    const pdfText = [
      "ROGALAND SPAREBANK",
      "Transaksjoner Antall: 2",
      "Kontonummer: SYNTHETIC-001",
      "Dato Type Fra konto Avsender Til konto Mottakernavn Beløp Valuta Status Melding/KID/Fakt.nr",
      "29.05.2026 Varekjøp SYNTHETIC-001 LOCAL_USER -12,50 NOK Bokført SYNTHETIC VALID ROW",
      "99.05.2026 Varekjøp SYNTHETIC-001 LOCAL_USER -3,00 NOK Bokført SYNTHETIC INVALID DATE ROW",
      "27.05.2026 Varekjøp SYNTHETIC-001 LOCAL_USER -2,00 NOK Unrecognized SYNTHETIC INVALID STATUS ROW",
    ].join("\n");

    try {
      ledger.appendTransactions([otherJobTransaction]);
      const response = runPdfImportWorkflow(
        {
          pdfText,
          filePath: "synthetic-reconciliation.txt",
          householdId: HOUSEHOLD.id,
          accountId: ACCOUNT.id,
          importJobId: "job-a",
          startedAtIso: "2026-05-29T00:00:00Z",
          finishedAtIso: "2026-05-29T00:00:01Z",
        },
        {
          parserRegistry: defaultParserAdapterRegistry,
          appendImportJob: ledger.appendImportJob,
          appendTransactions: ledger.appendTransactions,
          appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
          getTransactionsForImportJob: ledger.getTransactionsForImportJob,
          getExistingTransactionsForAccount: ledger.getTransactionsForAccount,
        }
      );

      expect(response.ok).toBe(true);
      if (!response.ok) return;
      expect(response).toHaveProperty("reconciliation");
      expect(response).toMatchObject({
        reconciliation: {
          importJobId: "job-a",
          amounts: [
            {
              currencyCode: "NOK",
              direction: "incoming",
              sourceTotalMinor: 0,
              persistedTotalMinor: 0,
              differenceMinor: 0,
              matched: true,
            },
            {
              currencyCode: "NOK",
              direction: "outgoing",
              sourceTotalMinor: -1750,
              persistedTotalMinor: -1250,
              differenceMinor: -500,
              matched: false,
            },
          ],
          rows: [
            { sourceRowIndex: 4, disposition: "persisted" },
            { sourceRowIndex: 5, disposition: "invalid" },
            { sourceRowIndex: 6, disposition: "invalid" },
          ],
          fullyReconciled: false,
        },
      });
      expect(ledger.getTransactionsForImportJob("job-a")).toEqual([
        expect.objectContaining({
          amountMinor: -1250,
          importJobId: "job-a",
        }),
      ]);
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
