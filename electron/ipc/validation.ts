import { dirname, join, resolve } from "path";
import type { SpendableCashEstimateRequest } from "../../src/app/dashboardApi.js";
import type { CsvImportPreviewFailure, CsvImportResponse } from "../../src/app/import/importCsv.js";
import type { PdfImportResponse } from "../../src/app/import/importPdf.js";
import { ImportPreviewError } from "../../src/app/import/importPreviewRegistry.js";
import type { RestoreSnapshotInput } from "../../src/domain/backup/snapshotContract.js";
import { validateRecurringCommitmentInput } from "../../src/domain/forecast/recurringCommitments.js";
import { CSV_COLUMN_NAMES, type CsvColumnKey, type CsvColumnMapping } from "../../src/domain/import/csvRowMapper.js";
import type { DuplicateImportDecision } from "../../src/domain/import/filterPreviouslyImportedTransactions.js";
import { classifyImportFilePath } from "../../src/domain/import/sourceDocument.js";
import {
  MAX_TRANSACTION_PAGE_SIZE,
  type TransactionFilters,
  type TransactionQuery,
  type TransactionSortDirection,
  type TransactionSortField,
} from "../../src/domain/ledger/filterTransactions.js";
import {
  isCurrencyCode,
  type AccountBalanceCheckpoint,
  type AccountStatementCoveragePeriod,
  type ImportReviewCorrectionInput,
  type MonthlyCategoryTargetInput,
  type RecurringCommitmentInput,
  type RecurringCommitmentPaymentLinkInput,
  type SameMerchantPropagationInput,
  type SameMerchantPropagationPreviewRequest,
  type TransactionCategoryAllocation,
} from "../../src/domain/types.js";

export function invalidAccountMessage(accountId: string): string {
  return `accountId must identify an account belonging to the household: ${accountId}`;
}

export function parseNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

export function parseSpendableCashEstimateRequest(input: unknown): SpendableCashEstimateRequest {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Spendable cash estimate request must be an object.");
  }
  const record = input as Record<string, unknown>;
  if (!Array.isArray(record.selectedAccountIds)) {
    throw new Error("selectedAccountIds must be an array.");
  }
  const selectedAccountIds = record.selectedAccountIds.map((value, index) =>
    parseNonEmptyString(value, `selectedAccountIds[${index}]`)
  );
  const nextIncomeDateIso = parseNonEmptyString(record.nextIncomeDateIso, "nextIncomeDateIso");
  const reserveMinor = record.reserveMinor;
  if (
    typeof reserveMinor !== "number" ||
    !Number.isSafeInteger(reserveMinor) ||
    reserveMinor < 0
  ) {
    throw new Error("reserveMinor must be a non-negative safe integer.");
  }

  const monthlyReferenceRateIdsValue = record.monthlyReferenceRateIds;
  if (monthlyReferenceRateIdsValue === undefined) {
    return { selectedAccountIds, nextIncomeDateIso, reserveMinor };
  }
  if (
    typeof monthlyReferenceRateIdsValue !== "object" ||
    monthlyReferenceRateIdsValue === null ||
    Array.isArray(monthlyReferenceRateIdsValue)
  ) {
    throw new Error("monthlyReferenceRateIds must be a currency-to-rate mapping.");
  }
  const monthlyReferenceRateIds: Record<string, string> = {};
  for (const [currencyCode, rateId] of Object.entries(monthlyReferenceRateIdsValue)) {
    monthlyReferenceRateIds[parseNonEmptyString(currencyCode, "currencyCode")] =
      parseNonEmptyString(rateId, `monthlyReferenceRateIds.${currencyCode}`);
  }
  return {
    selectedAccountIds,
    nextIncomeDateIso,
    reserveMinor,
    monthlyReferenceRateIds,
  };
}

export function parseRecurringCommitmentInput(input: unknown): RecurringCommitmentInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Recurring commitment input must be an object.");
  }
  const record = input as Record<string, unknown>;
  if (
    typeof record.description !== "string" ||
    typeof record.currencyCode !== "string" ||
    (record.amountMinor !== null && typeof record.amountMinor !== "number") ||
    typeof record.isVariable !== "boolean" ||
    (record.cadence !== "monthly" && record.cadence !== "annual") ||
    typeof record.firstDueDateIso !== "string" ||
    typeof record.activeFromIso !== "string"
  ) {
    throw new Error("Recurring commitment input has invalid fields.");
  }
  const activeUntilIso = record.activeUntilIso === undefined
    ? undefined
    : parseNonEmptyString(record.activeUntilIso, "activeUntilIso");
  return validateRecurringCommitmentInput({
    description: record.description,
    currencyCode: record.currencyCode.trim().toUpperCase(),
    amountMinor: record.amountMinor,
    isVariable: record.isVariable,
    cadence: record.cadence,
    firstDueDateIso: record.firstDueDateIso,
    activeFromIso: record.activeFromIso,
    ...(activeUntilIso === undefined ? {} : { activeUntilIso }),
  });
}

