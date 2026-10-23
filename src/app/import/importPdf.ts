import type {
  PdfTextExcludedRow,
  PdfTextParseBatchCallbacks,
  PdfTextUnresolvedRow,
  PdfTextValidationError,
} from "../../domain/import/pdfTextParser.js";
import { randomUUID } from "node:crypto";
import { assignImportedTransactionIds } from "../../domain/import/assignImportedTransactionIds.js";
import { filterPreviouslyImportedTransactions } from "../../domain/import/filterPreviouslyImportedTransactions.js";
import { classifyDuplicateCandidates, type DuplicateImportDecision, type DuplicateTransactionMatch } from "../../domain/import/filterPreviouslyImportedTransactions.js";
import { buildPdfImportContentDigest } from "../../domain/import/pdfTextParser.js";
import { categorizeTransaction } from "../../domain/categorization/categorizeTransaction.js";
import type { ParserAdapterRegistry } from "../../domain/import/parserAdapterRegistry.js";
import { createTextSourceDocument } from "../../domain/import/sourceDocument.js";
import type { SourceDocument } from "../../domain/import/sourceDocument.js";
import type {
  ImportJob,
  ImportJobStoryAnchor,
  ImportReviewItem,
  PendingTransactionObservation,
  Transaction,
  CurrencyCode,
} from "../../domain/types.js";
import { resolve } from "node:path";
import {
  reconcileImportJob,
  type ImportReconciliation,
  type ImportReconciliationDisposition,
  type ImportReconciliationSourceRow,
} from "../../domain/import/importReconciliation.js";

/** Shape of a normalized PDF import request passed from the renderer to the main process via IPC. */
export interface PdfImportRequest {
  filePath: string;
  householdId: string;
  accountId: string;
}

/** Returned when a PDF import completes without validation errors and transactions are persisted. */
export interface PdfImportSuccess {
  ok: true;
  importJobId: string;
  transactionCount: number;
  pendingCount?: number;
  duplicateCount: number;
  excludedRowCount: number;
  adapterId: string;
  unresolvedRowCount?: number;
  reconciliation: ImportReconciliation;
}

/** Returned when a PDF import has validation errors and no transactions are persisted. */
export interface PdfImportFailure {
  ok: false;
  errors: Array<{
    code: string;
    message: string;
    lineNumber?: number;
    field?: string;
  }>;
  unresolvedInput?: {
    sourceName: string;
    sourceDocument?: SourceDocument;
  };
}

/** Discriminated union returned by the `import:pdf` IPC channel. */
export type PdfImportResponse = PdfImportSuccess | PdfImportFailure;

export interface PdfImportPreviewSuccess {
  ok: true;
  previewId: string;
  adapterId: string;
  transactions: Transaction[];
  pendingObservations?: PendingTransactionObservation[];
  excludedRowCount: number;
  excludedRows: PdfTextExcludedRow[];
  unresolvedRows?: PdfTextUnresolvedRow[];
  duplicateCandidates?: Array<{
    rowIndex: number;
    transactionId: string;
    duplicateMatch: DuplicateTransactionMatch;
  }>;
}

export type PdfImportPreviewResponse = PdfImportPreviewSuccess | PdfImportFailure;
export type PdfImportPreviewWorkflowResponse =
  | Omit<PdfImportPreviewSuccess, "previewId">
  | PdfImportFailure;

export interface PdfImportWorkflowInput extends PdfImportRequest {
  pdfText: string;
  sourceDocument?: SourceDocument;
  importJobId: string;
  startedAtIso: string;
  finishedAtIso: string;
  categoryRules?: ReadonlyMap<string, string>;
  duplicateDecisions?: DuplicateImportDecision[];
  acknowledgeExcludedRows?: boolean;
}

