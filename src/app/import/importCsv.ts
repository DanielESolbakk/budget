import type {
  CsvColumnMapping,
  CsvRowPreview,
  CsvRowValidationError,
  CsvRowMappingOptions,
} from "../../domain/import/csvRowMapper.js";
import {
  CSV_COLUMN_NAMES,
  createCsvPendingObservation,
  mapCsvImportedStatus,
  mapCsvRowToTransaction,
  normalizeCsvRow,
  previewCsvRows,
  extractCsvSourceAmount,
} from "../../domain/import/csvRowMapper.js";
import type {
  BankTransactionStatus,
  ImportJob,
  ImportReviewItem,
  PendingTransactionObservation,
  PendingTransactionStatus,
  Transaction,
} from "../../domain/types.js";
import type { LedgerSnapshotData } from "../../domain/backup/snapshotContract.js";
import {
  classifyDuplicateCandidates,
  type ClassifiedDuplicateCandidate,
  type DuplicateImportDecision,
  type DuplicateTransactionMatch,
} from "../../domain/import/filterPreviouslyImportedTransactions.js";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { assignImportedTransactionIds } from "../../domain/import/assignImportedTransactionIds.js";
import { filterPreviouslyImportedTransactions } from "../../domain/import/filterPreviouslyImportedTransactions.js";
import { buildTransactionFingerprint } from "../../domain/import/buildTransactionFingerprint.js";
import { categorizeTransactions } from "../../domain/categorization/categorizeTransaction.js";
import {
  reconcileImportJob,
  type ImportReconciliation,
  type ImportReconciliationDisposition,
  type ImportReconciliationSourceRow,
} from "../../domain/import/importReconciliation.js";

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
  pendingCount?: number;
  duplicateCount: number;
  unresolvedCount: number;
  reconciliation: ImportReconciliation;
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

export interface CsvImportWorkflowInput extends CsvImportRequest {
  rows: Array<Record<string, string>>;
  importJobId: string;
  startedAtIso: string;
  finishedAtIso: string;
  sourceIdentity: string;
  sourceScope: string;
  duplicateDecisions?: DuplicateImportDecision[];
}

export interface CsvImportWorkflowDependencies {
  categoryRules: ReadonlyMap<string, string>;
  loadLedgerSnapshotData: () => LedgerSnapshotData;
  getImportedTransactionsForSource: (
    sourceType: "csv",
    sourceName: string,
    accountId: string,
    sourceIdentity: string
  ) => Transaction[];
  appendImportJobAndTransactions: (
    importJob: ImportJob,
    transactions: Transaction[],
    reviewItems?: ImportReviewItem[],
    pendingObservations?: PendingTransactionObservation[]
  ) => number;
  getTransactionsForImportJob: (importJobId: string) => Transaction[];
}

export interface CsvImportPreviewRow extends CsvRowPreview {
  duplicateMatch?: DuplicateTransactionMatch;
}

export interface CsvImportPreviewSuccess {
  ok: true;
  previewId: string;
  headers: string[];
  rows: CsvImportPreviewRow[];
  transactions: Transaction[];
}

export interface CsvImportPreviewFailure {
  ok: false;
  code: string;
  message: string;
}

export type CsvImportPreviewResponse = CsvImportPreviewSuccess | CsvImportPreviewFailure;

