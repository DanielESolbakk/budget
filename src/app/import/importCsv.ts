import type {
  CsvColumnMapping,
  CsvRowPreview,
  CsvRowValidationError,
} from "../../domain/import/csvRowMapper.js";
import type { Transaction } from "../../domain/types.js";
import type { LedgerSnapshotData } from "../../domain/backup/snapshotContract.js";
import { resolve } from "node:path";
import { filterPreviouslyImportedTransactions } from "../../domain/import/filterPreviouslyImportedTransactions.js";
import { buildTransactionFingerprint } from "../../domain/import/buildTransactionFingerprint.js";

/** Shape of a normalized import request passed from the renderer to the main process via IPC. */
export interface CsvImportRequest {
  filePath: string;
  householdId: string;
  accountId: string;
  columnMapping?: CsvColumnMapping | undefined;
}

/** Returned when a CSV import completes without validation errors. Counts describe this operation's inserts and duplicates. */
export interface CsvImportSuccess {
  ok: true;
  importJobId: string;
  transactionCount: number;
  duplicateCount: number;
}

/** Returned when a CSV import has validation errors and no transactions are persisted. */
export interface CsvImportFailure {
  ok: false;
  errors: Array<{
    rowIndex: number;
    fields: string[];
    codes: string[];
    messages: string[];
  }>;
}

/** Discriminated union returned by the `import:csv` IPC channel. */
export type CsvImportResponse = CsvImportSuccess | CsvImportFailure;

export interface CsvImportPreviewSuccess {
  ok: true;
  previewId: string;
  headers: string[];
  rows: CsvRowPreview[];
  transactions: Transaction[];
}

export interface CsvImportPreviewFailure {
  ok: false;
  code: string;
  message: string;
}

export type CsvImportPreviewResponse = CsvImportPreviewSuccess | CsvImportPreviewFailure;

function canonicalSourcePath(filePath: string): string {
  const resolvedPath = resolve(filePath);
  return process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
}

export function filterPreviouslyImportedCsvTransactions(
  candidates: readonly Transaction[],
  snapshot: Pick<LedgerSnapshotData, "transactions" | "importJobs">,
  input: { filePath: string; accountId: string; sourceIdentity: string }
): Transaction[] {
  const directSourceJobs = snapshot.importJobs.filter(
    (job) => job.sourceType === "csv" && canonicalSourcePath(job.sourceName) === canonicalSourcePath(input.filePath)
  );
  const relatedSourceIdentities = new Set([
    ...directSourceJobs.map((job) => job.provenance?.sourceIdentity),
    input.sourceIdentity,
  ].filter((identity): identity is string => identity !== undefined));
  const sourceJobs = snapshot.importJobs.filter((job) =>
    job.sourceType === "csv" && (canonicalSourcePath(job.sourceName) === canonicalSourcePath(input.filePath) ||
      (job.provenance?.sourceIdentity !== undefined && relatedSourceIdentities.has(job.provenance.sourceIdentity)) ||
      (job.provenance?.contentDigest !== undefined && relatedSourceIdentities.has(job.provenance.contentDigest)))
  );
  const sameContentJobIds = new Set(sourceJobs
    .filter((job) => job.provenance?.sourceIdentity === input.sourceIdentity)
    .map((job) => job.id));
  const sameContentTransactions = snapshot.transactions.filter(
    (transaction) => transaction.accountId === input.accountId &&
      transaction.importJobId !== undefined && sameContentJobIds.has(transaction.importJobId)
  );
  const candidateReferences = new Set(candidates
    .map((transaction) => transaction.sourceReference?.trim())
    .filter((reference): reference is string => Boolean(reference)));
  const referencedTransactions = snapshot.transactions.filter(
    (transaction) => transaction.accountId === input.accountId &&
      transaction.sourceReference !== undefined &&
      candidateReferences.has(transaction.sourceReference.trim()) &&
      sourceJobs.some((job) => job.id === transaction.importJobId)
  );
  const unreferencedTransactions = snapshot.transactions.filter(
    (transaction) => transaction.accountId === input.accountId &&
      transaction.sourceReference === undefined &&
      transaction.importJobId !== undefined &&
      sourceJobs.some((job) => job.id === transaction.importJobId)
  );
  const matchingLegacyBatchRows = sourceJobs
    .filter((job) => job.provenance === undefined)
    .map((job) => snapshot.transactions.filter(
      (transaction) => transaction.accountId === input.accountId && transaction.importJobId === job.id
    ))
    .find((batch) => {
      if (batch.length !== candidates.length) return false;
      const counts = new Map<string, number>();
      for (const transaction of batch) {
        const { sourceReference: ignoredSourceReference, ...legacyTransaction } = transaction;
        void ignoredSourceReference;
        const key = buildTransactionFingerprint(legacyTransaction);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return candidates.every((transaction) => {
        const { sourceReference: ignoredSourceReference, ...legacyTransaction } = transaction;
        void ignoredSourceReference;
        const key = buildTransactionFingerprint(legacyTransaction);
        const count = counts.get(key) ?? 0;
        if (count === 0) return false;
        counts.set(key, count - 1);
        return true;
      });
    }) ?? [];

  const remainingCandidates = matchingLegacyBatchRows.length === candidates.length
    ? []
    : candidates;

  return filterPreviouslyImportedTransactions(remainingCandidates, [
    ...sameContentTransactions,
    ...referencedTransactions,
    ...unreferencedTransactions,
  ]);
}

/**
 * Builds a normalized CsvImportRequest from a raw file path and household/account context.
 * Trims whitespace from the path and enforces required fields as non-empty strings.
 */
export function buildCsvImportRequest(
  filePath: string,
  options: { householdId: string; accountId: string; columnMapping?: CsvColumnMapping | undefined }
): CsvImportRequest {
  const trimmedPath = filePath.trim();

  if (!trimmedPath) {
    throw new Error("filePath must be a non-empty string.");
  }

  if (!options.householdId.trim()) {
    throw new Error("householdId must be a non-empty string.");
  }

  if (!options.accountId.trim()) {
    throw new Error("accountId must be a non-empty string.");
  }

  return {
    filePath: trimmedPath,
    householdId: options.householdId,
    accountId: options.accountId,
    ...(options.columnMapping === undefined ? {} : { columnMapping: options.columnMapping }),
  };
}

/**
 * Converts validation errors from the CSV row-mapping layer into the stable
 * CsvImportFailure shape returned over IPC.
 */
export function normalizeCsvImportErrors(
  skipped: Array<{ rowIndex: number; errors: CsvRowValidationError[] }>
): CsvImportFailure {
  return {
    ok: false,
    errors: skipped.map(({ rowIndex, errors }) => ({
      rowIndex,
      fields: errors.map((e) => e.field),
      codes: errors.map((e) => e.code),
      messages: errors.map((e) => e.message),
    })),
  };
}