export interface PdfImportWorkflowDependencies {
  parserRegistry: Pick<ParserAdapterRegistry, "parse">;
  appendImportJob: (importJob: ImportJob) => void;
  hasImportJob?: (importJobId: string) => boolean;
  getTransactionsForImportJob: (importJobId: string) => Transaction[];
  getAccountCurrencyCode?: (accountId: string) => CurrencyCode | undefined;
  getImportedTransactionsForSource?: (
    sourceType: ImportJob["sourceType"], sourceName: string, accountId: string, sourceIdentity?: string
  ) => Transaction[];
  getExistingTransactionsForAccount?: (accountId: string) => Transaction[];
  appendImportJobAndTransactions?: (
    importJob: ImportJob,
    transactions: Transaction[],
    reviewItems?: ImportReviewItem[],
    pendingObservations?: PendingTransactionObservation[]
  ) => number;
  appendTransactions: (transactions: Transaction[]) => number | void;
  onTransactionsPersisted?: (transactions: Transaction[]) => void;
}

const PDF_IMPORT_STORY_ANCHOR: ImportJobStoryAnchor = {
  enablerIssueId: "32",
  featureIssueId: "15",
};

/**
 * Builds a normalized PdfImportRequest from a raw file path and household/account context.
 * Trims whitespace from the path and enforces required fields as non-empty strings.
 */
export function buildPdfImportRequest(
  filePath: string,
  options: { householdId: string; accountId: string }
): PdfImportRequest {
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
  };
}

/**
 * Converts validation errors from the PDF parser into the stable
 * PdfImportFailure shape returned over IPC.
 */
export function normalizePdfImportErrors(
  errors: PdfTextValidationError[],
  unresolvedInput?: PdfImportFailure["unresolvedInput"]
): PdfImportFailure {
  return {
    ok: false,
    errors: errors.map((error) => ({
      code: error.code,
      message: error.message,
      ...(error.lineNumber === undefined ? {} : { lineNumber: error.lineNumber }),
      ...(error.field === undefined ? {} : { field: error.field }),
    })),
    ...(unresolvedInput === undefined ? {} : { unresolvedInput }),
  };
}

export function appendUniqueTransactions(
  target: Transaction[],
  transactions: readonly Transaction[]
): void {
  const existingIds = new Set(target.map((transaction) => transaction.id));

  for (const transaction of transactions) {
    if (existingIds.has(transaction.id)) {
      continue;
    }

    target.push(transaction);
    existingIds.add(transaction.id);
  }
}

function buildPdfImportTransactions(
  candidates: Transaction[],
  sourceScope: string
): Transaction[] {
  return assignImportedTransactionIds(
    candidates.map((transaction) => categorizeTransaction(transaction)),
    { sourceScope }
  );
}

function canonicalSourceScope(filePath: string): string {
  const resolvedPath = resolve(filePath);
  return process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
}

export function previewPdfImportWorkflow(
  input: Pick<PdfImportWorkflowInput, "pdfText" | "filePath" | "householdId" | "accountId" | "sourceDocument">,
  parserRegistry: Pick<ParserAdapterRegistry, "parse">
): PdfImportPreviewWorkflowResponse {
  const sourceDocument = input.sourceDocument ?? createTextSourceDocument(input.pdfText);
  const parseResult = parserRegistry.parse(sourceDocument, {
    householdId: input.householdId,
    accountId: input.accountId,
  });

  if (!parseResult.ok) {
    return normalizePdfImportErrors(parseResult.errors, {
      sourceName: input.filePath,
      sourceDocument,
    });
  }

  return {
    ok: true,
    adapterId: parseResult.adapterId,
    excludedRowCount: parseResult.excludedRows?.length ?? 0,
    excludedRows: parseResult.excludedRows ?? [],
    ...(parseResult.unresolvedRows === undefined || parseResult.unresolvedRows.length === 0
      ? {}
      : { unresolvedRows: parseResult.unresolvedRows }),
    ...(parseResult.pendingObservations === undefined
      ? {}
      : { pendingObservations: parseResult.pendingObservations }),
    transactions: buildPdfImportTransactions(
      parseResult.candidates,
      canonicalSourceScope(input.filePath)
    ),
  };
}