export async function previewCsvRowsWithProgress(
  rows: Array<Record<string, string>>,
  options: CsvRowMappingOptions,
  callbacks: {
    isCancelled: () => boolean;
    onProgress: (completedRows: number, totalRows: number) => void;
    batchSize?: number;
  }
): Promise<{
  rows: CsvRowPreview[];
  transactions: Transaction[];
  pendingObservations?: PendingTransactionObservation[];
} | null> {
  const batchSize = callbacks.batchSize ?? 100;
  type CsvPreviewCandidate =
    | { rowIndex: number; transaction: Transaction; status: "booked" }
    | {
        rowIndex: number;
        transaction: Transaction;
        status: PendingTransactionStatus;
        sourceStatus: Exclude<BankTransactionStatus, "Bokført">;
      };
  const candidates: CsvPreviewCandidate[] = [];
  const previewsByRowIndex = new Map<number, CsvRowPreview>();

  for (let start = 0; start < rows.length; start += batchSize) {
    if (callbacks.isCancelled()) return null;
    const end = Math.min(start + batchSize, rows.length);
    for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
      const row = rows[rowIndex]!;
      const result = mapCsvRowToTransaction(row, rowIndex, options);
      if (!result.ok) {
        previewsByRowIndex.set(rowIndex, { rowIndex, errors: result.errors });
        continue;
      }

      const normalizedRow = normalizeCsvRow(row, options.columnMapping);
      const mappedStatus = mapCsvImportedStatus(normalizedRow[CSV_COLUMN_NAMES.status] ?? "");
      candidates.push(mappedStatus.status === "booked"
        ? { rowIndex, transaction: result.transaction, status: "booked" }
        : {
            rowIndex,
            transaction: result.transaction,
            status: mappedStatus.status,
            sourceStatus: mappedStatus.sourceStatus,
          });
    }
    callbacks.onProgress(end, rows.length);
    await new Promise<void>((resolveBatch) => setImmediate(resolveBatch));
  }

  if (callbacks.isCancelled()) return null;
  const validTransactions = assignImportedTransactionIds(
    candidates.map(({ transaction }) => transaction),
    {
      sourceScopes: candidates.map((candidate) =>
        candidate.status !== "booked" && candidate.transaction.sourceReference?.trim()
          ? undefined
          : options.sourceScope
      ),
      sourceReferences: candidates.map(({ transaction }) => transaction.sourceReference),
    }
  );
  const transactions: Transaction[] = [];
  const pendingObservations: PendingTransactionObservation[] = [];
  candidates.forEach((candidate, index) => {
    const transaction = validTransactions[index]!;
    if (candidate.status === "booked") {
      transactions.push(transaction);
      previewsByRowIndex.set(candidate.rowIndex, {
        rowIndex: candidate.rowIndex,
        transaction,
        errors: [],
      });
      return;
    }

    const pendingObservation = createCsvPendingObservation(
      transaction,
      candidate.rowIndex,
      candidate.status,
      candidate.sourceStatus
    );
    pendingObservations.push(pendingObservation);
    previewsByRowIndex.set(candidate.rowIndex, {
      rowIndex: candidate.rowIndex,
      pendingObservation,
      errors: [],
    });
  });

  return {
    rows: Array.from({ length: rows.length }, (_, rowIndex) => previewsByRowIndex.get(rowIndex)!),
    transactions,
    ...(pendingObservations.length === 0 ? {} : { pendingObservations }),
  };
}

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