export function parseRecurringCommitmentPaymentLinkInput(
  input: unknown
): RecurringCommitmentPaymentLinkInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Recurring commitment payment link must be an object.");
  }
  const record = input as Record<string, unknown>;
  const transactionId = record.transactionId === undefined
    ? undefined
    : parseNonEmptyString(record.transactionId, "transactionId");
  const pendingObservationId = record.pendingObservationId === undefined
    ? undefined
    : parseNonEmptyString(record.pendingObservationId, "pendingObservationId");
  if ((transactionId === undefined) === (pendingObservationId === undefined)) {
    throw new Error("A payment link must identify exactly one booked or pending payment.");
  }
  const occurrenceDateIso = parseNonEmptyString(record.occurrenceDateIso, "occurrenceDateIso");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(occurrenceDateIso) ||
    Number.isNaN(Date.parse(`${occurrenceDateIso}T00:00:00.000Z`)) ||
    new Date(`${occurrenceDateIso}T00:00:00.000Z`).toISOString().slice(0, 10) !== occurrenceDateIso
  ) {
    throw new Error("occurrenceDateIso must be a valid calendar date.");
  }
  return {
    commitmentId: parseNonEmptyString(record.commitmentId, "commitmentId"),
    occurrenceDateIso,
    ...(transactionId === undefined ? {} : { transactionId }),
    ...(pendingObservationId === undefined ? {} : { pendingObservationId }),
  };
}

export function parseImportReviewCorrectionRequest(input: unknown): {
  reviewItemId: string;
  correction: ImportReviewCorrectionInput;
} {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Import review correction input must be an object.");
  }
  const record = input as Record<string, unknown>;
  if (typeof record.correction !== "object" || record.correction === null || Array.isArray(record.correction)) {
    throw new Error("Import review correction must be an object.");
  }
  const correction = record.correction as Record<string, unknown>;
  if (typeof correction.bookedAtIso !== "string" ||
    typeof correction.merchantRaw !== "string" ||
    typeof correction.accountId !== "string" ||
    typeof correction.currencyCode !== "string") {
    throw new Error("Import review correction text fields must be strings.");
  }
  if (typeof correction.amountMinor !== "number") {
    throw new Error("Import review correction amountMinor must be a number.");
  }
  return {
    reviewItemId: parseNonEmptyString(record.reviewItemId, "reviewItemId"),
    correction: {
      bookedAtIso: correction.bookedAtIso,
      amountMinor: correction.amountMinor,
      merchantRaw: correction.merchantRaw,
      accountId: correction.accountId,
      currencyCode: correction.currencyCode,
    },
  };
}

export function parseImportReviewDismissalRequest(input: unknown): {
  reviewItemId: string;
  reason: string;
} {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Import review dismissal input must be an object.");
  }
  const record = input as Record<string, unknown>;
  if (typeof record.reason !== "string") {
    throw new Error("Import review dismissal reason must be a string.");
  }
  return {
    reviewItemId: parseNonEmptyString(record.reviewItemId, "reviewItemId"),
    reason: record.reason,
  };
}

export function parseSameMerchantPropagationInput(input: unknown): SameMerchantPropagationInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Propagation input must be an object.");
  }

  const record = input as Record<string, unknown>;
  if (record.confirmed !== true) {
    throw new Error("Propagation must be explicitly confirmed.");
  }
  if (!Array.isArray(record.transactionIds) || record.transactionIds.length === 0) {
    throw new Error("transactionIds must contain at least one transaction ID.");
  }
  const transactionIds = record.transactionIds.map((transactionId, index) =>
    parseNonEmptyString(transactionId, `transactionIds[${index}]`)
  );
  if (new Set(transactionIds).size !== transactionIds.length) {
    throw new Error("transactionIds must be unique.");
  }

  return {
    sourceTransactionId: parseNonEmptyString(record.sourceTransactionId, "sourceTransactionId"),
    merchantAlias: parseNonEmptyString(record.merchantAlias, "merchantAlias"),
    categoryId: parseNonEmptyString(record.categoryId, "categoryId"),
    transactionIds,
  };
}

