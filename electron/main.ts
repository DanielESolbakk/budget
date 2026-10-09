import { app, BrowserWindow, ipcMain, session } from "electron";
import { installNetworkGuard } from "./networkGuard.js";
import { createDashboardProvider } from "./dashboardProvider.js";
import {
  createBackupOutputDialog,
  createCsvExportDialog,
  createImportStatementDialog,
  createRestoreSnapshotDialog,
} from "./fileDialogProvider.js";
import { dirname, join, resolve } from "path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  buildDashboardData,
  buildDashboardViewContract,
  createMonthlyCategoryTargetStore,
  reloadMonthlyCategoryTargets,
  type DashboardData,
  type DashboardViewContract,
} from "../src/app/dashboardApi.js";
import { exportLedgerCsvToFile, type ExportCsvSummary } from "../src/app/exportCsv.js";
import { createBackupSnapshot } from "../src/app/backup/createBackupSnapshot.js";
import { createLocalLedgerDatabase } from "../src/app/backup/localLedgerSqlite.js";
import {
  catalogBackupSnapshot,
  createPreRestoreBackupSnapshot,
} from "../src/app/backup/snapshotCatalog.js";
import {
  applySameMerchantPropagation,
  listCategorizationReviewQueue,
  previewSameMerchantPropagation,
  undoSameMerchantPropagation,
} from "../src/app/reviewQueue.js";
import { LedgerOperationCoordinator } from "../src/app/ledgerOperationCoordinator.js";
import { categorizeTransaction, categorizeTransactions } from "../src/domain/categorization/categorizeTransaction.js";
import { normalizeMerchantName } from "../src/domain/merchant/normalizeMerchantName.js";
import {
  inspectBackupSnapshot,
  restoreBackupSnapshot,
} from "../src/app/backup/restoreBackupSnapshot.js";
import {
  buildCsvImportRequest,
  classifyPreviouslyImportedCsvCandidates,
  normalizeCsvImportErrors,
  previewCsvRowsWithProgress,
  type CsvImportPreviewFailure,
  type CsvImportPreviewResponse,
  type CsvImportResponse,
} from "../src/app/import/importCsv.js";
import {
  ImportPreviewError,
  ImportPreviewRegistry,
  digestImportBytes,
} from "../src/app/import/importPreviewRegistry.js";
import {
  submitManualEntry,
  type ManualEntryResponse,
} from "../src/app/import/manualEntry.js";
import {
  buildPdfImportRequest,
  normalizePdfImportErrors,
  previewPdfImportWorkflowInBatches,
  runPdfImportWorkflow,
  type PdfImportPreviewResponse,
  type PdfImportResponse,
} from "../src/app/import/importPdf.js";
import { extractPdfTextFromBuffer } from "../src/app/import/extractPdfText.js";
import { parseCsvText } from "../src/domain/import/parseCsvText.js";
import type { CsvImportProfile } from "../src/domain/import/csvImportProfile.js";
import type { ImportJobHistoryEntry } from "../src/domain/import/importJobHistory.js";
import type { ImportPreflightProgress } from "../src/app/import/importPreflight.js";
import { classifyDuplicateCandidates, type DuplicateImportDecision } from "../src/domain/import/filterPreviouslyImportedTransactions.js";
import {
  mapCsvRows,
  CSV_COLUMN_NAMES,
  type CsvColumnKey,
  type CsvColumnMapping,
} from "../src/domain/import/csvRowMapper.js";
import { defaultParserAdapterRegistry } from "../src/domain/import/parserAdapterRegistry.js";
import {
  MAX_TRANSACTION_PAGE_SIZE,
  type SavedLedgerView,
  type TransactionFilters,
  type TransactionQuery,
  type TransactionSortDirection,
  type TransactionSortField,
} from "../src/domain/ledger/filterTransactions.js";
import type {
  BackupSnapshotCatalogEntry,
  BackupSnapshotFileOutput,
  BackupSnapshotSummary,
  RestoreSnapshotInput,
  RestoreSnapshotResult,
} from "../src/domain/backup/snapshotContract.js";
import {
  isCurrencyCode,
  validateMonthlyCategoryTargetInput,
  type Household,
  type Account,
  type ImportJob,
  type ManualEntryInput,
  type MonthlyCategoryTargetInput,
  type SameMerchantPropagationInput,
  type SameMerchantPropagationPreviewRequest,
  type Transaction,
} from "../src/domain/types.js";

const sampleHousehold: Household = {
  id: "sample-hh",
  name: "Sample Household",
  createdAtIso: "2026-01-01T00:00:00Z",
};

const sampleAccounts: Account[] = [
  { id: "sample-acc", householdId: "sample-hh", name: "Brukskonto", currencyCode: "NOK" },
];

const sampleTransactions: Transaction[] = [
  {
    id: "sample-tx-1",
    householdId: "sample-hh",
    accountId: "sample-acc",
    bookedAtIso: "2026-04-15T10:00:00Z",
    amountMinor: 51000,
    merchantRaw: "Lønn AS",
    categoryId: "salary",
  },
  {
    id: "sample-tx-2",
    householdId: "sample-hh",
    accountId: "sample-acc",
    bookedAtIso: "2026-04-20T10:00:00Z",
    amountMinor: -7200,
    merchantRaw: "Kiwi",
    categoryId: "groceries",
  },
  {
    id: "sample-tx-3",
    householdId: "sample-hh",
    accountId: "sample-acc",
    bookedAtIso: "2026-05-02T10:00:00Z",
    amountMinor: 54000,
    merchantRaw: "Lønn AS",
    categoryId: "salary",
  },
  {
    id: "sample-tx-4",
    householdId: "sample-hh",
    accountId: "sample-acc",
    bookedAtIso: "2026-05-15T10:00:00Z",
    amountMinor: -8500,
    merchantRaw: "Rema 1000",
    categoryId: "groceries",
  },
];

const sampleTargets: MonthlyCategoryTargetInput[] = [
  {
    yearMonth: "2026-04",
    categoryId: "groceries",
    targetMinor: 7000,
  },
  {
    yearMonth: "2026-05",
    categoryId: "groceries",
    targetMinor: 9000,
  },
];