export function classifyPreviouslyImportedCsvCandidates(
  candidates: readonly Transaction[],
  previouslyImported: readonly Transaction[],
  snapshot: Pick<LedgerSnapshotData, "transactions" | "importJobs">,
  input: { filePath: string; accountId: string; sourceIdentity: string }
): ClassifiedDuplicateCandidate[] {
  const pendingCandidateIds = new Set(filterPreviouslyImportedCsvTransactions(candidates, snapshot, input)
    .map((transaction) => transaction.id));
  const classified = classifyDuplicateCandidates(candidates, previouslyImported);
  const legacyMatchesByFingerprint = new Map<string, Transaction[]>();
  for (const transaction of previouslyImported) {
    if (transaction.sourceReference?.trim()) continue;
    const fingerprint = buildTransactionFingerprint(transaction);
    const matches = legacyMatchesByFingerprint.get(fingerprint) ?? [];
    matches.push(transaction);
    legacyMatchesByFingerprint.set(fingerprint, matches);
  }

  return classified.map((candidate) => {
    if (candidate.duplicateMatch !== undefined || pendingCandidateIds.has(candidate.candidate.id)) {
      return candidate;
    }
    const fingerprint = buildTransactionFingerprint(candidate.candidate);
    const matchingTransaction = legacyMatchesByFingerprint.get(fingerprint)?.shift();
    return matchingTransaction === undefined
      ? candidate
      : {
          candidate: candidate.candidate,
          duplicateMatch: { matchingTransaction, matchBasis: "transaction-fingerprint" },
        };
  });
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

/** Runs the production CSV mapping, duplicate-decision, and persistence workflow. */
export function runCsvImportWorkflow(
  input: CsvImportWorkflowInput,
  dependencies: CsvImportWorkflowDependencies
): CsvImportResponse {
  const snapshot = dependencies.loadLedgerSnapshotData();
  const account = snapshot.accounts.find((candidate) => candidate.id === input.accountId);
  if (account === undefined) {
    throw new Error(`CSV import account not found: ${input.accountId}`);
  }
  const sourceRows = input.rows.map((row, sourceRowIndex): ImportReconciliationSourceRow => ({
    importJobId: input.importJobId,
    sourceRowIndex,
    ...extractCsvSourceAmount(row, input.columnMapping),
  }));
  const preview = previewCsvRows(input.rows, {
    householdId: input.householdId,
    accountId: input.accountId,
    importJobId: input.importJobId,
    idPrefix: input.importJobId,
    ...(input.columnMapping === undefined ? {} : { columnMapping: input.columnMapping }),
    sourceIdentity: input.sourceIdentity,
    sourceScope: input.sourceScope,
  });

  const skipped = preview.rows
    .filter((row) => row.transaction === undefined && row.errors.length > 0)
    .map((row) => ({ rowIndex: row.rowIndex, errors: row.errors }));
  const categorizedTransactions = categorizeTransactions(preview.transactions, dependencies.categoryRules);
  const reviewItems: ImportReviewItem[] = skipped.map(({ rowIndex, errors }) => ({
    id: `${input.importJobId}:review:${rowIndex}`,
    importJobId: input.importJobId,
    householdId: input.householdId,
    accountId: input.accountId,
    sourceType: "csv",
    sourceName: input.filePath,
    sourceIdentity: input.sourceIdentity,
    sourceRowIndex: rowIndex,
    rawRow: JSON.stringify(input.rows[rowIndex] ?? {}),
    parserErrors: errors.map(({ code, message, field }) => ({ code, message, field })),
    status: "unresolved",
    createdAtIso: input.finishedAtIso,
    updatedAtIso: input.finishedAtIso,
  }));
  const previouslyImported = dependencies.getImportedTransactionsForSource(
    "csv",
    input.filePath,
    input.accountId,
    input.sourceIdentity
  );
  const classifiedCandidates = classifyPreviouslyImportedCsvCandidates(
    categorizedTransactions,
    previouslyImported,
    snapshot,
    { filePath: input.filePath, accountId: input.accountId, sourceIdentity: input.sourceIdentity }
  );
  const sourceRowIndexByTransactionId = new Map<string, number>();
  for (const row of preview.rows) {
    if (row.transaction !== undefined) {
      sourceRowIndexByTransactionId.set(row.transaction.id, row.rowIndex);
    }
  }
  const classifiedCandidatesWithRowIndex = classifiedCandidates.map((candidate) => {
    const rowIndex = sourceRowIndexByTransactionId.get(candidate.candidate.id);
    if (rowIndex === undefined) {
      throw new Error("CSV duplicate classification lost its source row index.");
    }
    return { rowIndex, candidate };
  });
  const decisions = new Map((input.duplicateDecisions ?? []).map((decision) => [decision.rowIndex, decision.action]));
  const duplicateRowIndices = new Set(classifiedCandidatesWithRowIndex.flatMap(({ rowIndex, candidate }) =>
    candidate.duplicateMatch === undefined ? [] : [rowIndex]
  ));
  const missingDecisionIndex = Array.from(duplicateRowIndices).find((rowIndex) => !decisions.has(rowIndex));
  const unexpectedDecisionIndex = Array.from(decisions.keys()).find((rowIndex) => !duplicateRowIndices.has(rowIndex));
  if (missingDecisionIndex !== undefined || unexpectedDecisionIndex !== undefined) {
    const rowIndex = missingDecisionIndex ?? unexpectedDecisionIndex ?? -1;
    return {
      ok: false,
      errors: [{
        rowIndex,
        fields: ["duplicateDecision"],
        codes: ["DUPLICATE_DECISION_REQUIRED"],
        messages: ["Preview the current ledger state and explicitly choose whether to skip or import each duplicate candidate."],
      }],
    };
  }

  const pendingTransactions: Transaction[] = [];
  const dispositions = new Map<number, {
    disposition: ImportReconciliationDisposition;
    reviewItemId?: string;
  }>();
  const transactionIdByRowIndex = new Map<number, string>();
  for (const { rowIndex } of skipped) {
    dispositions.set(rowIndex, {
      disposition: "invalid",
      reviewItemId: `${input.importJobId}:review:${rowIndex}`,
    });
  }
  for (const observation of preview.pendingObservations ?? []) {
    dispositions.set(observation.sourceRowIndex, { disposition: "pending" });
  }
  let skippedDuplicateCount = 0;
  for (const { rowIndex, candidate } of classifiedCandidatesWithRowIndex) {
    if (candidate.duplicateMatch === undefined) {
      pendingTransactions.push(candidate.candidate);
      transactionIdByRowIndex.set(rowIndex, candidate.candidate.id);
      continue;
    }
    if (decisions.get(rowIndex) === "skip") {
      skippedDuplicateCount += 1;
      dispositions.set(rowIndex, { disposition: "skipped" });
      continue;
    }
    const importedDuplicate = { ...candidate.candidate, id: randomUUID() };
    pendingTransactions.push(importedDuplicate);
    transactionIdByRowIndex.set(rowIndex, importedDuplicate.id);
  }

  const importJob: ImportJob = {
    id: input.importJobId,
    householdId: input.householdId,
    sourceType: "csv",
    sourceName: input.filePath,
    candidateCount: preview.transactions.length + (preview.pendingObservations?.length ?? 0),
    validationFailureCount: skipped.length,
    startedAtIso: input.startedAtIso,
    finishedAtIso: input.finishedAtIso,
    provenance: {
      sourceIdentity: input.sourceIdentity,
      accountId: input.accountId,
      duplicateCount: skippedDuplicateCount,
    },
  };
  const insertedCount = dependencies.appendImportJobAndTransactions(
    importJob,
    pendingTransactions,
    reviewItems,
    preview.pendingObservations
  );
  const persistedTransactions = dependencies.getTransactionsForImportJob(input.importJobId);
  const persistedTransactionIds = new Set(persistedTransactions.map((transaction) => transaction.id));
  const reconciliationSourceRows = sourceRows.map((row) => {
    const disposition = dispositions.get(row.sourceRowIndex);
    if (disposition !== undefined) {
      return { ...row, ...disposition };
    }
    const transactionId = transactionIdByRowIndex.get(row.sourceRowIndex);
    if (transactionId === undefined) return row;
    return {
      ...row,
      disposition: persistedTransactionIds.has(transactionId) ? "persisted" as const : "not-persisted" as const,
    };
  });

  return {
    ok: true,
    importJobId: input.importJobId,
    transactionCount: insertedCount,
    ...((preview.pendingObservations?.length ?? 0) === 0
      ? {}
      : { pendingCount: preview.pendingObservations!.length }),
    duplicateCount: skippedDuplicateCount,
    unresolvedCount: reviewItems.length,
    reconciliation: reconcileImportJob(
      input.importJobId,
      reconciliationSourceRows,
      persistedTransactions,
      account.currencyCode
    ),
  };
}