export function parseSameMerchantPropagationPreviewRequest(
  input: unknown
): SameMerchantPropagationPreviewRequest {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Propagation preview input must be an object.");
  }

  const record = input as Record<string, unknown>;
  return {
    sourceTransactionId: parseNonEmptyString(record.sourceTransactionId, "sourceTransactionId"),
  };
}

export function parseTransactionQuery(input: unknown): TransactionQuery {
  if (input === undefined) return {};
  if (typeof input !== "object" || input === null) {
    throw new Error("Transaction query must be an object.");
  }

  const record = input as Record<string, unknown>;
  const query: TransactionQuery = {};
  const stringFields = ["accountId", "bookedFromIso", "bookedToIso", "merchant", "categoryId"] as const;
  for (const field of stringFields) {
    if (record[field] !== undefined) {
      query[field] = parseNonEmptyString(record[field], field);
    }
  }
  if (record.sortBy !== undefined) {
    const sortFields: TransactionSortField[] = [
      "bookedAtIso",
      "merchantRaw",
      "amountMinor",
      "categoryId",
      "accountId",
    ];
    if (typeof record.sortBy !== "string" || !sortFields.includes(record.sortBy as TransactionSortField)) {
      throw new Error("sortBy must be a supported ledger field.");
    }
    query.sortBy = record.sortBy as TransactionSortField;
  }
  if (record.sortDirection !== undefined) {
    if (record.sortDirection !== "asc" && record.sortDirection !== "desc") {
      throw new Error("sortDirection must be 'asc' or 'desc'.");
    }
    query.sortDirection = record.sortDirection as TransactionSortDirection;
  }
  if (record.page !== undefined) {
    if (typeof record.page !== "number" || !Number.isSafeInteger(record.page) || record.page < 1) {
      throw new Error("page must be a positive safe integer.");
    }
    query.page = record.page;
  }
  if (record.pageSize !== undefined) {
    if (
      typeof record.pageSize !== "number" ||
      !Number.isSafeInteger(record.pageSize) ||
      record.pageSize < 1 ||
      record.pageSize > MAX_TRANSACTION_PAGE_SIZE
    ) {
      throw new Error(`pageSize must be an integer between 1 and ${MAX_TRANSACTION_PAGE_SIZE}.`);
    }
    query.pageSize = record.pageSize;
  }
  if (record.amountMinor !== undefined) {
    if (typeof record.amountMinor !== "number" || !Number.isSafeInteger(record.amountMinor)) {
      throw new Error("amountMinor must be a safe integer when provided.");
    }
    query.amountMinor = record.amountMinor;
  }
  for (const field of ["amountFromMinor", "amountToMinor"] as const) {
    if (record[field] !== undefined) {
      if (typeof record[field] !== "number" || !Number.isSafeInteger(record[field])) {
        throw new Error(`${field} must be a safe integer when provided.`);
      }
      query[field] = record[field];
    }
  }
  if (
    query.amountFromMinor !== undefined &&
    query.amountToMinor !== undefined &&
    query.amountFromMinor > query.amountToMinor
  ) {
    throw new Error("amountFromMinor must not exceed amountToMinor.");
  }
  if (record.uncategorizedOnly !== undefined) {
    if (typeof record.uncategorizedOnly !== "boolean") {
      throw new Error("uncategorizedOnly must be a boolean when provided.");
    }
    query.uncategorizedOnly = record.uncategorizedOnly;
  }
  if (record.largeTransactionsOnly !== undefined) {
    if (typeof record.largeTransactionsOnly !== "boolean") {
      throw new Error("largeTransactionsOnly must be a boolean when provided.");
    }
    query.largeTransactionsOnly = record.largeTransactionsOnly;
  }
  if (record.transactionType !== undefined) {
    if (record.transactionType !== "income" && record.transactionType !== "expenses") {
      throw new Error("transactionType must be 'income' or 'expenses'.");
    }
    query.transactionType = record.transactionType;
  }
  if (record.datePreset !== undefined) {
    if (record.datePreset !== "thisMonth") {
      throw new Error("datePreset must be 'thisMonth'.");
    }
    query.datePreset = record.datePreset;
  }
  return query;
}

