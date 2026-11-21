export type MortgageSourceRole = "details" | "schedule" | "unknown";

export type MortgageEvidenceParseStatus = "parsed" | "partial" | "unsupported";

export type MortgageSchedulePeriod =
  | { readonly granularity: "monthly"; readonly year: number; readonly month: number }
  | { readonly granularity: "annual"; readonly year: number }
  | { readonly granularity: "unknown" };

export interface MortgageScheduleRowEvidence {
  readonly periodLabel: string;
  readonly period: MortgageSchedulePeriod;
  readonly principalMinor: number | null;
  readonly interestMinor: number | null;
  readonly feeMinor: number | null;
  readonly paymentMinor: number | null;
  readonly projectedClosingBalanceMinor: number | null;
  readonly sourceHeaders: readonly string[];
  readonly sourceValues: readonly string[];
}

export interface MortgageHtmlParseLimits {
  readonly maxSourceCharacters: number;
  readonly maxElements: number;
  readonly maxDepth: number;
}

/** Revalidate these provisional limits on minimum Windows hardware before finalizing them. */
export const PROVISIONAL_MORTGAGE_HTML_MAX_BYTES = 256 * 1024;
export const PROVISIONAL_MORTGAGE_HTML_PARSE_LIMITS: MortgageHtmlParseLimits = Object.freeze({
  maxSourceCharacters: 256 * 1024,
  maxElements: 6_000,
  maxDepth: 32,
});

interface MortgageDetailFieldEvidenceBase {
  readonly sourceLabel: string;
  readonly sourceValue: string;
}

export type MortgageDetailFieldEvidence =
  | (MortgageDetailFieldEvidenceBase & {
      readonly field: "originalPrincipalMinor" | "remainingPrincipalMinor";
      readonly amountMinor: number | null;
    })
  | (MortgageDetailFieldEvidenceBase & {
      readonly field: "nominalAnnualRateBasisPoints" | "effectiveAnnualRateBasisPoints";
      readonly valueBasisPoints: number | null;
    });

export interface MortgageHtmlParseResult {
  readonly parseStatus: MortgageEvidenceParseStatus;
  readonly role: MortgageSourceRole;
  readonly sourceDateEvidence: MortgageSourceDateEvidence;
  readonly detailsFields: readonly MortgageDetailFieldEvidence[];
  readonly identityEvidence: MortgageDocumentIdentityEvidence;
  readonly openingBalanceEvidence: MortgageScheduleOpeningBalanceEvidence | null;
  readonly scheduleRows: readonly MortgageScheduleRowEvidence[];
}

export interface MortgageSourceDateEvidence {
  readonly dateIso: string | null;
  readonly sourceLabels: readonly string[];
  readonly sourceValues: readonly string[];
  readonly conflict: boolean;
}

export interface MortgageScheduleOpeningBalanceEvidence {
  readonly amountMinor: number;
  readonly beforePeriod: Exclude<MortgageSchedulePeriod, { readonly granularity: "unknown" }>;
  readonly sourceKind: "lender-opening-balance";
  readonly sourceLabel: string;
  readonly sourceValue: string;
}

export type MortgageScheduleValidationIssueCode =
  | "incomplete-row"
  | "payment-total-mismatch"
  | "closing-balance-mismatch"
  | "unreconciled-balance-increase"
  | "opening-balance-unknown"
  | "opening-balance-period-mismatch"
  | "opening-balance-unsupported-source"
  | "period-gap"
  | "duplicate-period"
  | "out-of-order-period"
  | "mixed-period-granularity"
  | "unsupported-sign";

export interface MortgageScheduleValidationIssue {
  readonly code: MortgageScheduleValidationIssueCode;
  readonly rowIndex: number;
}

export interface MortgageScheduleValidationResult {
  readonly status: "valid" | "partial" | "invalid";
  readonly issues: readonly MortgageScheduleValidationIssue[];
}

export interface MortgageDocumentIdentityEvidence {
  readonly loanReference: string | null;
  readonly currencyCode: string | null;
  readonly loanReferenceValues: readonly string[];
  readonly currencyValues: readonly string[];
  readonly conflicts: readonly ("loan-reference-mismatch" | "currency-mismatch")[];
}

export interface MortgageEvidenceDocumentVersion {
  readonly role: Exclude<MortgageSourceRole, "unknown">;
  readonly sourceHashSha256: string;
  readonly parserVersion: string;
  readonly parserLimits: MortgageHtmlParseLimits;
  readonly parsedDocument: MortgageHtmlParseResult;
}