const isTestEnvironment = process.env["NODE_ENV"] === "test";
const runtimeAccounts: Account[] = [];
const sampleTargetStore = createMonthlyCategoryTargetStore(isTestEnvironment ? sampleTargets : []);

const localLedgerDatabase = createLocalLedgerDatabase({
  ...(isTestEnvironment
    ? {
        seedData: {
          household: sampleHousehold,
          accounts: sampleAccounts,
          transactions: sampleTransactions,
          importJobs: [],
          monthlyCategoryTargets: sampleTargets,
        },
      }
    : {}),
});
const learnedCategoryRules = new Map(
  localLedgerDatabase.listMerchantCategoryRules().map((rule) => [rule.merchantAlias, rule.categoryId])
);
const importPreviewRegistry = new ImportPreviewRegistry();
const ledgerOperationCoordinator = new LedgerOperationCoordinator();
let mainWindow: BrowserWindow | undefined;
let ledgerGeneration = 0;
const activeImportPreflights = new Map<string, { cancelled: boolean }>();

// Load persisted transactions from the SQLite ledger so that dashboard views include
// data imported in previous sessions. This merges DB transactions with the seed set
// by deduplicating on id to avoid double-counting sample rows already in the ledger.
function applyRuntimeLedgerSnapshot(snapshot: {
  household: Household;
  accounts: Account[];
  monthlyCategoryTargets: MonthlyCategoryTargetInput[];
  merchantCategoryRules?: Array<{ merchantAlias: string; categoryId: string }>;
}): void {
  sampleHousehold.id = snapshot.household.id;
  sampleHousehold.name = snapshot.household.name;
  sampleHousehold.createdAtIso = snapshot.household.createdAtIso;
  runtimeAccounts.splice(0, runtimeAccounts.length, ...snapshot.accounts);
  sampleTargetStore.targetsByMonthAndCategory.clear();
  for (const target of snapshot.monthlyCategoryTargets) {
    const key = `${target.yearMonth}::${target.categoryId}`;
    sampleTargetStore.targetsByMonthAndCategory.set(key, {
      yearMonth: target.yearMonth,
      categoryId: target.categoryId,
      targetMinor: target.targetMinor,
    });
  }
  learnedCategoryRules.clear();
  for (const rule of snapshot.merchantCategoryRules ?? []) {
    learnedCategoryRules.set(rule.merchantAlias, rule.categoryId);
  }
}

(function hydrateFromLedger(): void {
  try {
    const runtimeMetadata = localLedgerDatabase.loadRuntimeMetadata();
    if (runtimeMetadata !== null) applyRuntimeLedgerSnapshot(runtimeMetadata);
  } catch (error) {
    console.error("Failed to hydrate runtime state from local ledger:", error);
  }
})();

function resolveDefaultAccountId(householdId: string): string {
  const account = runtimeAccounts.find((item) => item.householdId === householdId);
  if (!account) {
    throw new Error(`No account available for household ${householdId}`);
  }

  return account.id;
}

function accountBelongsToHousehold(accountId: string, householdId: string): boolean {
  return localLedgerDatabase
    .getAccountsForHousehold(householdId)
    .some((account) => account.id === accountId);
}

function invalidAccountMessage(accountId: string): string {
  return `accountId must identify an account belonging to the household: ${accountId}`;
}

function assertTrustedRenderer(event: Electron.IpcMainInvokeEvent): void {
  if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) {
    throw new Error("Untrusted renderer sender.");
  }
  const senderUrl = event.senderFrame?.url;
  const packagedRendererUrl = pathToFileURL(join(__dirname, "../renderer/index.html")).href;
  if (senderUrl === packagedRendererUrl) return;

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (senderUrl !== undefined && rendererUrl !== undefined) {
    try {
      if (new URL(senderUrl).origin === new URL(rendererUrl).origin) return;
    } catch {
      // Reject malformed origins below.
    }
  }

  throw new Error("Untrusted renderer sender.");
}

function parseNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function parseSameMerchantPropagationInput(input: unknown): SameMerchantPropagationInput {
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

function parseSameMerchantPropagationPreviewRequest(
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

function parseHouseholdSetupInput(input: unknown): {
  householdName: string;
  accountName: string;
  currencyCode: string;
} {
  if (typeof input !== "object" || input === null) {
    throw new Error("Household setup must be an object.");
  }
  const record = input as Record<string, unknown>;
  const householdName = parseNonEmptyString(record.householdName, "householdName");
  const accountName = parseNonEmptyString(record.accountName, "accountName");
  const currencyCode = parseNonEmptyString(record.currencyCode, "currencyCode").toUpperCase();
  if (householdName.length > 100 || accountName.length > 100) {
    throw new Error("Household and account names must be 100 characters or fewer.");
  }
  if (!isCurrencyCode(currencyCode)) {
    throw new Error("currencyCode must be a three-letter currency code.");
  }
  return { householdName, accountName, currencyCode };
}

function parseTransactionQuery(input: unknown): TransactionQuery {
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

function parseTransactionFilters(input: unknown): TransactionFilters {
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

function parseCategoryTargetInput(input: unknown): MonthlyCategoryTargetInput {
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

function parseRestoreSnapshotInput(input: unknown): RestoreSnapshotInput {
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

function getLocalBackupDirectory(): string {
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
}

function parseRendererImportInput(
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
  };
}

function parseCsvImportProfileInput(input: unknown): {
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

function csvPreviewFailure(code: string, message: string): CsvImportPreviewFailure {
  return { ok: false, code, message };
}

function csvPreviewReceiptFailure(error: ImportPreviewError): CsvImportResponse {
  return {
    ok: false,
    errors: [{ rowIndex: -1, fields: ["preview"], codes: [error.code], messages: [error.message] }],
  };
}

function pdfPreviewReceiptFailure(error: ImportPreviewError): PdfImportResponse {
  return { ok: false, errors: [{ code: error.code, message: error.message }] };
}

function getDashboardData(): DashboardData {
  return buildDashboardData({ monthlyTotals: localLedgerDatabase.listMonthlyTotals(sampleHousehold.id) });
}

function getViewData(yearMonth: string): DashboardViewContract {
  return buildDashboardViewContract({
    transactions: localLedgerDatabase.getTransactionsForMonth(sampleHousehold.id, yearMonth),
    selectedYearMonth: yearMonth,
    monthlyCategoryTargetStore: sampleTargetStore,
  });
}

async function applyTransactionListTestControl(queryKind: "ledger" | "review"): Promise<void> {
  if (process.env["NODE_ENV"] !== "test") return;

  const shouldFail = queryKind === "ledger"
    ? process.env["BUDGET_TEST_LEDGER_LIST_FAILURE"] === "1"
    : process.env["BUDGET_TEST_REVIEW_LIST_FAILURE"] === "1";
  if (shouldFail) {
    const label = queryKind === "ledger" ? "ledger list" : "review list";
    throw new Error(`Synthetic ${label} failure.`);
  }

  const delayMs = Number(queryKind === "ledger"
    ? process.env["BUDGET_TEST_LEDGER_LIST_DELAY_MS"]
    : process.env["BUDGET_TEST_REVIEW_LIST_DELAY_MS"]);
  if (Number.isFinite(delayMs) && delayMs > 0) {
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, delayMs));
  }
}

async function applyRecoveryOperationTestDelay(): Promise<void> {
  if (process.env["NODE_ENV"] !== "test") return;
  const delayMs = Number(process.env["BUDGET_TEST_RECOVERY_OPERATION_DELAY_MS"]);
  if (!Number.isSafeInteger(delayMs) || delayMs < 1) return;
  await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, delayMs));
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = undefined;
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  installNetworkGuard(session.defaultSession);

  const dashboardTestOverrides =
    process.env["NODE_ENV"] === "test"
      ? (await import("./testDashboardOverrides.js")).createTestDashboardOverrides()
      : undefined;
  const dashboardProvider = createDashboardProvider({
    getData: getDashboardData,
    getViewData,
    ...(dashboardTestOverrides === undefined ? {} : { testOverrides: dashboardTestOverrides }),
  });
  const backupOutputDialog = createBackupOutputDialog();
  const csvExportDialog = createCsvExportDialog();
  const csvImportStatementDialog = createImportStatementDialog("csv");
  const pdfImportStatementDialog = createImportStatementDialog("pdf");
  const restoreSnapshotDialog = createRestoreSnapshotDialog();

  ipcMain.handle("dashboard:getData", (event) => {
    assertTrustedRenderer(event);
    return dashboardProvider.getData();
  });

  ipcMain.handle("dashboard:getViewData", (event, yearMonth: unknown) => {
    assertTrustedRenderer(event);
    return dashboardProvider.getViewData(parseNonEmptyString(yearMonth, "yearMonth"));
  }
  );

  ipcMain.handle("forecast:getEntries", (event) => {
    assertTrustedRenderer(event);
    return getDashboardData().forecast.entries;
  });

  ipcMain.handle("dialog:chooseCsvExportPath", async (event) => {
    assertTrustedRenderer(event);
    const result = await csvExportDialog({
      defaultPath: "budget-transactions.csv",
      filters: [{ name: "CSV files", extensions: ["csv"] }],
    });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle("dialog:chooseCsvImportPath", async (event) => {
    assertTrustedRenderer(event);
    const result = await csvImportStatementDialog({
      properties: ["openFile"],
      filters: [{ name: "CSV files", extensions: ["csv"] }],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("dialog:choosePdfImportPath", async (event) => {
    assertTrustedRenderer(event);
    const result = await pdfImportStatementDialog({
      properties: ["openFile"],
      filters: [{ name: "PDF files", extensions: ["pdf"] }],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("dialog:chooseBackupOutputPath", async (event) => {
    assertTrustedRenderer(event);
    const result = await backupOutputDialog({
      defaultPath: "budget-backup.json",
      filters: [{ name: "JSON files", extensions: ["json"] }],
    });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle("dialog:chooseRestoreSnapshotPath", async (event) => {
    assertTrustedRenderer(event);
    const result = await restoreSnapshotDialog({
      properties: ["openFile"],
      filters: [{ name: "JSON files", extensions: ["json"] }],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("categoryTarget:upsert", (event, input: unknown) => {
    assertTrustedRenderer(event);
    return ledgerOperationCoordinator.runExclusive(() => {
      const validated = validateMonthlyCategoryTargetInput(parseCategoryTargetInput(input));
      const key = `${validated.yearMonth}::${validated.categoryId}`;
      const persisted = {
        yearMonth: validated.yearMonth,
        categoryId: validated.categoryId,
        targetMinor: validated.targetMinor,
      };
      localLedgerDatabase.upsertMonthlyCategoryTarget(persisted);
      sampleTargetStore.targetsByMonthAndCategory.set(key, persisted);
      return { ...persisted };
    });
  });

  ipcMain.handle("categoryTarget:listByMonth", (event, yearMonth: unknown) => {
    assertTrustedRenderer(event);
    return reloadMonthlyCategoryTargets(sampleTargetStore, parseNonEmptyString(yearMonth, "yearMonth"));
  });

  ipcMain.handle("account:list", (event, householdId: unknown): Account[] => {
    assertTrustedRenderer(event);
    return localLedgerDatabase.getAccountsForHousehold(parseNonEmptyString(householdId, "householdId"));
  });

  ipcMain.handle("account:getCurrent", (event): { householdId: string; accounts: Account[] } | null => {
    assertTrustedRenderer(event);
    if (!localLedgerDatabase.hasHousehold()) return null;
    return {
      householdId: sampleHousehold.id,
      accounts: localLedgerDatabase.getAccountsForHousehold(sampleHousehold.id),
    };
  });

  ipcMain.handle("setup:isRequired", (event): boolean => {
    assertTrustedRenderer(event);
    return !localLedgerDatabase.hasHousehold();
  });

  ipcMain.handle("setup:create", (event, input: unknown): void => {
    assertTrustedRenderer(event);
    const setupInput = parseHouseholdSetupInput(input);
    localLedgerDatabase.createInitialHouseholdAndAccount(setupInput);
    const runtimeMetadata = localLedgerDatabase.loadRuntimeMetadata();
    if (runtimeMetadata !== null) applyRuntimeLedgerSnapshot(runtimeMetadata);
    ledgerGeneration += 1;
  });

  ipcMain.handle("import:preflight:cancel", (event, requestId: unknown): boolean => {
    assertTrustedRenderer(event);
    const preflight = activeImportPreflights.get(parseNonEmptyString(requestId, "requestId"));
    if (preflight === undefined) return false;
    preflight.cancelled = true;
    return true;
  });

  ipcMain.handle("import:history:list", (event): ImportJobHistoryEntry[] => {
    assertTrustedRenderer(event);
    return localLedgerDatabase.listImportJobHistory(sampleHousehold.id);
  });

  ipcMain.handle("import:history:undo", (event, importJobId: unknown) => {
    assertTrustedRenderer(event);
    return ledgerOperationCoordinator.runExclusive(() => {
      const result = localLedgerDatabase.undoImportJob(parseNonEmptyString(importJobId, "importJobId"));
      const runtimeMetadata = localLedgerDatabase.loadRuntimeMetadata();
      if (runtimeMetadata !== null) applyRuntimeLedgerSnapshot(runtimeMetadata);
      ledgerGeneration += 1;
      importPreviewRegistry.invalidateAll();
      return result;
    });
  });

  ipcMain.handle("import:csvProfiles:list", (event): CsvImportProfile[] => {
    assertTrustedRenderer(event);
    return localLedgerDatabase.listCsvImportProfiles(sampleHousehold.id);
  });

  ipcMain.handle("import:csvProfiles:save", (event, input: unknown): CsvImportProfile => {
    assertTrustedRenderer(event);
    const parsedInput = parseCsvImportProfileInput(input);
    const householdId = sampleHousehold.id;
    if (!accountBelongsToHousehold(parsedInput.accountId, householdId)) {
      throw new Error(invalidAccountMessage(parsedInput.accountId));
    }

    const existingProfiles = localLedgerDatabase.listCsvImportProfiles(householdId);
    const existingProfile = parsedInput.id === undefined
      ? undefined
      : existingProfiles.find((profile) => profile.id === parsedInput.id);
    if (parsedInput.id !== undefined && existingProfile === undefined) {
      throw new Error("CSV import profile was not found in this household.");
    }

    const now = new Date().toISOString();
    const profile: CsvImportProfile = {
      id: existingProfile?.id ?? randomUUID(),
      householdId,
      name: parsedInput.name,
      accountId: parsedInput.accountId,
      columnMapping: parsedInput.columnMapping,
      createdAtIso: existingProfile?.createdAtIso ?? now,
      updatedAtIso: now,
    };
    localLedgerDatabase.saveCsvImportProfile(profile);
    return profile;
  });

  ipcMain.handle("import:csvProfiles:delete", (event, profileId: unknown): boolean => {
    assertTrustedRenderer(event);
    return localLedgerDatabase.deleteCsvImportProfile(
      sampleHousehold.id,
      parseNonEmptyString(profileId, "profileId")
    );
  });

  ipcMain.handle("export:writeLedgerCsv", async (event, outputPath: unknown): Promise<ExportCsvSummary> => {
    assertTrustedRenderer(event);
    await applyRecoveryOperationTestDelay();
    const validatedOutputPath = parseNonEmptyString(outputPath, "outputPath");

    const result = exportLedgerCsvToFile({
      ledger: localLedgerDatabase,
      outputPath: validatedOutputPath,
    });

    return {
      outputPath: result.outputPath,
      rowCount: result.rowCount,
    };
  });

  ipcMain.handle(
    "backup:create",
    (event, outputPath: unknown): Promise<BackupSnapshotFileOutput> => {
      assertTrustedRenderer(event);
      return ledgerOperationCoordinator.runExclusive(async () => {
        await applyRecoveryOperationTestDelay();
        const ledgerSnapshotData = localLedgerDatabase.loadLedgerSnapshotData();
        const result = createBackupSnapshot({
          ...ledgerSnapshotData,
          outputPath: parseNonEmptyString(outputPath, "outputPath"),
        });
        catalogBackupSnapshot({ snapshotPath: result.outputPath, kind: "backup" }, localLedgerDatabase);
        return result;
      });
    }
  );

  ipcMain.handle(
    "backup:inspect",
    (event, input: unknown): BackupSnapshotSummary => {
      assertTrustedRenderer(event);
      return inspectBackupSnapshot(parseRestoreSnapshotInput(input));
    }
  );

  ipcMain.handle(
    "backup:listSnapshots",
    (event): BackupSnapshotCatalogEntry[] => {
      assertTrustedRenderer(event);
      return localLedgerDatabase.listBackupSnapshots();
    }
  );

  ipcMain.handle(
    "backup:restore",
    (event, input: unknown): Promise<RestoreSnapshotResult> => {
      assertTrustedRenderer(event);
      return ledgerOperationCoordinator.runExclusive(async () => {
        await applyRecoveryOperationTestDelay();
        const restoreInput = parseRestoreSnapshotInput(input);
        const restored = restoreBackupSnapshot(restoreInput);
        const recoverySnapshot = createPreRestoreBackupSnapshot({
          outputDirectory: getLocalBackupDirectory(),
          ledgerSnapshotData: localLedgerDatabase.loadLedgerSnapshotData(),
          catalog: localLedgerDatabase,
        });
        localLedgerDatabase.replaceLedgerSnapshotData(restored);
        applyRuntimeLedgerSnapshot(restored);
        ledgerGeneration += 1;
        importPreviewRegistry.invalidateAll();
        return { ...restored, recoverySnapshot };
      });
    }
  );

  ipcMain.handle(
    "import:csvPreview",
    async (
      event,
      input: unknown
    ): Promise<CsvImportPreviewResponse> => {
      assertTrustedRenderer(event);
      const parsedInput = parseRendererImportInput(input, { csv: true, requirePreviewId: false });
      const householdId = sampleHousehold.id;
      const accountId = parsedInput.accountId ?? resolveDefaultAccountId(householdId);
      if (!accountBelongsToHousehold(accountId, householdId)) {
        return csvPreviewFailure("INVALID_ACCOUNT_ID", invalidAccountMessage(accountId));
      }
      const request = buildCsvImportRequest(parsedInput.filePath, {
        householdId,
        accountId,
        columnMapping: parsedInput.columnMapping,
      });
      const requestId = parsedInput.requestId ?? randomUUID();
      if (activeImportPreflights.has(requestId)) throw new Error("An import preflight with this request ID is already active.");
      const preflight = { cancelled: false };
      const previewGeneration = ledgerGeneration;
      activeImportPreflights.set(requestId, preflight);
      const reportProgress = (phase: string, completedRows: number, totalRows: number): void => {
        const progress: ImportPreflightProgress = { requestId, format: "csv", phase, completedRows, totalRows };
        event.sender.send("import:preflight:progress", progress);
      };

      try {
        reportProgress("Reading statement", 0, 0);
        let csvBytes: Buffer;
        try {
          csvBytes = await readFile(request.filePath);
        } catch (fileError) {
          return csvPreviewFailure(
            "FILE_READ_ERROR",
            fileError instanceof Error ? fileError.message : "Could not read CSV file."
          );
        }
        if (preflight.cancelled) return csvPreviewFailure("PREVIEW_CANCELLED", "Preview cancelled. No transactions were saved.");

        const csvText = csvBytes.toString("utf8");
        const rows = parseCsvText(csvText);
        reportProgress("Validating rows", 0, rows.length);
        const preview = await previewCsvRowsWithProgress(rows, {
          householdId: request.householdId,
          accountId: request.accountId,
          columnMapping: request.columnMapping,
          sourceIdentity: digestImportBytes(csvBytes),
          sourceScope: process.platform === "win32" ? resolve(request.filePath).toLowerCase() : resolve(request.filePath),
        }, {
          isCancelled: () => preflight.cancelled,
          onProgress: (completedRows, totalRows) => reportProgress("Validating rows", completedRows, totalRows),
          batchSize: 100,
        });
        if (preview === null || preflight.cancelled) {
          return csvPreviewFailure("PREVIEW_CANCELLED", "Preview cancelled. No transactions were saved.");
        }
        if (previewGeneration !== ledgerGeneration) {
          return csvPreviewFailure("PREVIEW_STALE", "The ledger changed while the statement was being checked. Preview it again.");
        }

        const snapshot = localLedgerDatabase.loadLedgerSnapshotData();
        const previouslyImported = localLedgerDatabase.getImportedTransactionsForSource(
          "csv",
          request.filePath,
          request.accountId,
          digestImportBytes(csvBytes)
        );
        const duplicateMatches = new Map(classifyPreviouslyImportedCsvCandidates(
          preview.transactions,
          previouslyImported,
          snapshot,
          { filePath: request.filePath, accountId: request.accountId, sourceIdentity: digestImportBytes(csvBytes) }
        )
          .filter((candidate) => candidate.duplicateMatch !== undefined)
          .map((candidate) => [candidate.candidate.id, candidate.duplicateMatch!]));
        const rowsWithDuplicateMatches = preview.rows.map((row) => {
          const duplicateMatch = row.transaction === undefined ? undefined : duplicateMatches.get(row.transaction.id);
          return duplicateMatch === undefined ? row : { ...row, duplicateMatch };
        });
        const previewId = importPreviewRegistry.create({
          format: "csv",
          filePath: request.filePath,
          fileDigest: digestImportBytes(csvBytes),
          householdId,
          accountId,
          ...(request.columnMapping === undefined ? {} : { columnMapping: request.columnMapping }),
        });
        return { ok: true, previewId, headers: Object.keys(rows[0] ?? {}), ...preview, rows: rowsWithDuplicateMatches };
      } finally {
        activeImportPreflights.delete(requestId);
      }
    }
  );

  ipcMain.handle(
    "import:csv",
    (
      event,
      input: unknown
    ): Promise<CsvImportResponse> => {
      assertTrustedRenderer(event);
      return ledgerOperationCoordinator.runExclusive(async () => {
        const parsedInput = parseRendererImportInput(input, { csv: true, requirePreviewId: true });
      const householdId = sampleHousehold.id;
      const accountId = parsedInput.accountId ?? resolveDefaultAccountId(householdId);
      if (!accountBelongsToHousehold(accountId, householdId)) {
        return {
          ok: false,
          errors: [
            {
              rowIndex: -1,
              fields: ["accountId"],
              codes: ["INVALID_ACCOUNT_ID"],
              messages: [invalidAccountMessage(accountId)],
            },
          ],
        };
      }

      const request = buildCsvImportRequest(parsedInput.filePath, {
        householdId,
        accountId,
        columnMapping: parsedInput.columnMapping,
      });

      let csvBytes: Buffer;
      try {
        csvBytes = readFileSync(request.filePath);
      } catch (fileError) {
        const message =
          fileError instanceof Error ? fileError.message : "Could not read CSV file.";
        return normalizeCsvImportErrors([
          {
            rowIndex: -1,
            errors: [{ code: "MISSING_DATE", message, field: "file" }],
          },
        ]);
      }

      try {
        importPreviewRegistry.claim(parsedInput.previewId!, {
          format: "csv",
          filePath: request.filePath,
          fileDigest: digestImportBytes(csvBytes),
          householdId,
          accountId,
          ...(request.columnMapping === undefined ? {} : { columnMapping: request.columnMapping }),
        });
      } catch (error) {
        if (error instanceof ImportPreviewError) {
          return csvPreviewReceiptFailure(error);
        }
        throw error;
      }

      const csvText = csvBytes.toString("utf8");
      const rows = parseCsvText(csvText);
      const canonicalPath = process.platform === "win32" ? resolve(request.filePath).toLowerCase() : resolve(request.filePath);
      const importJobId = `import-csv-${randomUUID()}`;
      const now = new Date().toISOString();

      const result = mapCsvRows(rows, {
        householdId: request.householdId,
        accountId: request.accountId,
        importJobId,
        idPrefix: importJobId,
        columnMapping: request.columnMapping,
        sourceIdentity: digestImportBytes(csvBytes),
        sourceScope: canonicalPath,
      });

      if (result.skipped.length > 0) {
        importPreviewRegistry.release(parsedInput.previewId!);
        return normalizeCsvImportErrors(result.skipped);
      }

      try {
        const categorizedTransactions = categorizeTransactions(result.transactions, learnedCategoryRules);
        const snapshot = localLedgerDatabase.loadLedgerSnapshotData();
        const previouslyImported = localLedgerDatabase.getImportedTransactionsForSource(
          "csv",
          request.filePath,
          request.accountId,
          digestImportBytes(csvBytes)
        );
        const classifiedCandidates = classifyPreviouslyImportedCsvCandidates(
          categorizedTransactions,
          previouslyImported,
          snapshot,
          { filePath: request.filePath, accountId: request.accountId, sourceIdentity: digestImportBytes(csvBytes) }
        );
        const decisions = new Map((parsedInput.duplicateDecisions ?? []).map((decision) => [decision.rowIndex, decision.action]));
        const duplicateRowIndices = new Set(classifiedCandidates.flatMap((candidate, index) =>
          candidate.duplicateMatch === undefined ? [] : [index]
        ));
        const missingDecisionIndex = Array.from(duplicateRowIndices).find((rowIndex) => !decisions.has(rowIndex));
        const unexpectedDecisionIndex = Array.from(decisions.keys()).find((rowIndex) => !duplicateRowIndices.has(rowIndex));
        if (missingDecisionIndex !== undefined || unexpectedDecisionIndex !== undefined) {
          importPreviewRegistry.release(parsedInput.previewId!);
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
        let skippedDuplicateCount = 0;
        for (const [rowIndex, candidate] of classifiedCandidates.entries()) {
          if (candidate.duplicateMatch === undefined) {
            pendingTransactions.push(candidate.candidate);
            continue;
          }
          if (decisions.get(rowIndex) === "skip") {
            skippedDuplicateCount += 1;
            continue;
          }
          pendingTransactions.push({ ...candidate.candidate, id: randomUUID() });
        }
        const importJob: ImportJob = {
          id: importJobId,
          householdId: request.householdId,
          sourceType: "csv",
          sourceName: request.filePath,
          candidateCount: result.transactions.length,
          startedAtIso: now,
          finishedAtIso: now,
          provenance: {
            sourceIdentity: digestImportBytes(csvBytes),
            accountId: request.accountId,
            duplicateCount: skippedDuplicateCount,
          },
        };
        const insertedCount = localLedgerDatabase.appendImportJobAndTransactions(
          importJob,
          pendingTransactions
        );

        importPreviewRegistry.complete(parsedInput.previewId!);

        return {
          ok: true,
          importJobId,
          transactionCount: insertedCount,
          duplicateCount: skippedDuplicateCount,
        };
      } catch (error) {
        importPreviewRegistry.release(parsedInput.previewId!);
        throw error;
      }
      });
    }
  );

  ipcMain.handle(
    "transaction:addManual",
    (event, input: unknown): Promise<ManualEntryResponse> => {
      assertTrustedRenderer(event);
      return ledgerOperationCoordinator.runExclusive(() => {
        const inputRecord =
          typeof input === "object" && input !== null
            ? (input as Record<string, unknown>)
            : undefined;

      if (inputRecord === undefined || typeof inputRecord.householdId !== "string") {
        return {
          ok: false,
          reason: "validation",
          code: "INVALID_HOUSEHOLD_ID",
          message: "householdId must be a string.",
        };
      }

      if (typeof inputRecord.accountId !== "string") {
        return {
          ok: false,
          reason: "validation",
          code: "INVALID_ACCOUNT_ID",
          message: "accountId must be a string.",
        };
      }

      if (typeof inputRecord.bookedAtIso !== "string") {
        return {
          ok: false,
          reason: "validation",
          code: "INVALID_BOOKED_AT_ISO",
          message: "bookedAtIso must be a string.",
        };
      }

      if (typeof inputRecord.amountMinor !== "number") {
        return {
          ok: false,
          reason: "validation",
          code: "INVALID_AMOUNT_MINOR_INTEGER",
          message: "amountMinor must be a number.",
        };
      }

      if (typeof inputRecord.merchantRaw !== "string") {
        return {
          ok: false,
          reason: "validation",
          code: "INVALID_MERCHANT_RAW",
          message: "merchantRaw must be a string.",
        };
      }

      if (inputRecord.categoryId !== undefined && typeof inputRecord.categoryId !== "string") {
        return {
          ok: false,
          reason: "validation",
          code: "INVALID_CATEGORY_ID",
          message: "categoryId must be a string when provided.",
        };
      }

        const response = submitManualEntry(
          inputRecord as unknown as ManualEntryInput,
          typeof inputRecord.accountId === "string"
            ? localLedgerDatabase.getTransactionsForAccount(inputRecord.accountId)
            : [],
          localLedgerDatabase
        );
        return response;
      });
    }
  );

  ipcMain.handle("transaction:listReview", async (event) => {
    assertTrustedRenderer(event);
    await applyTransactionListTestControl("review");
    return listCategorizationReviewQueue(localLedgerDatabase, sampleHousehold.id);
  });

  ipcMain.handle("review:correctionHistory:list", (event) => {
    assertTrustedRenderer(event);
    return localLedgerDatabase.listMerchantCorrectionProvenance();
  });

  ipcMain.handle("review:propagation:preview", (event, input: unknown) => {
    assertTrustedRenderer(event);
    const request = parseSameMerchantPropagationPreviewRequest(input);
    return ledgerOperationCoordinator.runExclusive(() => {
      const sourceTransaction = localLedgerDatabase.getTransactionById(request.sourceTransactionId);
      if (sourceTransaction === undefined || sourceTransaction.householdId !== sampleHousehold.id) {
        throw new Error(`Source transaction not found: ${request.sourceTransactionId}`);
      }
      return previewSameMerchantPropagation(localLedgerDatabase, request.sourceTransactionId);
    });
  });

  ipcMain.handle("review:propagationHistory:list", (event) => {
    assertTrustedRenderer(event);
    return localLedgerDatabase.listSameMerchantPropagationOperations();
  });

  ipcMain.handle("review:propagation:apply", (event, input: unknown) => {
    assertTrustedRenderer(event);
    const propagation = parseSameMerchantPropagationInput(input);
    return ledgerOperationCoordinator.runExclusive(() => {
      const sourceTransaction = localLedgerDatabase.getTransactionById(propagation.sourceTransactionId);
      if (sourceTransaction === undefined || sourceTransaction.householdId !== sampleHousehold.id) {
        throw new Error(`Source transaction not found: ${propagation.sourceTransactionId}`);
      }
      if (normalizeMerchantName(sourceTransaction.merchantRaw) !== propagation.merchantAlias) {
        throw new Error("Propagation merchantAlias does not match the source transaction.");
      }
      return applySameMerchantPropagation(localLedgerDatabase, propagation);
    });
  });

  ipcMain.handle("review:propagation:undo", (event, operationId: unknown) => {
    assertTrustedRenderer(event);
    return ledgerOperationCoordinator.runExclusive(() =>
      undoSameMerchantPropagation(
        localLedgerDatabase,
        parseNonEmptyString(operationId, "operationId")
      )
    );
  });

  ipcMain.handle("transaction:list", async (event, input: unknown = {}) => {
    assertTrustedRenderer(event);
    await applyTransactionListTestControl("ledger");
    const result = localLedgerDatabase.queryTransactions(sampleHousehold.id, parseTransactionQuery(input));
    const accounts = localLedgerDatabase.getAccountsForHousehold(sampleHousehold.id);
    return { ...result, accounts };
  });

  ipcMain.handle("ledgerView:list", (event) => {
    assertTrustedRenderer(event);
    return localLedgerDatabase.listSavedLedgerViews();
  });

  ipcMain.handle("ledgerView:save", (event, input: unknown) => {
    assertTrustedRenderer(event);
    if (typeof input !== "object" || input === null) {
      throw new Error("Saved ledger view input must be an object.");
    }
    const record = input as Record<string, unknown>;
    const name = parseNonEmptyString(record.name, "name");
    if (name.length > 40) throw new Error("Saved view name must be 40 characters or fewer.");
    const savedView: SavedLedgerView = {
      id: randomUUID(),
      name,
      filters: parseTransactionFilters(record.filters),
    };
    localLedgerDatabase.saveLedgerView(savedView);
    return savedView;
  });

  ipcMain.handle("ledgerView:delete", (event, viewId: unknown) => {
    assertTrustedRenderer(event);
    return localLedgerDatabase.deleteSavedLedgerView(parseNonEmptyString(viewId, "viewId"));
  });

  ipcMain.handle(
    "transaction:updateCategory",
    (event, input: unknown) => {
      assertTrustedRenderer(event);
      return ledgerOperationCoordinator.runExclusive(() => {
      if (typeof input !== "object" || input === null) {
        throw new Error("Category update input must be an object.");
      }
      const record = input as Record<string, unknown>;
      const transactionId = parseNonEmptyString(record.transactionId, "transactionId");
      const categoryId = parseNonEmptyString(record.categoryId, "categoryId");

      const transaction = localLedgerDatabase.getTransactionById(transactionId);
      if (transaction === undefined) {
        throw new Error(`Transaction not found: ${transactionId}`);
      }

      const merchantAlias = normalizeMerchantName(transaction.merchantRaw);
      const futureMatchingChanged = learnedCategoryRules.get(merchantAlias) !== categoryId;
      const updatedLearnedCategoryRules = new Map(learnedCategoryRules);
      updatedLearnedCategoryRules.set(merchantAlias, categoryId);
      const uncategorizedTransaction = { ...transaction };
      delete uncategorizedTransaction.categoryId;
      const correctedCategorization = categorizeTransaction(
        uncategorizedTransaction,
        updatedLearnedCategoryRules
      ).categorization;
      if (correctedCategorization === undefined) {
        throw new Error("Corrected transaction did not produce categorization metadata.");
      }
      localLedgerDatabase.updateTransactionCategoryAndRule(
        transactionId,
        { merchantAlias, categoryId },
        correctedCategorization
      );
      learnedCategoryRules.set(merchantAlias, categoryId);
      return {
        transaction: { ...transaction, categoryId, categorization: correctedCategorization },
        futureMatchingChanged,
      };
      });
    }
  );

  ipcMain.handle(
    "import:pdfPreview",
    async (
      event,
      input: unknown
    ): Promise<PdfImportPreviewResponse> => {
      assertTrustedRenderer(event);
      const previewGeneration = ledgerGeneration;
      const parsedInput = parseRendererImportInput(input, { csv: false, requirePreviewId: false });
      const householdId = sampleHousehold.id;
      const accountId = parsedInput.accountId ?? resolveDefaultAccountId(householdId);
      if (!accountBelongsToHousehold(accountId, householdId)) {
        return {
          ok: false,
          errors: [{ code: "INVALID_ACCOUNT_ID", message: invalidAccountMessage(accountId) }],
        };
      }
      const request = buildPdfImportRequest(parsedInput.filePath, { householdId, accountId });
      const requestId = parsedInput.requestId ?? randomUUID();
      if (activeImportPreflights.has(requestId)) throw new Error("An import preflight with this request ID is already active.");
      const preflight = { cancelled: false };
      activeImportPreflights.set(requestId, preflight);
      const reportProgress = (phase: string, completedRows: number, totalRows: number): void => {
        const progress: ImportPreflightProgress = { requestId, format: "pdf", phase, completedRows, totalRows };
        event.sender.send("import:preflight:progress", progress);
      };

      try {
        reportProgress("Reading statement", 0, 0);
        let pdfBytes: Buffer;
        try {
          pdfBytes = await readFile(request.filePath);
        } catch (fileError) {
          return normalizePdfImportErrors([{
            code: "FILE_READ_ERROR",
            message: fileError instanceof Error ? fileError.message : "Could not read PDF text file.",
          }]);
        }
        if (preflight.cancelled) {
          return { ok: false, errors: [{ code: "PREVIEW_CANCELLED", message: "Preview cancelled. No transactions were saved." }] };
        }

        reportProgress("Extracting statement text", 0, 0);
        const pdfText = await extractPdfTextFromBuffer(pdfBytes);
        if (preflight.cancelled) {
          return { ok: false, errors: [{ code: "PREVIEW_CANCELLED", message: "Preview cancelled. No transactions were saved." }] };
        }
        const totalRows = pdfText.match(/^\s*\d{2}\.\d{2}\.\d{4}\s+/gm)?.length ?? 0;
        reportProgress("Validating statement rows", 0, totalRows);
        const preview = await previewPdfImportWorkflowInBatches(
          {
            pdfText,
            filePath: request.filePath,
            householdId: request.householdId,
            accountId: request.accountId,
          },
          defaultParserAdapterRegistry,
          {
            isCancelled: () => preflight.cancelled,
            onProgress: (completedRows, batchTotalRows) => {
              if (completedRows % 100 === 0 || completedRows === batchTotalRows) {
                reportProgress("Validating statement rows", completedRows, batchTotalRows);
              }
            },
            batchSize: 10,
          }
        );
        if (preview === null || preflight.cancelled) {
          return { ok: false, errors: [{ code: "PREVIEW_CANCELLED", message: "Preview cancelled. No transactions were saved." }] };
        }
        if (!preview.ok) return preview;
        if (previewGeneration !== ledgerGeneration) {
          return normalizePdfImportErrors([{
            code: "FILE_READ_ERROR",
            message: "The ledger changed while the statement was being checked. Preview the statement again.",
          }]);
        }
        if (preflight.cancelled) {
          return { ok: false, errors: [{ code: "PREVIEW_CANCELLED", message: "Preview cancelled. No transactions were saved." }] };
        }
        reportProgress("Validating statement rows", preview.transactions.length, preview.transactions.length);

        const existingTransactions = localLedgerDatabase.getTransactionsForAccount(request.accountId);
        const duplicateCandidates = classifyDuplicateCandidates(preview.transactions, existingTransactions)
          .flatMap((candidate, rowIndex) => candidate.duplicateMatch === undefined
            ? []
            : [{ rowIndex, transactionId: candidate.candidate.id, duplicateMatch: candidate.duplicateMatch }]);

        const previewId = importPreviewRegistry.create({
          format: "pdf",
          filePath: request.filePath,
          fileDigest: digestImportBytes(pdfBytes),
          householdId,
          accountId,
        });
        return { ...preview, previewId, duplicateCandidates };
      } finally {
        activeImportPreflights.delete(requestId);
      }
    }
  );

  ipcMain.handle(
    "import:pdf",
    async (
      event,
      input: unknown
    ): Promise<PdfImportResponse> => {
      assertTrustedRenderer(event);
      return ledgerOperationCoordinator.runExclusive(async () => {
      const parsedInput = parseRendererImportInput(input, { csv: false, requirePreviewId: true });
      const householdId = sampleHousehold.id;
      const accountId = parsedInput.accountId ?? resolveDefaultAccountId(householdId);
      if (!accountBelongsToHousehold(accountId, householdId)) {
        return {
          ok: false,
          errors: [{ code: "INVALID_ACCOUNT_ID", message: invalidAccountMessage(accountId) }],
        };
      }

      const request = buildPdfImportRequest(parsedInput.filePath, { householdId, accountId });

      let pdfBytes: Buffer;
      try {
        pdfBytes = readFileSync(request.filePath);
      } catch (fileError) {
        const message =
          fileError instanceof Error ? fileError.message : "Could not read PDF text file.";
        return normalizePdfImportErrors([{ code: "FILE_READ_ERROR", message }]);
      }

      try {
        importPreviewRegistry.claim(parsedInput.previewId!, {
          format: "pdf",
          filePath: request.filePath,
          fileDigest: digestImportBytes(pdfBytes),
          householdId,
          accountId,
        });
      } catch (error) {
        if (error instanceof ImportPreviewError) {
          return pdfPreviewReceiptFailure(error);
        }
        throw error;
      }

      let pdfText: string;
      try {
        pdfText = await extractPdfTextFromBuffer(pdfBytes);
      } catch (error) {
        importPreviewRegistry.release(parsedInput.previewId!);
        const message = error instanceof Error ? error.message : "Could not extract PDF text.";
        return normalizePdfImportErrors([{ code: "FILE_READ_ERROR", message }]);
      }

      const importJobId = `import-pdf-${randomUUID()}`;
      const now = new Date().toISOString();

      let response: PdfImportResponse;
      try {
        response = runPdfImportWorkflow({
          pdfText,
          filePath: request.filePath,
          householdId: request.householdId,
          accountId: request.accountId,
          importJobId,
          categoryRules: learnedCategoryRules,
          ...(parsedInput.duplicateDecisions === undefined ? {} : { duplicateDecisions: parsedInput.duplicateDecisions }),
          startedAtIso: now,
          finishedAtIso: now,
        }, {
          parserRegistry: defaultParserAdapterRegistry,
          hasImportJob: localLedgerDatabase.hasImportJob,
          getTransactionsForImportJob: localLedgerDatabase.getTransactionsForImportJob,
          getImportedTransactionsForSource: localLedgerDatabase.getImportedTransactionsForSource,
          getExistingTransactionsForAccount: localLedgerDatabase.getTransactionsForAccount,
          appendImportJob: localLedgerDatabase.appendImportJob,
          appendImportJobAndTransactions: localLedgerDatabase.appendImportJobAndTransactions,
          appendTransactions: localLedgerDatabase.appendTransactions,
        });
      } catch (error) {
        importPreviewRegistry.release(parsedInput.previewId!);
        throw error;
      }
      if (response.ok) {
        importPreviewRegistry.complete(parsedInput.previewId!);
      } else {
        importPreviewRegistry.release(parsedInput.previewId!);
      }
      return response;
      });
    }
  );

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    localLedgerDatabase.close();
    app.quit();
  }
});