export async function previewPdfImportWorkflowInBatches(
  input: Pick<PdfImportWorkflowInput, "pdfText" | "filePath" | "householdId" | "accountId" | "sourceDocument">,
  parserRegistry: Pick<ParserAdapterRegistry, "parseInBatches">,
  callbacks: PdfTextParseBatchCallbacks
): Promise<PdfImportPreviewWorkflowResponse | null> {
  const sourceDocument = input.sourceDocument ?? createTextSourceDocument(input.pdfText);
  const parseResult = await parserRegistry.parseInBatches(sourceDocument, {
    householdId: input.householdId,
    accountId: input.accountId,
  }, callbacks);
  if (parseResult === null) return null;
  if (!parseResult.ok) {
    return normalizePdfImportErrors(parseResult.errors, {
      sourceName: input.filePath,
      sourceDocument,
    });
  }

  return {
    ok: true,
    adapterId: parseResult.adapterId,
    excludedRowCount: parseResult.excludedRows?.length ?? 0,
    excludedRows: parseResult.excludedRows ?? [],
    ...(parseResult.unresolvedRows === undefined || parseResult.unresolvedRows.length === 0
      ? {}
      : { unresolvedRows: parseResult.unresolvedRows }),
    ...(parseResult.pendingObservations === undefined
      ? {}
      : { pendingObservations: parseResult.pendingObservations }),
    transactions: buildPdfImportTransactions(
      parseResult.candidates,
      canonicalSourceScope(input.filePath)
    ),
  };
}