export function parseTransactionFilters(input: unknown): TransactionFilters {
  const query = parseTransactionQuery(input);
  return {
    ...(query.accountId === undefined ? {} : { accountId: query.accountId }),
    ...(query.bookedFromIso === undefined ? {} : { bookedFromIso: query.bookedFromIso }),
    ...(query.bookedToIso === undefined ? {} : { bookedToIso: query.bookedToIso }),
    ...(query.merchant === undefined ? {} : { merchant: query.merchant }),
    ...(query.amountMinor === undefined ? {} : { amountMinor: query.amountMinor }),
    ...(query.amountFromMinor === undefined ? {} : { amountFromMinor: query.amountFromMinor }),
    ...(query.amountToMinor === undefined ? {} : { amountToMinor: query.amountToMinor }),
    ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
    ...(query.uncategorizedOnly === undefined ? {} : { uncategorizedOnly: query.uncategorizedOnly }),
    ...(query.transactionType === undefined ? {} : { transactionType: query.transactionType }),
    ...(query.datePreset === undefined ? {} : { datePreset: query.datePreset }),
    ...(query.largeTransactionsOnly === undefined ? {} : { largeTransactionsOnly: query.largeTransactionsOnly }),
  };
}

export function parseCategoryTargetInput(input: unknown): MonthlyCategoryTargetInput {
  if (typeof input !== "object" || input === null) {
    throw new Error("Category target input must be an object.");
  }
  const record = input as Record<string, unknown>;
  if (
    typeof record.yearMonth !== "string" ||
    typeof record.categoryId !== "string" ||
    typeof record.targetMinor !== "number"
  ) {
    throw new Error("Category target input has invalid fields.");
  }
  return {
    yearMonth: record.yearMonth,
    categoryId: record.categoryId,
    targetMinor: record.targetMinor,
  };
}

export function parseOptionalDateTime(record: Record<string, unknown>, fieldName: string): string | undefined {
  const value = record[fieldName];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`${fieldName} must be a valid ISO date-time when provided.`);
  }
  return value;
}

export function parseAccountStatementCoveragePeriodInput(input: unknown): AccountStatementCoveragePeriod {
  if (typeof input !== "object" || input === null) {
    throw new Error("Account statement coverage period must be an object.");
  }
  const record = input as Record<string, unknown>;
  const currencyCode = record.currencyCode;
  const sourceType = record.sourceType;
  if (!isCurrencyCode(currencyCode)) {
    throw new Error("Account coverage currencyCode must be a three-letter currency code.");
  }
  if (sourceType !== "manual" && sourceType !== "csv" && sourceType !== "pdf") {
    throw new Error("Account coverage sourceType must be manual, csv, or pdf.");
  }
  if (typeof record.confirmed !== "boolean") {
    throw new Error("Account coverage confirmed must be a boolean.");
  }
  const importedAtIso = parseOptionalDateTime(record, "importedAtIso");
  const confirmedAtIso = parseOptionalDateTime(record, "confirmedAtIso");
  const period: AccountStatementCoveragePeriod = {
    id: parseNonEmptyString(record.id, "id"),
    accountId: parseNonEmptyString(record.accountId, "accountId"),
    startDateIso: parseNonEmptyString(record.startDateIso, "startDateIso"),
    endDateIso: parseNonEmptyString(record.endDateIso, "endDateIso"),
    currencyCode,
    sourceName: parseNonEmptyString(record.sourceName, "sourceName"),
    sourceType,
    confirmed: record.confirmed,
    ...(record.importJobId === undefined
      ? {}
      : { importJobId: parseNonEmptyString(record.importJobId, "importJobId") }),
    ...(importedAtIso === undefined ? {} : { importedAtIso }),
    ...(confirmedAtIso === undefined ? {} : { confirmedAtIso }),
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period.startDateIso) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(period.endDateIso)) {
    throw new Error("Account coverage dates must use YYYY-MM-DD.");
  }
  return period;
}

export function parseAccountBalanceCheckpointInput(input: unknown): AccountBalanceCheckpoint {
  if (typeof input !== "object" || input === null) {
    throw new Error("Account balance checkpoint must be an object.");
  }
  const record = input as Record<string, unknown>;
  const balanceMinor = record.balanceMinor;
  if (
    !isCurrencyCode(record.currencyCode) ||
    typeof balanceMinor !== "number" ||
    !Number.isSafeInteger(balanceMinor)
  ) {
    throw new Error("Account balance checkpoint currency or balance is invalid.");
  }
  const sourceReference = record.sourceReference;
  if (sourceReference !== undefined && typeof sourceReference !== "string") {
    throw new Error("Account checkpoint sourceReference must be a string when provided.");
  }
  const checkpoint: AccountBalanceCheckpoint = {
    id: parseNonEmptyString(record.id, "id"),
    accountId: parseNonEmptyString(record.accountId, "accountId"),
    dateIso: parseNonEmptyString(record.dateIso, "dateIso"),
    currencyCode: record.currencyCode,
    balanceMinor,
    source: parseNonEmptyString(record.source, "source"),
    recordedAtIso: parseNonEmptyString(record.recordedAtIso, "recordedAtIso"),
    ...(sourceReference === undefined ? {} : { sourceReference }),
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkpoint.dateIso) ||
    Number.isNaN(Date.parse(checkpoint.recordedAtIso))) {
    throw new Error("Account checkpoint date or recordedAtIso is invalid.");
  }
  return checkpoint;
}

