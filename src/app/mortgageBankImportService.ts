import { constants as bufferConstants } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { TextDecoder } from "node:util";
import { DEFAULT_HOUSEHOLD_SHARE_BASIS_POINTS } from "../domain/householdShareValidation.js";
import { validateSourceOnlyLoanRecordInput } from "../domain/loanRecordValidation.js";
import {
  assessMortgageDocumentPairing,
  parseRogalandMortgageHtml,
  ROGALAND_MORTGAGE_PARSER_VERSION,
  validateRogalandMortgageSchedule,
} from "../domain/import/rogalandMortgageHtml.js";
import type { LocalLedgerDatabase } from "./backup/localLedgerSqlite.js";
import type {
  MortgageBankImportPreview,
  MortgageBankImportPreviewDocument,
  MortgageBankImportReviewState,
  MortgageDocumentIdentityEvidence,
  MortgageDocumentPairingResult,
  MortgageEvidenceVersion,
  MortgageEvidenceVersionInput,
  MortgageEvidenceAcceptanceSummary,
  MortgageHtmlParseLimits,
  MortgageHtmlParseResult,
  MortgageImportTarget,
  MortgageSourceRole,
  MortgageSchedulePreviewDocument,
  MortgageScheduleValidationResult,
  MortgageTermComparison,
} from "../shared/mortgageBankEvidence.js";
import {
  PROVISIONAL_MORTGAGE_HTML_MAX_BYTES,
  PROVISIONAL_MORTGAGE_HTML_PARSE_LIMITS,
} from "../shared/mortgageBankEvidence.js";
import type { SourceOnlyLoanRecord, SourceOnlyLoanRecordInput } from "../domain/types.js";

const READ_CHUNK_BYTES = 64 * 1024;

export interface MortgageSchedulePreviewInput {
  readonly filePath: string;
  readonly maxBytes: number;
  readonly parserLimits: MortgageHtmlParseLimits;
  readonly loanIdentity: MortgageDocumentIdentityEvidence;
  readonly attachmentConfirmed: boolean;
  readonly signal?: AbortSignal;
}

export interface MortgageDocumentPairPreviewInput {
  readonly detailsFilePath: string;
  readonly scheduleFilePath: string;
  readonly maxBytesPerFile: number;
  readonly parserLimits: MortgageHtmlParseLimits;
  readonly attachmentConfirmed: boolean;
  readonly signal?: AbortSignal;
}

export interface MortgageSchedulePreview {
  readonly reviewState:
    | "schedule-checks-passed"
    | "review-required"
    | "invalid"
    | "unsupported"
    | "attachment-confirmation-required"
    | "identity-conflict";
  readonly parsedDocument: MortgageSchedulePreviewDocument;
  readonly validation: MortgageScheduleValidationResult | null;
  readonly pairing: MortgageDocumentPairingResult | null;
}

export interface MortgageDocumentPairPreview {
  readonly reviewState:
    | "paired-schedule-checks-passed"
    | "review-required"
    | "invalid"
    | "unsupported"
    | "attachment-confirmation-required"
    | "identity-conflict";
  readonly detailsDocument: MortgageSchedulePreviewDocument;
  readonly scheduleDocument: MortgageSchedulePreviewDocument;
  readonly validation: MortgageScheduleValidationResult | null;
  readonly pairing: MortgageDocumentPairingResult | null;
}

export interface MortgageBankImportService {
  beginPreviewRequest: (requestId: string) => void;
  finishPreviewRequest: (requestId: string) => void;
  previewFiles: (input: {
    readonly requestId?: string;
    readonly filePaths: readonly string[];
    readonly target: MortgageImportTarget;
    readonly attachmentConfirmed: boolean;
  }) => Promise<MortgageBankImportPreview>;
  confirmAttachmentPreview: (previewId: string) => MortgageBankImportPreview;
  acceptPreview: (
    previewId: string,
    acceptPartial?: boolean,
    acknowledgeTermDifferences?: boolean
  ) => MortgageEvidenceVersion;
  cancelPreview: (previewId: string) => boolean;
  listEvidenceSummaries: () => MortgageEvidenceAcceptanceSummary[];
}

export interface MortgageBankImportServiceOptions {
  readonly maxBytesPerFile?: number;
  readonly parserLimits?: MortgageHtmlParseLimits;
  readonly createId?: () => string;
  readonly now?: () => Date;
  readonly getDatabaseGeneration?: () => number;
}

function maskIdentifier(value: string): string {
  const compact = value.replace(/\s+/g, "");
  return compact.length <= 4 ? "****" : `****${compact.slice(-4)}`;
}

