import { describe, expect, it } from "vitest";
import { runCsvImportWorkflow } from "../../src/app/import/importCsv.js";
import { CSV_COLUMN_NAMES } from "../../src/domain/import/csvRowMapper.js";
import { parseRogalandStatementText } from "../../src/domain/import/pdfTextParser.js";
import type { LedgerSnapshotData } from "../../src/domain/backup/snapshotContract.js";
import type { Transaction } from "../../src/domain/types.js";
import * as domainTypes from "../../src/domain/types.js";
import * as sourceDocuments from "../../src/domain/import/sourceDocument.js";

const HOUSEHOLD_ID = "hh-review-test";
const ACCOUNT_ID = "acc-review-test";
const IMPORT_JOB_ID = "job-review-mixed-csv";

const VALID_CSV_ROW = {
  [CSV_COLUMN_NAMES.executionDate]: "20.05.2026",
  [CSV_COLUMN_NAMES.description]: "SYNTHETIC VALID ROW",
  [CSV_COLUMN_NAMES.amountIn]: "",
  [CSV_COLUMN_NAMES.amountOut]: "12.50",
  [CSV_COLUMN_NAMES.currency]: "NOK",
};
const INVALID_CSV_ROW = {
  [CSV_COLUMN_NAMES.executionDate]: "19.05.2026",
  [CSV_COLUMN_NAMES.description]: "SYNTHETIC UNRESOLVED ROW",
  [CSV_COLUMN_NAMES.amountIn]: "",
  [CSV_COLUMN_NAMES.amountOut]: "not-a-number",
  [CSV_COLUMN_NAMES.currency]: "NOK",
};

const EMPTY_SNAPSHOT: LedgerSnapshotData = {
  household: {
    id: HOUSEHOLD_ID,
    name: "Review test household",
    createdAtIso: "2026-01-01T00:00:00Z",
  },
  accounts: [],
  transactions: [],
  importJobs: [],
  monthlyCategoryTargets: [],
};

const CORRECTION_CONTEXT = {
  householdId: HOUSEHOLD_ID,
  accounts: [{
    id: ACCOUNT_ID,
    householdId: HOUSEHOLD_ID,
    name: "Main account",
    currencyCode: "NOK",
  }],
};

function validateImportReviewCorrection(input: Record<string, unknown>): unknown {
  const validator = Reflect.get(domainTypes, "validateImportReviewCorrectionInput");
  expect(typeof validator).toBe("function");
  if (typeof validator !== "function") return undefined;
  return Reflect.apply(validator, undefined, [input, CORRECTION_CONTEXT]);
}

function classifyImportFilePath(filePath: string): unknown {
  const classifier = Reflect.get(sourceDocuments, "classifyImportFilePath");
  expect(typeof classifier).toBe("function");
  if (typeof classifier !== "function") return undefined;
  return Reflect.apply(classifier, undefined, [filePath]);
}

