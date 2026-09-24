import type { PdfTextValidationError } from "../../domain/import/pdfTextParser.js";
import { assignImportedTransactionIds } from "../../domain/import/assignImportedTransactionIds.js";
import { filterPreviouslyImportedTransactions } from "../../domain/import/filterPreviouslyImportedTransactions.js";
import { buildRogalandImportJobId } from "../../domain/import/pdfTextParser.js";
import { categorizeTransaction } from "../../domain/categorization/categorizeTransaction.js";
import type { ParserAdapterRegistry } from "../../domain/import/parserAdapterRegistry.js";
import type { ImportJob, ImportJobStoryAnchor, Transaction } from "../../domain/types.js";

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
  duplicateCount: number;
  adapterId: string;
}

/** Returned when a PDF import has validation errors and no transactions are persisted. */
export interface PdfImportFailure {
  ok: false;
  errors: Array<{
    code: string;
    message: string;
  }>;
}

/** Discriminated union returned by the `import:pdf` IPC channel. */
export type PdfImportResponse = PdfImportSuccess | PdfImportFailure;

export interface PdfImportPreviewSuccess {
  ok: true;
  previewId: string;
  adapterId: string;
  transactions: Transaction[];
}

export type PdfImportPreviewResponse = PdfImportPreviewSuccess | PdfImportFailure;
export type PdfImportPreviewWorkflowResponse =
  | Omit<PdfImportPreviewSuccess, "previewId">
  | PdfImportFailure;

export interface PdfImportWorkflowInput extends PdfImportRequest {
  pdfText: string;
  importJobId: string;
  startedAtIso: string;
  finishedAtIso: string;
  categoryRules?: ReadonlyMap<string, string>;
}

export interface PdfImportWorkflowDependencies {
  parserRegistry: Pick<ParserAdapterRegistry, "parse">;
  appendImportJob: (importJob: ImportJob) => void;
  hasImportJob?: (importJobId: string) => boolean;
  getTransactionsForImportJob?: (importJobId: string) => Transaction[];
  getImportedTransactionsForSource?: (
    sourceType: ImportJob["sourceType"], sourceName: string, accountId: string, sourceIdentity?: string
  ) => Transaction[];
  appendImportJobAndTransactions?: (importJob: ImportJob, transactions: Transaction[]) => number;
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
  errors: PdfTextValidationError[]
): PdfImportFailure {
  return {
    ok: false,
    errors: errors.map((e) => ({ code: e.code, message: e.message })),
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
  sourceIdentity: string
): Transaction[] {
  return assignImportedTransactionIds(
    candidates.map((transaction) => categorizeTransaction(transaction)),
    { sourceIdentity }
  );
}

export function previewPdfImportWorkflow(
  input: Pick<PdfImportWorkflowInput, "pdfText" | "householdId" | "accountId">,
  parserRegistry: Pick<ParserAdapterRegistry, "parse">
): PdfImportPreviewWorkflowResponse {
  const parseResult = parserRegistry.parse(input.pdfText, {
    householdId: input.householdId,
    accountId: input.accountId,
  });

  if (!parseResult.ok) {
    return normalizePdfImportErrors(parseResult.errors);
  }

  return {
    ok: true,
    adapterId: parseResult.adapterId,
    transactions: buildPdfImportTransactions(
      parseResult.candidates,
      buildRogalandImportJobId(input.pdfText, input)
    ),
  };
}

export function runPdfImportWorkflow(
  input: PdfImportWorkflowInput,
  dependencies: PdfImportWorkflowDependencies
): PdfImportResponse {
  const parseResult = dependencies.parserRegistry.parse(input.pdfText, {
    householdId: input.householdId,
    accountId: input.accountId,
    importJobId: input.importJobId,
  });

  if (!parseResult.ok) {
    return normalizePdfImportErrors(parseResult.errors);
  }

  const transactions = assignImportedTransactionIds(
    parseResult.candidates.map((transaction) =>
      categorizeTransaction(transaction, input.categoryRules)
    ),
    { sourceIdentity: buildRogalandImportJobId(input.pdfText, input) }
  );

  const previousTransactions = [
    ...(dependencies.getTransactionsForImportJob?.(input.importJobId) ?? []),
    ...(dependencies.getImportedTransactionsForSource?.(
      "pdf",
      input.filePath,
      input.accountId,
      buildRogalandImportJobId(input.pdfText, input)
    ) ?? []),
  ].filter((transaction, index, all) =>
    all.findIndex((candidate) => candidate.id === transaction.id) === index
  );
  const pendingTransactions = filterPreviouslyImportedTransactions(transactions, previousTransactions);

  const importJob: ImportJob = {
    id: input.importJobId,
    householdId: input.householdId,
    sourceType: "pdf",
    sourceName: input.filePath,
    adapterId: parseResult.adapterId,
    candidateCount: transactions.length,
    validationFailureCount: 0,
    startedAtIso: input.startedAtIso,
    finishedAtIso: input.finishedAtIso,
    provenance: {
      sourceIdentity: parseResult.sourceIdentity,
      contentDigest: buildRogalandImportJobId(input.pdfText, input),
      adapterId: parseResult.adapterId,
      storyAnchor: PDF_IMPORT_STORY_ANCHOR,
    },
  };

  const insertedCount = dependencies.appendImportJobAndTransactions === undefined
    ? (() => {
        dependencies.appendImportJob(importJob);
        return dependencies.appendTransactions(pendingTransactions) ?? pendingTransactions.length;
      })()
    : dependencies.appendImportJobAndTransactions(importJob, pendingTransactions);
  dependencies.onTransactionsPersisted?.(pendingTransactions);

  return {
    ok: true,
    importJobId: input.importJobId,
    transactionCount: insertedCount,
    duplicateCount: transactions.length - insertedCount,
    adapterId: parseResult.adapterId,
  };
}