function redactIdentityValues(value: string, references: readonly string[]): string {
  let redacted = value;
  for (const reference of references) {
    const compact = reference.replace(/\s+/g, "");
    if (compact === "") continue;
    const pattern = compact
      .split("")
      .map((character) => character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("\\s*");
    redacted = redacted.replace(new RegExp(pattern, "gi"), maskIdentifier(reference));
  }
  return redacted;
}

function toMortgageSchedulePreviewDocument(
  document: MortgageHtmlParseResult
): MortgageSchedulePreviewDocument {
  const references = document.identityEvidence.loanReferenceValues;
  const redact = (value: string): string => redactIdentityValues(value, references);
  const { identityEvidence, ...documentWithoutIdentity } = document;
  return {
    ...documentWithoutIdentity,
    detailsFields: documentWithoutIdentity.detailsFields.map((field) => ({
      ...field,
      sourceLabel: redact(field.sourceLabel),
      sourceValue: redact(field.sourceValue),
    })),
    identityDisplay: {
      maskedLoanReference: identityEvidence.loanReference === null
        ? null
        : maskIdentifier(identityEvidence.loanReference),
      maskedLoanReferenceValues: references.map(maskIdentifier),
      currencyCode: identityEvidence.currencyCode,
      currencyValues: identityEvidence.currencyValues,
      conflicts: identityEvidence.conflicts,
    },
    openingBalanceEvidence: documentWithoutIdentity.openingBalanceEvidence === null
      ? null
      : {
          ...documentWithoutIdentity.openingBalanceEvidence,
          sourceLabel: redact(documentWithoutIdentity.openingBalanceEvidence.sourceLabel),
          sourceValue: redact(documentWithoutIdentity.openingBalanceEvidence.sourceValue),
        },
    scheduleRows: documentWithoutIdentity.scheduleRows.map((row) => ({
      periodLabel: redact(row.periodLabel),
      period: row.period,
      principalMinor: row.principalMinor,
      interestMinor: row.interestMinor,
      feeMinor: row.feeMinor,
      paymentMinor: row.paymentMinor,
      projectedClosingBalanceMinor: row.projectedClosingBalanceMinor,
      sourceHeaders: row.sourceHeaders.map(redact),
    })),
  };
}

export async function readBoundedMortgageHtmlFile(
  filePath: string,
  maxBytes: number,
  signal?: AbortSignal
): Promise<string> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes >= bufferConstants.MAX_LENGTH) {
    throw new RangeError("Mortgage HTML byte limit must be a positive safe integer.");
  }
  signal?.throwIfAborted();

  const file = await open(filePath, "r");
  try {
    const initialStat = await file.stat({ bigint: true });
    if (initialStat.size > BigInt(maxBytes)) {
      throw new RangeError("Mortgage HTML file exceeds the configured byte limit.");
    }

    const initialSize = Number(initialStat.size);
    const bytes = Buffer.allocUnsafe(initialSize + 1);
    let totalBytesRead = 0;
    while (totalBytesRead < bytes.length) {
      signal?.throwIfAborted();
      const readSize = Math.min(READ_CHUNK_BYTES, bytes.length - totalBytesRead);
      const { bytesRead } = await file.read(bytes, totalBytesRead, readSize, null);
      if (bytesRead === 0) break;
      totalBytesRead += bytesRead;
      if (totalBytesRead > maxBytes) {
        throw new RangeError("Mortgage HTML file exceeds the configured byte limit.");
      }
    }

    const finalStat = await file.stat({ bigint: true });
    if (finalStat.size !== initialStat.size ||
        finalStat.mtimeNs !== initialStat.mtimeNs ||
        finalStat.ctimeNs !== initialStat.ctimeNs ||
        totalBytesRead !== initialSize) {
      throw new RangeError("Mortgage HTML file changed while being read.");
    }

    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, totalBytesRead));
  } finally {
    await file.close();
  }
}

export async function previewMortgageScheduleFile(
  input: MortgageSchedulePreviewInput
): Promise<MortgageSchedulePreview> {
  const source = await readBoundedMortgageHtmlFile(input.filePath, input.maxBytes, input.signal);
  const parsedDocument = parseRogalandMortgageHtml(source, input.parserLimits);
  return createMortgageSchedulePreview(
    parsedDocument,
    input.loanIdentity,
    input.attachmentConfirmed
  );
}

function createMortgageSchedulePreview(
  parsedDocument: MortgageHtmlParseResult,
  loanIdentity: MortgageDocumentIdentityEvidence,
  attachmentConfirmed: boolean
): MortgageSchedulePreview {
  const previewDocument = toMortgageSchedulePreviewDocument(parsedDocument);
  if (parsedDocument.role !== "schedule" ||
      parsedDocument.parseStatus === "unsupported" ||
      parsedDocument.scheduleRows.length === 0) {
    return { reviewState: "unsupported", parsedDocument: previewDocument, validation: null, pairing: null };
  }

  const pairing = assessMortgageDocumentPairing(
    loanIdentity,
    parsedDocument.identityEvidence,
    attachmentConfirmed
  );
  if (pairing.status === "conflict") {
    return {
      reviewState: "identity-conflict",
      parsedDocument: previewDocument,
      validation: null,
      pairing,
    };
  }

  if (pairing.status === "confirmation-required") {
    return {
      reviewState: "attachment-confirmation-required",
      parsedDocument: previewDocument,
      validation: null,
      pairing,
    };
  }

  const validation = validateRogalandMortgageSchedule(parsedDocument);
  if (validation.status === "invalid") {
    return { reviewState: "invalid", parsedDocument: previewDocument, validation, pairing };
  }
  if (parsedDocument.parseStatus === "partial" || validation.status === "partial") {
    return { reviewState: "review-required", parsedDocument: previewDocument, validation, pairing };
  }
  return {
    reviewState: "schedule-checks-passed",
    parsedDocument: previewDocument,
    validation,
    pairing,
  };
}