export function parseTransactionCategoryAllocations(input: unknown): TransactionCategoryAllocation[] {
  if (!Array.isArray(input)) {
    throw new Error("Transaction category allocations must be an array.");
  }
  return input.map((value, index) => {
    if (typeof value !== "object" || value === null) {
      throw new Error(`Transaction category allocation ${index + 1} must be an object.`);
    }
    const record = value as Record<string, unknown>;
    const amountMinor = record.amountMinor;
    if (typeof amountMinor !== "number" || !Number.isSafeInteger(amountMinor)) {
      throw new Error(`allocations[${index}].amountMinor must be a safe integer.`);
    }
    return {
      categoryId: parseNonEmptyString(record.categoryId, `allocations[${index}].categoryId`),
      amountMinor,
    };
  });
}

export function parseMonthlyReferenceRateIds(input: unknown): Record<string, string> | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("monthlyReferenceRateIds must be an object.");
  }
  const result: Record<string, string> = {};
  for (const [currencyCode, rateId] of Object.entries(input)) {
    if (!isCurrencyCode(currencyCode)) {
      throw new Error(`Invalid monthly reference currency code: ${currencyCode}`);
    }
    result[currencyCode] = parseNonEmptyString(rateId, `monthlyReferenceRateIds.${currencyCode}`);
  }
  return result;
}

export function parseRestoreSnapshotInput(input: unknown): RestoreSnapshotInput {
  if (typeof input !== "object" || input === null) {
    throw new Error("Restore input must be an object.");
  }
  const record = input as Record<string, unknown>;
  if (
    record.expectedContentHashSha256 !== undefined &&
    (typeof record.expectedContentHashSha256 !== "string" ||
      !/^[a-f0-9]{64}$/i.test(record.expectedContentHashSha256))
  ) {
    throw new Error("expectedContentHashSha256 must be a SHA-256 digest.");
  }
  return {
    snapshotPath: parseNonEmptyString(record.snapshotPath, "snapshotPath"),
    ...(record.expectedContentHashSha256 === undefined
      ? {}
      : { expectedContentHashSha256: record.expectedContentHashSha256 as string }),
  };
}

export function getLocalBackupDirectory(): string {
  const databasePath = process.env["BUDGET_DB_PATH"] ?? join(process.cwd(), "data", "local", "budget.sqlite");
  return join(dirname(resolve(databasePath)), "backups");
}

interface RendererImportInput {
  filePath: string;
  requestId?: string;
  accountId?: string;
  columnMapping?: CsvColumnMapping;
  previewId?: string;
  duplicateDecisions?: DuplicateImportDecision[];
  acknowledgeExcludedRows?: boolean;
}