export interface MortgageEvidenceVersion {
  readonly id: string;
  readonly loanId: string;
  readonly householdId: string;
  readonly versionNumber: number;
  readonly sourceAsOfDateIso: string | null;
  readonly importedAtIso: string;
  readonly documents: readonly MortgageEvidenceDocumentVersion[];
  readonly pairing: MortgageDocumentPairingResult | null;
  readonly attachment: MortgageDocumentPairingResult;
  readonly termComparisons: readonly MortgageTermComparison[];
  readonly termDifferencesAcknowledged: boolean;
  readonly scheduleValidation: MortgageScheduleValidationResult | null;
}

export type MortgageEvidenceVersionInput = Omit<MortgageEvidenceVersion, "versionNumber">;

export type MortgageTermComparison =
  | {
      readonly field: "originalPrincipalMinor" | "remainingPrincipalMinor";
      readonly sourceLabel: string;
      readonly sourceValueMinor: number;
      readonly savedValueMinor: number;
      readonly currencyCode: string;
      readonly savedEffectiveDateIso?: string;
      readonly status: "matches" | "differs";
    }
  | {
      readonly field: "nominalAnnualRateBasisPoints";
      readonly sourceLabel: string;
      readonly sourceValueBasisPoints: number;
      readonly savedValueBasisPoints: number;
      readonly status: "matches" | "differs";
    };

export interface MortgageSchedulePreviewIdentityDisplay {
  readonly maskedLoanReference: string | null;
  readonly maskedLoanReferenceValues: readonly string[];
  readonly currencyCode: string | null;
  readonly currencyValues: readonly string[];
  readonly conflicts: readonly ("loan-reference-mismatch" | "currency-mismatch")[];
}

export interface MortgageSchedulePreviewDocument
  extends Omit<MortgageHtmlParseResult, "identityEvidence" | "scheduleRows"> {
  readonly identityDisplay: MortgageSchedulePreviewIdentityDisplay;
  readonly scheduleRows: readonly Omit<MortgageScheduleRowEvidence, "sourceValues">[];
}

export type MortgageBankImportReviewState =
  | "schedule-checks-passed"
  | "details-checks-passed"
  | "paired-schedule-checks-passed"
  | "review-required"
  | "source-date-conflict"
  | "invalid"
  | "unsupported"
  | "attachment-confirmation-required"
  | "identity-conflict";

export type MortgageImportTarget =
  | { readonly kind: "existing"; readonly loanId: string }
  | {
      readonly kind: "new-source-only";
      readonly label: string;
      readonly propertyId?: string;
    };

export interface MortgageBankImportPreviewDocument {
  readonly role: Exclude<MortgageSourceRole, "unknown">;
  readonly parsedDocument: MortgageSchedulePreviewDocument;
}

export interface MortgageBankImportPreview {
  readonly previewId: string;
  readonly loanId: string | null;
  readonly target: MortgageImportTarget;
  readonly reviewState: MortgageBankImportReviewState;
  readonly sourceAsOfDateIso: string | null;
  readonly documents: readonly MortgageBankImportPreviewDocument[];
  readonly validation: MortgageScheduleValidationResult | null;
  readonly pairing: MortgageDocumentPairingResult | null;
  readonly attachment: MortgageDocumentPairingResult | null;
  readonly termComparisons: readonly MortgageTermComparison[];
}

export interface MortgageEvidenceAcceptanceSummary {
  readonly id: string;
  readonly loanId: string;
  readonly versionNumber: number;
  readonly sourceAsOfDateIso: string | null;
  readonly importedAtIso: string;
  readonly documentRoles: readonly Exclude<MortgageSourceRole, "unknown">[];
  readonly attachment: MortgageDocumentPairingResult;
  readonly termDifferenceCount: number;
  readonly termDifferencesAcknowledged: boolean;
  readonly scheduleValidationStatus: MortgageScheduleValidationResult["status"] | null;
}

export type MortgageDocumentPairingResult =
  | { readonly status: "verified"; readonly verification: "matching-identifiers" }
  | { readonly status: "confirmed"; readonly verification: "explicit-user-attachment" }
  | { readonly status: "confirmation-required" }
  | {
      readonly status: "conflict";
      readonly reason: "loan-reference-mismatch" | "currency-mismatch" | "invalid-currency";
    };