function createMortgageDetailsPreview(
  parsedDocument: MortgageHtmlParseResult,
  loanIdentity: MortgageDocumentIdentityEvidence,
  attachmentConfirmed: boolean
): {
  reviewState: MortgageBankImportReviewState;
  parsedDocument: MortgageSchedulePreviewDocument;
  pairing: MortgageDocumentPairingResult | null;
} {
  const previewDocument = toMortgageSchedulePreviewDocument(parsedDocument);
  if (parsedDocument.role !== "details" ||
      parsedDocument.parseStatus === "unsupported" ||
      parsedDocument.detailsFields.length === 0) {
    return { reviewState: "unsupported", parsedDocument: previewDocument, pairing: null };
  }

  const pairing = assessMortgageDocumentPairing(
    loanIdentity,
    parsedDocument.identityEvidence,
    attachmentConfirmed
  );
  if (pairing.status === "conflict") {
    return { reviewState: "identity-conflict", parsedDocument: previewDocument, pairing };
  }
  if (pairing.status === "confirmation-required") {
    return {
      reviewState: "attachment-confirmation-required",
      parsedDocument: previewDocument,
      pairing,
    };
  }
  return {
    reviewState: parsedDocument.parseStatus === "partial" ? "review-required" : "details-checks-passed",
    parsedDocument: previewDocument,
    pairing,
  };
}

export async function previewMortgageDocumentPair(
  input: MortgageDocumentPairPreviewInput
): Promise<MortgageDocumentPairPreview> {
  const detailsSource = await readBoundedMortgageHtmlFile(
    input.detailsFilePath,
    input.maxBytesPerFile,
    input.signal
  );
  const detailsDocument = parseRogalandMortgageHtml(detailsSource, input.parserLimits);
  const scheduleSource = await readBoundedMortgageHtmlFile(
    input.scheduleFilePath,
    input.maxBytesPerFile,
    input.signal
  );
  const scheduleDocument = parseRogalandMortgageHtml(scheduleSource, input.parserLimits);
  return createMortgageDocumentPairPreview(
    detailsDocument,
    scheduleDocument,
    input.attachmentConfirmed
  );
}

function createMortgageDocumentPairPreview(
  detailsDocument: MortgageHtmlParseResult,
  scheduleDocument: MortgageHtmlParseResult,
  attachmentConfirmed: boolean
): MortgageDocumentPairPreview {
  const detailsPreview = toMortgageSchedulePreviewDocument(detailsDocument);
  const schedulePreview = toMortgageSchedulePreviewDocument(scheduleDocument);

  if (detailsDocument.role !== "details" ||
      detailsDocument.parseStatus === "unsupported" ||
      scheduleDocument.role !== "schedule" ||
      scheduleDocument.parseStatus === "unsupported" ||
      scheduleDocument.scheduleRows.length === 0) {
    return {
      reviewState: "unsupported",
      detailsDocument: detailsPreview,
      scheduleDocument: schedulePreview,
      validation: null,
      pairing: null,
    };
  }

  const pairing = assessMortgageDocumentPairing(
    detailsDocument.identityEvidence,
    scheduleDocument.identityEvidence,
    attachmentConfirmed
  );
  if (pairing.status === "conflict") {
    return {
      reviewState: "identity-conflict",
      detailsDocument: detailsPreview,
      scheduleDocument: schedulePreview,
      validation: null,
      pairing,
    };
  }
  if (pairing.status === "confirmation-required") {
    return {
      reviewState: "attachment-confirmation-required",
      detailsDocument: detailsPreview,
      scheduleDocument: schedulePreview,
      validation: null,
      pairing,
    };
  }

  const validation = validateRogalandMortgageSchedule(scheduleDocument);
  if (validation.status === "invalid") {
    return {
      reviewState: "invalid",
      detailsDocument: detailsPreview,
      scheduleDocument: schedulePreview,
      validation,
      pairing,
    };
  }
  if (detailsDocument.parseStatus === "partial" ||
      scheduleDocument.parseStatus === "partial" ||
      validation.status === "partial") {
    return {
      reviewState: "review-required",
      detailsDocument: detailsPreview,
      scheduleDocument: schedulePreview,
      validation,
      pairing,
    };
  }
  return {
    reviewState: "paired-schedule-checks-passed",
    detailsDocument: detailsPreview,
    scheduleDocument: schedulePreview,
    validation,
    pairing,
  };
}

interface StoredMortgageImportPreview {
  readonly preview: MortgageBankImportPreview;
  readonly householdId: string;
  readonly databaseGeneration: number;
  readonly expectedLoanRevision: string | null;
  readonly expectedVersionNumber: number;
  readonly sourceOnlyLoanInput: SourceOnlyLoanRecordInput | null;
  readonly parserLimits: MortgageHtmlParseLimits;
  readonly sourceDocuments: readonly {
    readonly role: Exclude<MortgageSourceRole, "unknown">;
    readonly sourceHtml: string;
    readonly parsedDocument: MortgageHtmlParseResult;
  }[];
  readonly expiresAtMs: number;
}