export function parseRendererImportInput(
  input: unknown,
  options: { csv: boolean; requirePreviewId: boolean }
): RendererImportInput {
  if (typeof input !== "object" || input === null) {
    throw new Error("Import input must be an object.");
  }

  const record = input as Record<string, unknown>;
  if (typeof record.filePath !== "string" || record.filePath.trim().length === 0) {
    throw new Error("filePath must be a non-empty string.");
  }
  if (record.accountId !== undefined && (typeof record.accountId !== "string" || record.accountId.trim().length === 0)) {
    throw new Error("accountId must be a non-empty string when provided.");
  }
  if (options.requirePreviewId && (typeof record.previewId !== "string" || record.previewId.trim().length === 0)) {
    throw new Error("previewId must be a non-empty string.");
  }
  if (record.requestId !== undefined && (typeof record.requestId !== "string" || record.requestId.trim().length === 0)) {
    throw new Error("requestId must be a non-empty string when provided.");
  }
  if (record.acknowledgeExcludedRows !== undefined && typeof record.acknowledgeExcludedRows !== "boolean") {
    throw new Error("acknowledgeExcludedRows must be a boolean when provided.");
  }

  let columnMapping: CsvColumnMapping | undefined;
  if (options.csv && record.columnMapping !== undefined) {
    if (typeof record.columnMapping !== "object" || record.columnMapping === null) {
      throw new Error("columnMapping must be an object when provided.");
    }

    const mapping: CsvColumnMapping = {};
    for (const [key, value] of Object.entries(record.columnMapping)) {
      if (!(key in CSV_COLUMN_NAMES) || typeof value !== "string" || value.trim().length === 0) {
        throw new Error(`Invalid CSV column mapping: ${key}`);
      }
      mapping[key as CsvColumnKey] = value;
    }
    columnMapping = mapping;
  }

  let duplicateDecisions: DuplicateImportDecision[] | undefined;
  if (record.duplicateDecisions !== undefined) {
    if (!Array.isArray(record.duplicateDecisions)) {
      throw new Error("duplicateDecisions must be an array when provided.");
    }
    const seenRowIndices = new Set<number>();
    duplicateDecisions = record.duplicateDecisions.map((value) => {
      if (typeof value !== "object" || value === null) {
        throw new Error("Each duplicate decision must be an object.");
      }
      const decision = value as Record<string, unknown>;
      if (!Number.isSafeInteger(decision.rowIndex) || (decision.rowIndex as number) < 0) {
        throw new Error("Duplicate decision rowIndex must be a non-negative integer.");
      }
      if (decision.action !== "skip" && decision.action !== "import") {
        throw new Error("Duplicate decision action must be 'skip' or 'import'.");
      }
      const rowIndex = decision.rowIndex as number;
      if (seenRowIndices.has(rowIndex)) throw new Error(`Duplicate decision supplied more than once for row ${rowIndex + 1}.`);
      seenRowIndices.add(rowIndex);
      return { rowIndex, action: decision.action };
    });
  }

  return {
    filePath: record.filePath.trim(),
    ...(record.requestId === undefined ? {} : { requestId: (record.requestId as string).trim() }),
    ...(record.accountId === undefined ? {} : { accountId: (record.accountId as string).trim() }),
    ...(columnMapping === undefined ? {} : { columnMapping }),
    ...(record.previewId === undefined ? {} : { previewId: (record.previewId as string).trim() }),
    ...(duplicateDecisions === undefined ? {} : { duplicateDecisions }),
    ...(record.acknowledgeExcludedRows === undefined ? {} : { acknowledgeExcludedRows: record.acknowledgeExcludedRows }),
  };
}

export function getPdfImportSourceFormat(filePath: string): "pdf" | "text" {
  const format = classifyImportFilePath(filePath);
  if (format !== "pdf" && format !== "text") {
    throw new Error("Choose a .txt or .pdf statement file.");
  }
  return format;
}

export function parseCsvImportProfileInput(input: unknown): {
  id?: string;
  name: string;
  accountId: string;
  columnMapping: CsvColumnMapping;
} {
  if (typeof input !== "object" || input === null) {
    throw new Error("CSV import profile input must be an object.");
  }

  const record = input as Record<string, unknown>;
  const columnMappingValue = record.columnMapping ?? {};
  if (typeof columnMappingValue !== "object" || columnMappingValue === null || Array.isArray(columnMappingValue)) {
    throw new Error("columnMapping must be an object.");
  }

  const columnMapping: CsvColumnMapping = {};
  for (const [key, value] of Object.entries(columnMappingValue)) {
    if (!(key in CSV_COLUMN_NAMES) || typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Invalid CSV column mapping: ${key}`);
    }
    columnMapping[key as CsvColumnKey] = value.trim();
  }

  return {
    ...(record.id === undefined ? {} : { id: parseNonEmptyString(record.id, "id") }),
    name: parseNonEmptyString(record.name, "name"),
    accountId: parseNonEmptyString(record.accountId, "accountId"),
    columnMapping,
  };
}

export function csvPreviewFailure(code: string, message: string): CsvImportPreviewFailure {
  return { ok: false, code, message };
}

export function csvPreviewReceiptFailure(error: ImportPreviewError): CsvImportResponse {
  return {
    ok: false,
    errors: [{ rowIndex: -1, fields: ["preview"], codes: [error.code], messages: [error.message] }],
  };
}

export function pdfPreviewReceiptFailure(error: ImportPreviewError): PdfImportResponse {
  return { ok: false, errors: [{ code: error.code, message: error.message }] };
}
