import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { runCsvImportWorkflow } from "../../src/app/import/importCsv.js";
import { runPdfImportWorkflow } from "../../src/app/import/importPdf.js";
import * as reviewService from "../../src/app/reviewService.js";
import { defaultParserAdapterRegistry } from "../../src/domain/import/parserAdapterRegistry.js";
import { createTextSourceDocument } from "../../src/domain/import/sourceDocument.js";
import { CSV_COLUMN_NAMES } from "../../src/domain/import/csvRowMapper.js";
import type { Account, Household } from "../../src/domain/types.js";

const HOUSEHOLD: Household = {
  id: "hh-import-review-integration",
  name: "Import review integration household",
  createdAtIso: "2026-01-01T00:00:00Z",
};

const ACCOUNT: Account = {
  id: "acc-import-review-integration",
  householdId: HOUSEHOLD.id,
  name: "Main account",
  currencyCode: "NOK",
};

function invokeReviewServiceAction(name: string, ...args: unknown[]): unknown {
  const action = Reflect.get(reviewService, name);
  expect(typeof action).toBe("function");
  if (typeof action !== "function") return undefined;
  return Reflect.apply(action, undefined, args);
}

function createReviewLedger(suffix: string) {
  const directory = mkdtempSync(join(tmpdir(), `budget-review-action-${suffix}-`));
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
  const importJobId = `job-review-action-${suffix}`;
  const response = runCsvImportWorkflow({
    filePath: "synthetic-review-action.csv",
    householdId: HOUSEHOLD.id,
    accountId: ACCOUNT.id,
    rows: [
      {
        [CSV_COLUMN_NAMES.executionDate]: "20.05.2026",
        [CSV_COLUMN_NAMES.description]: "SYNTHETIC VALID ROW",
        [CSV_COLUMN_NAMES.amountIn]: "",
        [CSV_COLUMN_NAMES.amountOut]: "12.50",
        [CSV_COLUMN_NAMES.currency]: "NOK",
      },
      {
        [CSV_COLUMN_NAMES.executionDate]: "19.05.2026",
        [CSV_COLUMN_NAMES.description]: "SYNTHETIC UNRESOLVED ROW",
        [CSV_COLUMN_NAMES.amountIn]: "",
        [CSV_COLUMN_NAMES.amountOut]: "not-a-number",
        [CSV_COLUMN_NAMES.currency]: "NOK",
      },
    ],
    importJobId,
    startedAtIso: "2026-05-21T12:00:00Z",
    finishedAtIso: "2026-05-21T12:00:01Z",
    sourceIdentity: "synthetic-review-csv-v1",
    sourceScope: "synthetic-review-action.csv",
  }, {
    categoryRules: new Map(),
    loadLedgerSnapshotData: ledger.loadLedgerSnapshotData,
    getImportedTransactionsForSource: ledger.getImportedTransactionsForSource,
    appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
    getTransactionsForImportJob: ledger.getTransactionsForImportJob,
  });
  if (!response.ok) {
    ledger.close();
    rmSync(directory, { recursive: true, force: true });
    throw new Error("Could not create the synthetic unresolved import review item.");
  }

  const reviewItem = ledger.listImportReviewItems(HOUSEHOLD.id)[0];
  if (reviewItem === undefined) {
    ledger.close();
    rmSync(directory, { recursive: true, force: true });
    throw new Error("The synthetic import did not create an unresolved review item.");
  }

  return {
    ledger,
    reviewItem,
    close() {
      try {
        ledger.close();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}

describe("import review persistence contract", () => {
  it("persists valid CSV transactions and unresolved row evidence in one local import", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-import-review-"));
    const dbPath = join(directory, "ledger.sqlite");
    const ledger = createLocalLedgerDatabase({
      dbPath,
      seedData: {
        household: HOUSEHOLD,
        accounts: [ACCOUNT],
        transactions: [],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      const response = runCsvImportWorkflow({
        filePath: "synthetic-mixed-statement.csv",
        householdId: HOUSEHOLD.id,
        accountId: ACCOUNT.id,
        rows: [
          {
            [CSV_COLUMN_NAMES.executionDate]: "20.05.2026",
            [CSV_COLUMN_NAMES.description]: "SYNTHETIC VALID ROW",
            [CSV_COLUMN_NAMES.amountIn]: "",
            [CSV_COLUMN_NAMES.amountOut]: "12.50",
            [CSV_COLUMN_NAMES.currency]: "NOK",
          },
          {
            [CSV_COLUMN_NAMES.executionDate]: "19.05.2026",
            [CSV_COLUMN_NAMES.description]: "SYNTHETIC UNRESOLVED ROW",
            [CSV_COLUMN_NAMES.amountIn]: "",
            [CSV_COLUMN_NAMES.amountOut]: "not-a-number",
            [CSV_COLUMN_NAMES.currency]: "NOK",
          },
        ],
        importJobId: "job-import-review-integration",
        startedAtIso: "2026-05-21T12:00:00Z",
        finishedAtIso: "2026-05-21T12:00:01Z",
        sourceIdentity: "synthetic-review-csv-v1",
        sourceScope: "synthetic-mixed-statement.csv",
      }, {
        categoryRules: new Map(),
        loadLedgerSnapshotData: ledger.loadLedgerSnapshotData,
        getImportedTransactionsForSource: ledger.getImportedTransactionsForSource,
        appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
        getTransactionsForImportJob: ledger.getTransactionsForImportJob,
      });

      expect(response).toMatchObject({
        ok: true,
        transactionCount: 1,
        unresolvedCount: 1,
      });
      expect(ledger.loadLedgerSnapshotData().transactions).toEqual([
        expect.objectContaining({
          importJobId: "job-import-review-integration",
          merchantRaw: "SYNTHETIC VALID ROW",
          amountMinor: -1250,
        }),
      ]);

      const database = new DatabaseSync(dbPath);
      try {
        const reviewTable = database.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'import_review_items'"
        ).get();
        expect(reviewTable).toEqual({ name: "import_review_items" });
        if (reviewTable === undefined) return;

        const reviewItems = database.prepare(`
          SELECT import_job_id, household_id, account_id, source_type, source_name, source_identity,
            source_row_index, raw_row, parser_errors_json, status
          FROM import_review_items
        `).all() as Array<{
          import_job_id: string;
          household_id: string;
          account_id: string;
          source_type: string;
          source_name: string;
          source_identity: string;
          source_row_index: number;
          raw_row: string;
          parser_errors_json: string;
          status: string;
        }>;

        expect(reviewItems).toHaveLength(1);
        expect(reviewItems[0]).toMatchObject({
          import_job_id: "job-import-review-integration",
          household_id: HOUSEHOLD.id,
          account_id: ACCOUNT.id,
          source_type: "csv",
          source_name: "synthetic-mixed-statement.csv",
          source_identity: "synthetic-review-csv-v1",
          source_row_index: 1,
          raw_row: expect.stringContaining("not-a-number"),
          status: "unresolved",
        });
        expect(JSON.parse(reviewItems[0]!.parser_errors_json)).toEqual([
          expect.objectContaining({
            code: "INVALID_AMOUNT_FORMAT",
            field: CSV_COLUMN_NAMES.amountOut,
          }),
        ]);
      } finally {
        database.close();
      }
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("persists valid PDF transactions and malformed source evidence for review", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-pdf-review-"));
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
    const importJobId = "job-pdf-review-integration";
    const malformedRow = "26.05.2026 MERCHANT-005 Butikkkjop invalid-amount 24 902,30";
    const text = [
      "ROGALAND SPAREBANK",
      "Dato         Beskrivelse                              Beløp          Saldo",
      "27.05.2026   SALARY                                  +50 000,00     75 000,00",
      malformedRow,
    ].join("\n");
    const timestamp = "2026-05-28T12:00:00Z";

    try {
      const response = runPdfImportWorkflow({
        pdfText: text,
        sourceDocument: createTextSourceDocument(text),
        filePath: "synthetic-mixed-statement.txt",
        householdId: HOUSEHOLD.id,
        accountId: ACCOUNT.id,
        importJobId,
        startedAtIso: timestamp,
        finishedAtIso: timestamp,
      }, {
        parserRegistry: defaultParserAdapterRegistry,
        appendImportJob: ledger.appendImportJob,
        appendTransactions: ledger.appendTransactions,
        appendImportJobAndTransactions: ledger.appendImportJobAndTransactions,
        getTransactionsForImportJob: ledger.getTransactionsForImportJob,
      });

      expect(response).toMatchObject({
        ok: true,
        transactionCount: 1,
        unresolvedRowCount: 1,
      });
      expect(ledger.getTransactionsForImportJob(importJobId)).toEqual([
        expect.objectContaining({
          bookedAtIso: "2026-05-27T00:00:00Z",
          amountMinor: 5_000_000,
          merchantRaw: "SALARY",
        }),
      ]);
      expect(ledger.listImportReviewItems(HOUSEHOLD.id)).toEqual([
        expect.objectContaining({
          importJobId,
          accountId: ACCOUNT.id,
          sourceType: "pdf",
          sourceName: "synthetic-mixed-statement.txt",
          rawRow: malformedRow,
          status: "unresolved",
          parserErrors: [expect.objectContaining({ code: "INVALID_AMOUNT_FORMAT" })],
        }),
      ]);
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("corrects an unresolved row once and keeps the transaction provenance", () => {
    const testLedger = createReviewLedger("correction");
    const correction = {
      bookedAtIso: "2026-05-19",
      amountMinor: -999,
      merchantRaw: "SYNTHETIC CORRECTED MERCHANT",
      accountId: ACCOUNT.id,
      currencyCode: "NOK",
    };
    const correctedAtIso = "2026-05-22T09:00:00Z";

    try {
      const firstResult = invokeReviewServiceAction(
        "applyImportReviewCorrection",
        testLedger.ledger,
        HOUSEHOLD.id,
        testLedger.reviewItem.id,
        correction,
        correctedAtIso
      );
      expect(firstResult).toMatchObject({
        ok: true,
        item: {
          id: testLedger.reviewItem.id,
          status: "corrected",
          correctedAtIso,
        },
        transaction: {
          importJobId: testLedger.reviewItem.importJobId,
          householdId: HOUSEHOLD.id,
          accountId: ACCOUNT.id,
          bookedAtIso: correction.bookedAtIso,
          amountMinor: correction.amountMinor,
          merchantRaw: correction.merchantRaw,
          currencyCode: correction.currencyCode,
          sourceType: "csv",
        },
      });
      const repeatedResult = invokeReviewServiceAction(
        "applyImportReviewCorrection",
        testLedger.ledger,
        HOUSEHOLD.id,
        testLedger.reviewItem.id,
        correction,
        correctedAtIso
      );

      expect(repeatedResult).toEqual(firstResult);
      expect(testLedger.ledger.getTransactionsForImportJob(testLedger.reviewItem.importJobId)).toHaveLength(2);
      expect(testLedger.ledger.listImportReviewItems(HOUSEHOLD.id)).toMatchObject([
        { id: testLedger.reviewItem.id, status: "corrected", correctedTransactionId: expect.any(String) },
      ]);
    } finally {
      testLedger.close();
    }
  });

  it("dismisses an unresolved row with a reason and creates no transaction", () => {
    const testLedger = createReviewLedger("dismissal");
    const dismissedAtIso = "2026-05-22T10:00:00Z";

    try {
      const firstResult = invokeReviewServiceAction(
        "dismissImportReviewItem",
        testLedger.ledger,
        HOUSEHOLD.id,
        testLedger.reviewItem.id,
        "Duplicate bank explanation row",
        dismissedAtIso
      );
      expect(firstResult).toMatchObject({
        ok: true,
        item: {
          id: testLedger.reviewItem.id,
          status: "dismissed",
          dismissalReason: "Duplicate bank explanation row",
          dismissedAtIso,
          rawRow: testLedger.reviewItem.rawRow,
          parserErrors: testLedger.reviewItem.parserErrors,
        },
      });
      const repeatedResult = invokeReviewServiceAction(
        "dismissImportReviewItem",
        testLedger.ledger,
        HOUSEHOLD.id,
        testLedger.reviewItem.id,
        "Duplicate bank explanation row",
        dismissedAtIso
      );

      expect(repeatedResult).toEqual(firstResult);
      expect(testLedger.ledger.getTransactionsForImportJob(testLedger.reviewItem.importJobId)).toHaveLength(1);
      expect(testLedger.ledger.listImportReviewItems(HOUSEHOLD.id)).toMatchObject([
        { id: testLedger.reviewItem.id, status: "dismissed", dismissedAtIso },
      ]);
    } finally {
      testLedger.close();
    }
  });
});