const MORTGAGE_PREVIEW_TTL_MS = 5 * 60 * 1000;
const MAX_MORTGAGE_PREVIEWS = 16;

function currentLoanIdentity(
  database: LocalLedgerDatabase,
  householdId: string,
  loanId: string
): MortgageDocumentIdentityEvidence {
  const completeLoan = database.listLoanRecords(householdId)
    .find((loan) => loan.id === loanId);
  const sourceOnlyLoan = database.listSourceOnlyLoanRecords(householdId)
    .find((loan) => loan.id === loanId);
  const loan = completeLoan ?? sourceOnlyLoan;
  if (loan === undefined) throw new Error(`Loan not found: ${loanId}`);
  const historicalVersions = database.listMortgageEvidenceVersions(householdId, loanId);
  const historicalReferences = new Map<string, string>();
  const conflicts = new Set<MortgageDocumentIdentityEvidence["conflicts"][number]>();
  for (const version of historicalVersions) {
    for (const document of version.documents) {
      const identity = document.parsedDocument.identityEvidence;
      if (identity.conflicts.includes("loan-reference-mismatch")) {
        conflicts.add("loan-reference-mismatch");
      }
      if (identity.conflicts.includes("currency-mismatch")) {
        conflicts.add("currency-mismatch");
      }
      for (const reference of identity.loanReferenceValues) {
        historicalReferences.set(
          reference.trim().toUpperCase().replace(/\s+/g, ""),
          reference
        );
      }
      if (
        identity.currencyCode !== null &&
        identity.currencyCode.toUpperCase() !== loan.currencyCode
      ) {
        conflicts.add("currency-mismatch");
      }
    }
  }
  if (historicalReferences.size > 1) conflicts.add("loan-reference-mismatch");
  const loanReference = historicalReferences.size === 1
    ? [...historicalReferences.values()][0] ?? null
    : null;
  return {
    loanReference,
    currencyCode: loan.currencyCode,
    loanReferenceValues: loanReference === null ? [] : [loanReference],
    currencyValues: [loan.currencyCode],
    conflicts: [...conflicts],
  };
}

function evidenceReviewState(
  previewState: MortgageBankImportReviewState,
  targetPairing: MortgageDocumentPairingResult
): MortgageBankImportReviewState {
  if (previewState === "invalid" ||
      previewState === "unsupported" ||
      previewState === "identity-conflict") {
    return previewState;
  }
  if (targetPairing.status === "conflict") return "identity-conflict";
  if (targetPairing.status === "confirmation-required") {
    return "attachment-confirmation-required";
  }
  return previewState;
}

function assessMortgageTargetAttachment(
  targetIdentity: MortgageDocumentIdentityEvidence,
  documentIdentities: readonly MortgageDocumentIdentityEvidence[],
  explicitlyConfirmed: boolean
): MortgageDocumentPairingResult {
  const documentPairings = documentIdentities.map((identity) =>
    assessMortgageDocumentPairing(targetIdentity, identity, explicitlyConfirmed)
  );
  const conflict = documentPairings.find((pairing) => pairing.status === "conflict");
  if (conflict !== undefined) return conflict;
  if (documentPairings.every((pairing) => pairing.status === "verified")) {
    return { status: "verified", verification: "matching-identifiers" };
  }
  return explicitlyConfirmed
    ? { status: "confirmed", verification: "explicit-user-attachment" }
    : { status: "confirmation-required" };
}

function compareMortgageTerms(
  database: LocalLedgerDatabase,
  householdId: string,
  target: MortgageImportTarget,
  sourceDocuments: StoredMortgageImportPreview["sourceDocuments"],
  sourceAsOfDateIso: string | null,
  useSavedCurrencyForUnidentifiedSource: boolean
): MortgageTermComparison[] {
  if (target.kind !== "existing") return [];
  const loan = database.listLoanRecords(householdId)
    .find((candidate) => candidate.id === target.loanId);
  if (loan === undefined) return [];

  const comparisons: MortgageTermComparison[] = [];
  for (const document of sourceDocuments) {
    const sourceCurrency = document.parsedDocument.identityEvidence.currencyCode;
    const canCompareAmounts = sourceCurrency === loan.currencyCode ||
      (sourceCurrency === null && useSavedCurrencyForUnidentifiedSource);
    for (const field of document.parsedDocument.detailsFields) {
      if (
        canCompareAmounts &&
        field.field === "originalPrincipalMinor" &&
        field.amountMinor !== null
      ) {
        comparisons.push({
          field: field.field,
          sourceLabel: field.sourceLabel,
          sourceValueMinor: field.amountMinor,
          savedValueMinor: loan.principalMinor,
          currencyCode: loan.currencyCode,
          status: field.amountMinor === loan.principalMinor ? "matches" : "differs",
        });
      } else if (
        field.field === "nominalAnnualRateBasisPoints" &&
        field.valueBasisPoints !== null
      ) {
        comparisons.push({
          field: field.field,
          sourceLabel: field.sourceLabel,
          sourceValueBasisPoints: field.valueBasisPoints,
          savedValueBasisPoints: loan.annualInterestRateBasisPoints,
          status: field.valueBasisPoints === loan.annualInterestRateBasisPoints
            ? "matches"
            : "differs",
        });
      } else if (
        canCompareAmounts &&
        field.field === "remainingPrincipalMinor" &&
        field.amountMinor !== null &&
        sourceAsOfDateIso !== null
      ) {
        const savedBalance = database.listLoanBalanceSnapshots(loan.id)
          .filter((balance) => balance.effectiveDateIso === sourceAsOfDateIso)
          .at(-1);
        if (savedBalance !== undefined) {
          comparisons.push({
            field: field.field,
            sourceLabel: field.sourceLabel,
            sourceValueMinor: field.amountMinor,
            savedValueMinor: savedBalance.amountMinor,
            currencyCode: loan.currencyCode,
            savedEffectiveDateIso: savedBalance.effectiveDateIso,
            status: field.amountMinor === savedBalance.amountMinor ? "matches" : "differs",
          });
        }
      }
    }
  }
  return comparisons;
}