describe("cross-format import review", () => {
  it("keeps valid PDF candidates while retaining a malformed row for review", () => {
    const invalidRow = "26.05.2026 MERCHANT-005 Butikkkjop invalid-amount 24 902,30";
    const result = parseRogalandStatementText([
      "ROGALAND SPAREBANK",
      "Dato         Beskrivelse                              Beløp          Saldo",
      "27.05.2026   SALARY                                  +50 000,00     75 000,00",
      invalidRow,
    ].join("\n"), {
      householdId: HOUSEHOLD_ID,
      accountId: ACCOUNT_ID,
      importJobId: IMPORT_JOB_ID,
    });

    expect(result).toMatchObject({
      ok: true,
      transactions: [
        expect.objectContaining({
          householdId: HOUSEHOLD_ID,
          accountId: ACCOUNT_ID,
          bookedAtIso: "2026-05-27T00:00:00Z",
          amountMinor: 5_000_000,
          merchantRaw: "SALARY",
          importJobId: IMPORT_JOB_ID,
        }),
      ],
      unresolvedRows: [
        {
          lineNumber: 4,
          rawRow: invalidRow,
          errors: [expect.objectContaining({ code: "INVALID_AMOUNT_FORMAT", field: "amount" })],
        },
      ],
    });
  });

  it.each([
    ["C:\\statements\\monthly.PDF", "pdf"],
    ["C:\\statements\\monthly.txt", "text"],
    ["C:\\statements\\monthly.CsV", "csv"],
    ["/statements/monthly.csv", "csv"],
  ])("classifies supported local statement path %s", (filePath, format) => {
    expect(classifyImportFilePath(filePath)).toBe(format);
  });

  it("rejects file paths that do not use a supported statement format", () => {
    expect(classifyImportFilePath("C:\\statements\\monthly.xlsx")).toBeUndefined();
  });

  it("persists valid CSV transactions when another row needs review", () => {
    const persistedTransactions: Transaction[] = [];
    const persistedReviewItems: unknown[] = [];
    const response = runCsvImportWorkflow({
      filePath: "statement.csv",
      householdId: HOUSEHOLD_ID,
      accountId: ACCOUNT_ID,
      rows: [VALID_CSV_ROW, INVALID_CSV_ROW],
      importJobId: IMPORT_JOB_ID,
      startedAtIso: "2026-05-21T12:00:00Z",
      finishedAtIso: "2026-05-21T12:00:01Z",
      sourceIdentity: "synthetic-review-csv-v1",
      sourceScope: "statement.csv",
    }, {
      categoryRules: new Map(),
      loadLedgerSnapshotData: () => EMPTY_SNAPSHOT,
      getImportedTransactionsForSource: () => [],
      appendImportJobAndTransactions: (_job, transactions, reviewItems?: unknown[]) => {
        persistedTransactions.push(...transactions);
        if (reviewItems !== undefined) persistedReviewItems.push(...reviewItems);
        return transactions.length;
      },
    });

    expect(persistedReviewItems).toEqual([
      expect.objectContaining({
        importJobId: IMPORT_JOB_ID,
        householdId: HOUSEHOLD_ID,
        accountId: ACCOUNT_ID,
        sourceType: "csv",
        sourceName: "statement.csv",
        sourceIdentity: "synthetic-review-csv-v1",
        sourceRowIndex: 1,
        status: "unresolved",
        rawRow: expect.stringContaining("not-a-number"),
        parserErrors: expect.arrayContaining([
          expect.objectContaining({ code: "INVALID_AMOUNT_FORMAT" }),
        ]),
      }),
    ]);
    expect(response).toMatchObject({
      ok: true,
      transactionCount: 1,
    });
    expect(persistedTransactions).toEqual([
      expect.objectContaining({
        householdId: HOUSEHOLD_ID,
        accountId: ACCOUNT_ID,
        bookedAtIso: "2026-05-20T00:00:00Z",
        amountMinor: -1250,
        merchantRaw: "SYNTHETIC VALID ROW",
        currencyCode: "NOK",
      }),
    ]);
  });

  it("normalizes valid correction fields into a canonical transaction input", () => {
    expect(validateImportReviewCorrection({
      bookedAtIso: "2026-05-19",
      amountMinor: -5250,
      merchantRaw: "  Corrected merchant  ",
      accountId: ACCOUNT_ID,
      currencyCode: "NOK",
    })).toEqual({
      ok: true,
      value: {
        bookedAtIso: "2026-05-19",
        amountMinor: -5250,
        merchantRaw: "Corrected merchant",
        accountId: ACCOUNT_ID,
        currencyCode: "NOK",
      },
    });
  });

  it.each([
    ["date", { bookedAtIso: "2026-02-31" }, "INVALID_BOOKED_AT_ISO"],
    ["amount", { amountMinor: 1.5 }, "INVALID_AMOUNT_MINOR_INTEGER"],
    ["merchant", { merchantRaw: "   " }, "INVALID_MERCHANT_RAW"],
    ["account", { accountId: "another-household-account" }, "INVALID_ACCOUNT_ID"],
    ["currency", { currencyCode: "N0K" }, "INVALID_CURRENCY_CODE"],
  ])("rejects an invalid correction %s", (_field, override, errorCode) => {
    expect(validateImportReviewCorrection({
      bookedAtIso: "2026-05-19",
      amountMinor: -5250,
      merchantRaw: "Corrected merchant",
      accountId: ACCOUNT_ID,
      currencyCode: "NOK",
      ...override,
    })).toMatchObject({
      ok: false,
      errors: [expect.objectContaining({ code: errorCode })],
    });
  });
});