export function runPdfImportWorkflow(
  input: PdfImportWorkflowInput,
  dependencies: PdfImportWorkflowDependencies
): PdfImportResponse {
  const sourceDocument = input.sourceDocument ?? createTextSourceDocument(input.pdfText);
  const parseResult = dependencies.parserRegistry.parse(sourceDocument, {
    householdId: input.householdId,
    accountId: input.accountId,
    importJobId: input.importJobId,
  });

  if (!parseResult.ok) {
    return normalizePdfImportErrors(parseResult.errors, {
      sourceName: input.filePath,
      sourceDocument,
    });
  }
  if (parseResult.sourceRows === undefined) {
    return {
      ok: false,
      errors: [{
        code: "SOURCE_ACCOUNTING_UNAVAILABLE",
        message: "The statement parser did not provide source rows for reconciliation.",
      }],
    };
  }
  const sourceRowIndexByCandidateId = new Map(
    parseResult.sourceRows.flatMap((row) =>
      row.candidateId === undefined ? [] : [[row.candidateId, row.lineNumber - 1] as const]
    )
  );
  const unmatchedCandidate = parseResult.candidates.find(
    (candidate) => !sourceRowIndexByCandidateId.has(candidate.id)
  );
  if (unmatchedCandidate !== undefined) {
    return {
      ok: false,
      errors: [{
        code: "SOURCE_ACCOUNTING_UNAVAILABLE",
        message: "A parsed transaction could not be linked to its source row.",
      }],
    };
  }

  const excludedRowCount = parseResult.excludedRows?.length ?? 0;
  const pendingObservations = parseResult.pendingObservations ?? [];
  const unresolvedRows = parseResult.unresolvedRows ?? [];

  const categorizedCandidates = parseResult.candidates.map((transaction) =>
    categorizeTransaction(transaction, input.categoryRules)
  );
  const transactions = assignImportedTransactionIds(
    categorizedCandidates,
    { sourceScope: canonicalSourceScope(input.filePath) }
  );
  const sourceRowIndexByTransactionId = new Map<string, number>();
  categorizedCandidates.forEach((candidate, index) => {
    const sourceRowIndex = sourceRowIndexByCandidateId.get(candidate.id);
    const assignedTransaction = transactions[index];
    if (sourceRowIndex !== undefined && assignedTransaction !== undefined) {
      sourceRowIndexByTransactionId.set(assignedTransaction.id, sourceRowIndex);
    }
  });
  const reviewItems: ImportReviewItem[] = unresolvedRows.map((row) => ({
    id: `${input.importJobId}:review:${row.lineNumber}`,
    importJobId: input.importJobId,
    householdId: input.householdId,
    accountId: input.accountId,
    sourceType: "pdf",
    sourceName: input.filePath,
    sourceIdentity: parseResult.sourceIdentity,
    sourceRowIndex: Math.max(0, row.lineNumber - 1),
    rawRow: row.rawRow,
    parserErrors: row.errors.map(({ code, message, field }) => ({
      code,
      message,
      ...(field === undefined ? {} : { field }),
    })),
    status: "unresolved",
    createdAtIso: input.finishedAtIso,
    updatedAtIso: input.finishedAtIso,
  }));

  const previousTransactions = [
    ...(dependencies.getTransactionsForImportJob?.(input.importJobId) ?? []),
    ...(dependencies.getImportedTransactionsForSource?.(
      "pdf",
      input.filePath,
      input.accountId,
      buildPdfImportContentDigest(input.pdfText, input, parseResult.adapterId)
    ) ?? []),
  ].filter((transaction, index, all) =>
    all.findIndex((candidate) => candidate.id === transaction.id) === index
  );
  let pendingTransactions: Transaction[];
  let duplicateCount: number;
  const dispositions = new Map<number, {
    disposition: ImportReconciliationDisposition;
    reviewItemId?: string;
  }>();
  for (const observation of pendingObservations) {
    dispositions.set(observation.sourceRowIndex, { disposition: "pending" });
  }
  for (const row of unresolvedRows) {
    dispositions.set(row.lineNumber - 1, {
      disposition: "invalid",
      reviewItemId: `${input.importJobId}:review:${row.lineNumber}`,
    });
  }
  const transactionIdByRowIndex = new Map<number, string>();
  if (input.duplicateDecisions === undefined) {
    pendingTransactions = filterPreviouslyImportedTransactions(transactions, previousTransactions);
    duplicateCount = 0;
    const pendingTransactionIds = new Set(pendingTransactions.map((transaction) => transaction.id));
    for (const transaction of transactions) {
      const sourceRowIndex = sourceRowIndexByTransactionId.get(transaction.id);
      if (sourceRowIndex === undefined) {
        throw new Error("PDF duplicate classification lost its source row index.");
      }
      if (pendingTransactionIds.has(transaction.id)) {
        transactionIdByRowIndex.set(sourceRowIndex, transaction.id);
      } else {
        dispositions.set(sourceRowIndex, { disposition: "duplicate" });
      }
    }
  } else {
    const existingTransactions = dependencies.getExistingTransactionsForAccount?.(input.accountId) ?? previousTransactions;
    const classifiedCandidates = classifyDuplicateCandidates(transactions, existingTransactions);
    const decisions = new Map(input.duplicateDecisions.map((decision) => [decision.rowIndex, decision.action]));
    const duplicateRowIndices = new Set(classifiedCandidates.flatMap((candidate, index) =>
      candidate.duplicateMatch === undefined ? [] : [index]
    ));
    const missingDecisionIndex = Array.from(duplicateRowIndices).find((rowIndex) => !decisions.has(rowIndex));
    const unexpectedDecisionIndex = Array.from(decisions.keys()).find((rowIndex) => !duplicateRowIndices.has(rowIndex));
    if (missingDecisionIndex !== undefined || unexpectedDecisionIndex !== undefined) {
      return {
        ok: false,
        errors: [{
          code: "DUPLICATE_DECISION_REQUIRED",
          message: "Preview the current ledger state and explicitly choose whether to skip or import each duplicate candidate.",
        }],
      };
    }

    pendingTransactions = [];
    duplicateCount = 0;
    for (const [candidateIndex, candidate] of classifiedCandidates.entries()) {
      const sourceRowIndex = sourceRowIndexByTransactionId.get(candidate.candidate.id);
      if (sourceRowIndex === undefined) {
        throw new Error("PDF duplicate classification lost its source row index.");
      }
      if (candidate.duplicateMatch === undefined) {
        pendingTransactions.push(candidate.candidate);
        transactionIdByRowIndex.set(sourceRowIndex, candidate.candidate.id);
      } else if (decisions.get(candidateIndex) === "skip") {
        duplicateCount += 1;
        dispositions.set(sourceRowIndex, { disposition: "duplicate" });
      } else {
        const importedDuplicate = { ...candidate.candidate, id: randomUUID() };
        pendingTransactions.push(importedDuplicate);
        transactionIdByRowIndex.set(sourceRowIndex, importedDuplicate.id);
      }
    }
  }

  const importJob: ImportJob = {
    id: input.importJobId,
    householdId: input.householdId,
    sourceType: "pdf",
    sourceName: input.filePath,
    adapterId: parseResult.adapterId,
    candidateCount: transactions.length + pendingObservations.length,
    validationFailureCount: reviewItems.length,
    startedAtIso: input.startedAtIso,
    finishedAtIso: input.finishedAtIso,
    provenance: {
      sourceIdentity: parseResult.sourceIdentity,
      contentDigest: buildPdfImportContentDigest(input.pdfText, input, parseResult.adapterId),
      adapterId: parseResult.adapterId,
      accountId: input.accountId,
      ...(input.duplicateDecisions === undefined ? {} : { duplicateCount }),
      storyAnchor: PDF_IMPORT_STORY_ANCHOR,
    },
  };

  let insertedCount: number;
  if (dependencies.appendImportJobAndTransactions === undefined) {
    if (reviewItems.length > 0 || pendingObservations.length > 0) {
      throw new Error("PDF review and pending rows require atomic import-job, transaction, and observation persistence.");
    }
    dependencies.appendImportJob(importJob);
    insertedCount = dependencies.appendTransactions(pendingTransactions) ?? pendingTransactions.length;
  } else {
    insertedCount = dependencies.appendImportJobAndTransactions(
      importJob,
      pendingTransactions,
      reviewItems,
      pendingObservations
    );
  }
  const reportedDuplicateCount = input.duplicateDecisions === undefined
    ? transactions.length - insertedCount
    : duplicateCount;
  const persistedTransactions = dependencies.getTransactionsForImportJob(input.importJobId);
  const persistedTransactionIds = new Set(persistedTransactions.map((transaction) => transaction.id));
  const reconciliationSourceRows = parseResult.sourceRows.map(
    (row): ImportReconciliationSourceRow => {
      const sourceRowIndex = row.lineNumber - 1;
      const disposition = dispositions.get(sourceRowIndex);
      if (disposition !== undefined) {
        return {
          importJobId: input.importJobId,
          sourceRowIndex,
          ...(row.amountMinor === undefined ? {} : { amountMinor: row.amountMinor }),
          ...(row.currencyCode === undefined ? {} : { currencyCode: row.currencyCode }),
          ...disposition,
        };
      }
      const transactionId = transactionIdByRowIndex.get(sourceRowIndex);
      return {
        importJobId: input.importJobId,
        sourceRowIndex,
        ...(row.amountMinor === undefined ? {} : { amountMinor: row.amountMinor }),
        ...(row.currencyCode === undefined ? {} : { currencyCode: row.currencyCode }),
        ...(transactionId === undefined
          ? {}
          : {
              disposition: persistedTransactionIds.has(transactionId)
                ? "persisted" as const
                : "not-persisted" as const,
            }),
      };
    }
  );
  const defaultCurrencyCode = dependencies.getAccountCurrencyCode?.(input.accountId) ??
    parseResult.sourceRows.find((row) => row.currencyCode !== undefined)?.currencyCode;
  if (defaultCurrencyCode === undefined) {
    throw new Error(`PDF import account currency is unavailable: ${input.accountId}`);
  }
  const reconciliation = reconcileImportJob(
    input.importJobId,
    reconciliationSourceRows,
    persistedTransactions,
    defaultCurrencyCode
  );
  dependencies.onTransactionsPersisted?.(pendingTransactions);

  return {
    ok: true,
    importJobId: input.importJobId,
    transactionCount: insertedCount,
    ...(pendingObservations.length === 0 ? {} : { pendingCount: pendingObservations.length }),
    duplicateCount: reportedDuplicateCount,
    excludedRowCount,
    adapterId: parseResult.adapterId,
    ...(reviewItems.length === 0 ? {} : { unresolvedRowCount: reviewItems.length }),
    reconciliation,
  };
}