export function createMortgageBankImportService(
  database: LocalLedgerDatabase,
  options: MortgageBankImportServiceOptions = {}
): MortgageBankImportService {
  const maxBytesPerFile = options.maxBytesPerFile ?? PROVISIONAL_MORTGAGE_HTML_MAX_BYTES;
  const parserLimits = options.parserLimits ?? PROVISIONAL_MORTGAGE_HTML_PARSE_LIMITS;
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const previews = new Map<string, StoredMortgageImportPreview>();
  const activePreviewRequests = new Map<string, AbortController>();

  function removeExpiredPreviews(nowMs: number): void {
    for (const [previewId, stored] of previews) {
      if (stored.expiresAtMs <= nowMs) previews.delete(previewId);
    }
  }

  function beginPreviewRequest(requestId: string): void {
    if (requestId.trim() === "" ||
        activePreviewRequests.has(requestId) ||
        previews.has(requestId)) {
      throw new Error("Mortgage preview request ID is invalid or already active.");
    }
    activePreviewRequests.set(requestId, new AbortController());
  }

  function finishPreviewRequest(requestId: string): void {
    activePreviewRequests.delete(requestId);
  }

  async function previewFiles(input: {
    readonly requestId?: string;
    readonly filePaths: readonly string[];
    readonly target: MortgageImportTarget;
    readonly attachmentConfirmed: boolean;
  }): Promise<MortgageBankImportPreview> {
    if ((input.filePaths.length !== 1 && input.filePaths.length !== 2) ||
        input.filePaths.some((filePath) => typeof filePath !== "string" || filePath.trim() === "") ||
        (input.filePaths.length === 2 && input.filePaths[0] === input.filePaths[1])) {
      throw new Error("Choose one supported mortgage HTML file or a details and repayment-plan pair.");
    }
    const metadata = database.loadRuntimeMetadata();
    if (metadata === null) throw new Error("Local household is not available for mortgage import.");

    const previewId = input.requestId ?? randomUUID();
    let cancellation = activePreviewRequests.get(previewId);
    if (cancellation === undefined) {
      if (input.requestId !== undefined) {
        throw new Error("Mortgage preview request was not initialized.");
      }
      cancellation = new AbortController();
      activePreviewRequests.set(previewId, cancellation);
    }

    let sources: string[];
    try {
      cancellation.signal.throwIfAborted();
      sources = await Promise.all(input.filePaths.map((filePath) =>
        readBoundedMortgageHtmlFile(filePath, maxBytesPerFile, cancellation.signal)
      ));
      cancellation.signal.throwIfAborted();
    } catch (error) {
      activePreviewRequests.delete(previewId);
      throw error;
    }
    activePreviewRequests.delete(previewId);
    const parsedDocuments = sources.map((source) => parseRogalandMortgageHtml(source, parserLimits));
    const targetIdentity = input.target.kind === "existing"
      ? currentLoanIdentity(database, metadata.household.id, input.target.loanId)
      : null;
    let reviewState: MortgageBankImportReviewState;
    let documents: MortgageBankImportPreviewDocument[];
    let pairing: MortgageDocumentPairingResult | null;
    let attachment: MortgageDocumentPairingResult | null;
    let validation: MortgageScheduleValidationResult | null;
    let sourceDocuments: StoredMortgageImportPreview["sourceDocuments"];

    if (parsedDocuments.length === 1) {
      const parsedDocument = parsedDocuments[0];
      const sourceHtml = sources[0];
      if (parsedDocument === undefined || sourceHtml === undefined ||
          parsedDocument.role === "unknown") {
        throw new Error("The selected file is not a supported mortgage-details or repayment-plan page.");
      }

      const singlePreview = parsedDocument.role === "schedule"
        ? createMortgageSchedulePreview(
            parsedDocument,
            targetIdentity ?? parsedDocument.identityEvidence,
            input.attachmentConfirmed || input.target.kind === "new-source-only"
          )
        : createMortgageDetailsPreview(
            parsedDocument,
            targetIdentity ?? parsedDocument.identityEvidence,
            input.attachmentConfirmed || input.target.kind === "new-source-only"
          );
      reviewState = singlePreview.reviewState;
      documents = [{
        role: parsedDocument.role,
        parsedDocument: singlePreview.parsedDocument,
      }];
      pairing = null;
      attachment = input.target.kind === "existing"
        ? singlePreview.pairing
        : input.attachmentConfirmed
          ? { status: "confirmed", verification: "explicit-user-attachment" }
          : { status: "confirmation-required" };
      validation = "validation" in singlePreview ? singlePreview.validation : null;
      sourceDocuments = [{
        role: parsedDocument.role,
        sourceHtml,
        parsedDocument,
      }];
    } else {
      const detailsIndex = parsedDocuments.findIndex((document) => document.role === "details");
      const scheduleIndex = parsedDocuments.findIndex((document) => document.role === "schedule");
      if (detailsIndex < 0 || scheduleIndex < 0 || detailsIndex === scheduleIndex) {
        throw new Error("Select one supported loan-details page and one repayment-plan page.");
      }

      const detailsDocument = parsedDocuments[detailsIndex];
      const scheduleDocument = parsedDocuments[scheduleIndex];
      const detailsSource = sources[detailsIndex];
      const scheduleSource = sources[scheduleIndex];
      if (detailsDocument === undefined || scheduleDocument === undefined ||
          detailsSource === undefined || scheduleSource === undefined) {
        throw new Error("Mortgage HTML files could not be paired.");
      }

      const pairPreview = createMortgageDocumentPairPreview(
        detailsDocument,
        scheduleDocument,
        input.attachmentConfirmed
      );
      const targetPairing = targetIdentity === null
        ? null
        : assessMortgageTargetAttachment(
            targetIdentity,
            [detailsDocument.identityEvidence, scheduleDocument.identityEvidence],
            input.attachmentConfirmed,
          );
      reviewState = targetPairing === null
        ? pairPreview.reviewState
        : evidenceReviewState(pairPreview.reviewState, targetPairing);
      documents = [
        { role: "details", parsedDocument: pairPreview.detailsDocument },
        { role: "schedule", parsedDocument: pairPreview.scheduleDocument },
      ];
      pairing = pairPreview.pairing;
      attachment = targetPairing ?? (
        input.attachmentConfirmed
          ? { status: "confirmed", verification: "explicit-user-attachment" }
          : { status: "confirmation-required" }
      );
      validation = pairPreview.validation;
      sourceDocuments = [
        { role: "details", sourceHtml: detailsSource, parsedDocument: detailsDocument },
        { role: "schedule", sourceHtml: scheduleSource, parsedDocument: scheduleDocument },
      ];
    }

    const sourceDates = new Set(sourceDocuments.flatMap((document) => (
      document.parsedDocument.sourceDateEvidence.dateIso === null
        ? []
        : [document.parsedDocument.sourceDateEvidence.dateIso]
    )));
    const sourceDateConflict = sourceDocuments.some((document) =>
      document.parsedDocument.sourceDateEvidence.conflict
    ) || sourceDates.size > 1;
    const sourceAsOfDateIso = sourceDateConflict ? null : [...sourceDates][0] ?? null;
    if (sourceDateConflict) reviewState = "source-date-conflict";
    const importTime = now();
    const importedAtIso = importTime.toISOString();
    const currentTime = importTime.getTime();
    const termComparisons = compareMortgageTerms(
      database,
      metadata.household.id,
      input.target,
      sourceDocuments,
      sourceAsOfDateIso,
      input.attachmentConfirmed && input.target.kind === "existing"
    );
    const preview: MortgageBankImportPreview = {
      previewId,
      loanId: input.target.kind === "existing" ? input.target.loanId : null,
      target: input.target,
      reviewState,
      sourceAsOfDateIso,
      importedAtIso,
      documents,
      validation,
      pairing,
      attachment,
      termComparisons,
    };

    let expectedLoanRevision: string | null = null;
    let expectedVersionNumber = 0;
    let sourceOnlyLoanInput: SourceOnlyLoanRecordInput | null = null;
    if (input.target.kind === "existing") {
      expectedLoanRevision = database.getMortgageEvidenceRevision(
        input.target.loanId,
        metadata.household.id
      );
      if (expectedLoanRevision === null) throw new Error(`Loan not found: ${input.target.loanId}`);
      expectedVersionNumber = database.listMortgageEvidenceVersions(
        metadata.household.id,
        input.target.loanId
      ).length;
    } else {
      const currencies = new Set(sourceDocuments.flatMap((document) => (
        document.parsedDocument.identityEvidence.currencyCode === null
          ? []
          : [document.parsedDocument.identityEvidence.currencyCode]
      )));
      const sourceConflicts = sourceDocuments.some((document) =>
        document.parsedDocument.identityEvidence.conflicts.includes("currency-mismatch")
      );
      const sourceCurrencyCode = [...currencies][0];
      if (
        sourceConflicts ||
        currencies.size > 1 ||
        (sourceCurrencyCode !== undefined && sourceCurrencyCode !== input.target.currencyCode)
      ) {
        throw new Error(
          "Source currency conflicts with the selected currency for this incomplete loan."
        );
      }
      sourceOnlyLoanInput = validateSourceOnlyLoanRecordInput({
        label: input.target.label,
        currencyCode: input.target.currencyCode,
        ...(input.target.propertyId === undefined ? {} : { propertyId: input.target.propertyId }),
      }, database.listPropertyRecords(metadata.household.id).map((property) => property.id));
      if (
        input.target.kind === "new-source-only" &&
        !input.attachmentConfirmed &&
        !["invalid", "unsupported", "identity-conflict", "source-date-conflict"].includes(reviewState)
      ) {
        reviewState = "attachment-confirmation-required";
        attachment = { status: "confirmation-required" };
      }
    }

    const acceptedPreview: MortgageBankImportPreview = { ...preview, reviewState, attachment };
    removeExpiredPreviews(currentTime);
    while (previews.size >= MAX_MORTGAGE_PREVIEWS) {
      const oldest = previews.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      previews.delete(oldest);
    }
    previews.set(previewId, {
      preview: acceptedPreview,
      householdId: metadata.household.id,
      databaseGeneration: options.getDatabaseGeneration?.() ?? 0,
      expectedLoanRevision,
      expectedVersionNumber,
      sourceOnlyLoanInput,
      parserLimits,
      sourceDocuments,
      expiresAtMs: currentTime + MORTGAGE_PREVIEW_TTL_MS,
    });
    return acceptedPreview;
  }

  function confirmAttachmentPreview(previewId: string): MortgageBankImportPreview {
    const currentTime = now().getTime();
    removeExpiredPreviews(currentTime);
    const stored = previews.get(previewId);
    if (stored === undefined) throw new Error("Mortgage import preview was not found or has expired.");
    if (stored.databaseGeneration !== (options.getDatabaseGeneration?.() ?? 0)) {
      previews.delete(previewId);
      throw new Error("Mortgage import context changed after preview.");
    }
    if (stored.preview.reviewState !== "attachment-confirmation-required" ||
        stored.preview.attachment?.status !== "confirmation-required") {
      throw new Error("Mortgage import preview does not require attachment confirmation.");
    }
    if (
      stored.preview.target.kind === "existing" &&
      database.getMortgageEvidenceRevision(
        stored.preview.target.loanId,
        stored.householdId
      ) !== stored.expectedLoanRevision
    ) {
      previews.delete(previewId);
      throw new Error("Loan changed after mortgage evidence preview.");
    }

    const targetIdentity = stored.preview.target.kind === "existing"
      ? currentLoanIdentity(database, stored.householdId, stored.preview.target.loanId)
      : null;
    let reviewState: MortgageBankImportReviewState;
    let documents: MortgageBankImportPreviewDocument[];
    let pairing: MortgageDocumentPairingResult | null;
    let attachment: MortgageDocumentPairingResult | null;
    let validation: MortgageScheduleValidationResult | null;

    if (stored.sourceDocuments.length === 1) {
      const source = stored.sourceDocuments[0];
      if (source === undefined) throw new Error("Mortgage preview source was not found.");
      const singlePreview = source.role === "schedule"
        ? createMortgageSchedulePreview(
            source.parsedDocument,
            targetIdentity ?? source.parsedDocument.identityEvidence,
            true
          )
        : createMortgageDetailsPreview(
            source.parsedDocument,
            targetIdentity ?? source.parsedDocument.identityEvidence,
            true
          );
      reviewState = singlePreview.reviewState;
      documents = [{ role: source.role, parsedDocument: singlePreview.parsedDocument }];
      pairing = null;
      attachment = targetIdentity === null
        ? { status: "confirmed", verification: "explicit-user-attachment" }
        : singlePreview.pairing;
      validation = "validation" in singlePreview ? singlePreview.validation : null;
    } else {
      const details = stored.sourceDocuments.find((document) => document.role === "details");
      const schedule = stored.sourceDocuments.find((document) => document.role === "schedule");
      if (details === undefined || schedule === undefined) {
        throw new Error("Mortgage preview source documents could not be paired.");
      }
      const pairPreview = createMortgageDocumentPairPreview(
        details.parsedDocument,
        schedule.parsedDocument,
        true
      );
      const targetPairing = targetIdentity === null
        ? null
        : assessMortgageTargetAttachment(
            targetIdentity,
            [
              details.parsedDocument.identityEvidence,
              schedule.parsedDocument.identityEvidence,
            ],
            true
          );
      reviewState = targetPairing === null
        ? pairPreview.reviewState
        : evidenceReviewState(pairPreview.reviewState, targetPairing);
      documents = [
        { role: "details", parsedDocument: pairPreview.detailsDocument },
        { role: "schedule", parsedDocument: pairPreview.scheduleDocument },
      ];
      pairing = pairPreview.pairing;
      attachment = targetPairing ?? {
        status: "confirmed",
        verification: "explicit-user-attachment",
      };
      validation = pairPreview.validation;
    }

    const termComparisons = compareMortgageTerms(
      database,
      stored.householdId,
      stored.preview.target,
      stored.sourceDocuments,
      stored.preview.sourceAsOfDateIso,
      true
    );
    const preview: MortgageBankImportPreview = {
      ...stored.preview,
      reviewState,
      documents,
      pairing,
      attachment,
      validation,
      termComparisons,
    };
    previews.set(previewId, { ...stored, preview });
    return preview;
  }

  function acceptPreview(
    previewId: string,
    acceptPartial = false,
    acknowledgeTermDifferences = false
  ): MortgageEvidenceVersion {
    const currentTime = now().getTime();
    removeExpiredPreviews(currentTime);
    const stored = previews.get(previewId);
    if (stored === undefined) throw new Error("Mortgage import preview was not found or has expired.");
    if (stored.databaseGeneration !== (options.getDatabaseGeneration?.() ?? 0)) {
      previews.delete(previewId);
      throw new Error("Mortgage import context changed after preview.");
    }
    const isComplete = [
      "schedule-checks-passed",
      "details-checks-passed",
      "paired-schedule-checks-passed",
    ].includes(stored.preview.reviewState);
    if (!isComplete && !(acceptPartial && stored.preview.reviewState === "review-required")) {
      throw new Error("Mortgage import preview is not ready for acceptance.");
    }
    const hasTermDifferences = stored.preview.termComparisons.some((comparison) =>
      comparison.status === "differs"
    );
    if (hasTermDifferences && !acknowledgeTermDifferences) {
      throw new Error("Review and acknowledge imported differences before acceptance.");
    }
    const importedAtIso = stored.preview.importedAtIso;
    const sourceOnlyLoan: SourceOnlyLoanRecord | undefined = stored.sourceOnlyLoanInput === null
      ? undefined
      : {
          ...stored.sourceOnlyLoanInput,
          id: createId(),
          householdId: stored.householdId,
          createdAtIso: importedAtIso,
          responsibilityShareBasisPoints: DEFAULT_HOUSEHOLD_SHARE_BASIS_POINTS,
          recordStatus: "source-only",
        };
    const loanId = stored.preview.loanId ?? sourceOnlyLoan?.id;
    if (loanId === undefined) throw new Error("Mortgage import target was not resolved.");
    const versionInput: MortgageEvidenceVersionInput = {
      id: createId(),
      loanId,
      householdId: stored.householdId,
      sourceAsOfDateIso: stored.preview.sourceAsOfDateIso,
      importedAtIso,
      documents: stored.sourceDocuments.map(({ role, sourceHtml, parsedDocument }) => ({
        role,
        sourceHashSha256: createHash("sha256").update(sourceHtml, "utf8").digest("hex"),
        parserVersion: ROGALAND_MORTGAGE_PARSER_VERSION,
        parserLimits: stored.parserLimits,
        parsedDocument,
      })),
      pairing: stored.preview.pairing,
      attachment: stored.preview.attachment ?? {
        status: "confirmed",
        verification: "explicit-user-attachment",
      },
      termComparisons: stored.preview.termComparisons,
      termDifferencesAcknowledged: hasTermDifferences && acknowledgeTermDifferences,
      scheduleValidation: stored.preview.validation,
    };

    try {
      const result = database.appendMortgageEvidenceVersion(
        versionInput,
        stored.expectedLoanRevision,
        stored.expectedVersionNumber,
        sourceOnlyLoan
      );
      previews.delete(previewId);
      return result;
    } catch (error) {
      if (error instanceof Error &&
          error.message === "Loan changed after mortgage evidence preview.") {
        previews.delete(previewId);
      }
      throw error;
    }
  }

  function cancelPreview(previewId: string): boolean {
    const activeRequest = activePreviewRequests.get(previewId);
    if (activeRequest !== undefined) {
      activeRequest.abort();
      return true;
    }
    return previews.delete(previewId);
  }

  function listEvidenceSummaries(): MortgageEvidenceAcceptanceSummary[] {
    const metadata = database.loadRuntimeMetadata();
    if (metadata === null) throw new Error("Local household is not available for mortgage import.");
    return database.listMortgageEvidenceVersions(metadata.household.id).map((version) => ({
      id: version.id,
      loanId: version.loanId,
      versionNumber: version.versionNumber,
      sourceAsOfDateIso: version.sourceAsOfDateIso,
      importedAtIso: version.importedAtIso,
      documentRoles: version.documents.map((document) => document.role),
      attachment: version.attachment,
      termDifferenceCount: version.termComparisons.filter((comparison) =>
        comparison.status === "differs"
      ).length,
      termDifferencesAcknowledged: version.termDifferencesAcknowledged,
      scheduleValidationStatus: version.scheduleValidation?.status ?? null,
    }));
  }

  return {
    beginPreviewRequest,
    finishPreviewRequest,
    previewFiles,
    confirmAttachmentPreview,
    acceptPreview,
    cancelPreview,
    listEvidenceSummaries,
  };
}
