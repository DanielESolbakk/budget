import type { PdfTextValidationError } from "../../domain/import/pdfTextParser.js";
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

export interface PdfImportWorkflowInput extends PdfImportRequest {
  pdfText: string;
  importJobId: string;
  startedAtIso: string;
  finishedAtIso: string;
}

export interface PdfImportWorkflowDependencies {
  parserRegistry: Pick<ParserAdapterRegistry, "parse">;
  appendImportJob: (importJob: ImportJob) => void;
  appendTransactions: (transactions: Transaction[]) => void;
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

export function runPdfImportWorkflow(
  input: PdfImportWorkflowInput,
  dependencies: PdfImportWorkflowDependencies
): PdfImportResponse {
  const parseResult = dependencies.parserRegistry.parse(input.pdfText, {
    householdId: input.householdId,
    accountId: input.accountId,
    importJobId: input.importJobId,
    idPrefix: input.importJobId,
  });

  if (!parseResult.ok) {
    return normalizePdfImportErrors(parseResult.errors);
  }

  const importJob: ImportJob = {
    id: input.importJobId,
    householdId: input.householdId,
    sourceType: "pdf",
    sourceName: input.filePath,
    adapterId: parseResult.adapterId,
    candidateCount: parseResult.candidates.length,
    validationFailureCount: 0,
    startedAtIso: input.startedAtIso,
    finishedAtIso: input.finishedAtIso,
    provenance: {
      sourceIdentity: parseResult.sourceIdentity,
      adapterId: parseResult.adapterId,
      storyAnchor: PDF_IMPORT_STORY_ANCHOR,
    },
  };

  dependencies.appendImportJob(importJob);
  dependencies.appendTransactions(parseResult.candidates);
  dependencies.onTransactionsPersisted?.(parseResult.candidates);

  return {
    ok: true,
    importJobId: input.importJobId,
    transactionCount: parseResult.candidates.length,
    adapterId: parseResult.adapterId,
  };
}
