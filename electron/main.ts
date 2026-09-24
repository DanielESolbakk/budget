import { app, BrowserWindow, dialog, ipcMain, session } from "electron";
import { installNetworkGuard } from "./networkGuard.js";
import { createDashboardProvider } from "./dashboardProvider.js";
import {
  createCsvExportDialog,
  createRestoreSnapshotDialog,
} from "./fileDialogProvider.js";
import { join, resolve } from "path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
import { LedgerOperationCoordinator } from "../src/app/ledgerOperationCoordinator.js";
import { categorizeTransaction, categorizeTransactions } from "../src/domain/categorization/categorizeTransaction.js";
import { normalizeMerchantName } from "../src/domain/merchant/normalizeMerchantName.js";
import { restoreBackupSnapshot } from "../src/app/backup/restoreBackupSnapshot.js";
import {
  buildCsvImportRequest,
  filterPreviouslyImportedCsvTransactions,
  normalizeCsvImportErrors,
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
  appendUniqueTransactions,
  previewPdfImportWorkflow,
  runPdfImportWorkflow,
  type PdfImportPreviewResponse,
  type PdfImportResponse,
} from "../src/app/import/importPdf.js";
import { extractPdfTextFromBuffer } from "../src/app/import/extractPdfText.js";
import { parseCsvText } from "../src/domain/import/parseCsvText.js";
import {
  mapCsvRows,
  previewCsvRows,
  CSV_COLUMN_NAMES,
  type CsvColumnKey,
  type CsvColumnMapping,
} from "../src/domain/import/csvRowMapper.js";
import { defaultParserAdapterRegistry } from "../src/domain/import/parserAdapterRegistry.js";
import { buildRogalandImportJobId } from "../src/domain/import/pdfTextParser.js";
import { buildMonthBuckets } from "../src/domain/forecast/aggregationAdapter.js";
import { filterTransactions, type TransactionQuery } from "../src/domain/ledger/filterTransactions.js";
import type {
  BackupSnapshotFileOutput,
  RestoreSnapshotInput,
  RestoreSnapshotOutput,
} from "../src/domain/backup/snapshotContract.js";
import {
  validateMonthlyCategoryTargetInput,
  type Household,
  type Account,
  type ImportJob,
  type ManualEntryInput,
  type MonthlyCategoryTargetInput,
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

const sampleImportJobs: ImportJob[] = [];

// Runtime state mirrors the persisted ledger for dashboard and import workflows.
const liveTransactions: Transaction[] = [
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

const sampleTargetStore = createMonthlyCategoryTargetStore([
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
]);

const localLedgerDatabase = createLocalLedgerDatabase({
  seedData: {
    household: sampleHousehold,
    accounts: sampleAccounts,
    transactions: liveTransactions,
    importJobs: sampleImportJobs,
    monthlyCategoryTargets: Array.from(sampleTargetStore.targetsByMonthAndCategory.values()),
  },
});
const learnedCategoryRules = new Map(
  localLedgerDatabase.listMerchantCategoryRules().map((rule) => [rule.merchantAlias, rule.categoryId])
);
const importPreviewRegistry = new ImportPreviewRegistry();
const ledgerOperationCoordinator = new LedgerOperationCoordinator();
let mainWindow: BrowserWindow | undefined;
let ledgerGeneration = 0;

// Load persisted transactions from the SQLite ledger so that dashboard views include
// data imported in previous sessions. This merges DB transactions with the seed set
// by deduplicating on id to avoid double-counting sample rows already in the ledger.
function applyRuntimeLedgerSnapshot(snapshot: {
  household: Household;
  accounts: Account[];
  transactions: Transaction[];
  monthlyCategoryTargets: MonthlyCategoryTargetInput[];
  merchantCategoryRules?: Array<{ merchantAlias: string; categoryId: string }>;
}): void {
  sampleHousehold.id = snapshot.household.id;
  sampleHousehold.name = snapshot.household.name;
  sampleHousehold.createdAtIso = snapshot.household.createdAtIso;
  sampleAccounts.splice(0, sampleAccounts.length, ...snapshot.accounts);
  liveTransactions.splice(0, liveTransactions.length, ...snapshot.transactions);
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
    applyRuntimeLedgerSnapshot(localLedgerDatabase.loadLedgerSnapshotData());
  } catch (error) {
    console.error("Failed to hydrate runtime state from local ledger:", error);
  }
})();

function resolveDefaultAccountId(householdId: string): string {
  const account = sampleAccounts.find((item) => item.householdId === householdId);
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

function buildPdfImportJobId(contentIdentity: string, filePath: string): string {
  const resolvedPath = resolve(filePath);
  const canonicalPath = process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
  return `import-pdf-${createHash("sha256")
    .update(`${contentIdentity}|${canonicalPath}`, "utf8")
    .digest("hex")
    .slice(0, 24)}`;
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
  if (record.amountMinor !== undefined) {
    if (typeof record.amountMinor !== "number" || !Number.isSafeInteger(record.amountMinor)) {
      throw new Error("amountMinor must be a safe integer when provided.");
    }
    query.amountMinor = record.amountMinor;
  }
  return query;
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
  return { snapshotPath: parseNonEmptyString(record.snapshotPath, "snapshotPath") };
}

interface RendererImportInput {
  filePath: string;
  accountId?: string;
  columnMapping?: CsvColumnMapping;
  previewId?: string;
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

  return {
    filePath: record.filePath.trim(),
    ...(record.accountId === undefined ? {} : { accountId: (record.accountId as string).trim() }),
    ...(columnMapping === undefined ? {} : { columnMapping }),
    ...(record.previewId === undefined ? {} : { previewId: (record.previewId as string).trim() }),
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
  return buildDashboardData({ monthlyTotals: buildMonthBuckets(liveTransactions) });
}

function getViewData(yearMonth: string): DashboardViewContract {
  return buildDashboardViewContract({
    transactions: liveTransactions,
    selectedYearMonth: yearMonth,
    monthlyCategoryTargetStore: sampleTargetStore,
  });
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
  const csvExportDialog = createCsvExportDialog();
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

  ipcMain.handle("dialog:chooseBackupOutputPath", async (event) => {
    assertTrustedRenderer(event);
    const result = await dialog.showSaveDialog({
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

  ipcMain.handle("export:writeLedgerCsv", (event, outputPath: unknown): ExportCsvSummary => {
    assertTrustedRenderer(event);
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
      return ledgerOperationCoordinator.runExclusive(() => {
        const ledgerSnapshotData = localLedgerDatabase.loadLedgerSnapshotData();
        return createBackupSnapshot({
          ...ledgerSnapshotData,
          outputPath: parseNonEmptyString(outputPath, "outputPath"),
        });
      });
    }
  );

  ipcMain.handle(
    "backup:restore",
    (event, input: unknown): Promise<RestoreSnapshotOutput> => {
      assertTrustedRenderer(event);
      return ledgerOperationCoordinator.runExclusive(() => {
        const restored = restoreBackupSnapshot(parseRestoreSnapshotInput(input));
        localLedgerDatabase.replaceLedgerSnapshotData(restored);
        applyRuntimeLedgerSnapshot(restored);
        ledgerGeneration += 1;
        importPreviewRegistry.invalidateAll();
        return restored;
      });
    }
  );

  ipcMain.handle(
    "import:csvPreview",
    (
      event,
      input: unknown
    ): CsvImportPreviewResponse => {
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

      let csvBytes: Buffer;
      try {
        csvBytes = readFileSync(request.filePath);
      } catch (fileError) {
        return csvPreviewFailure(
          "FILE_READ_ERROR",
          fileError instanceof Error ? fileError.message : "Could not read CSV file."
        );
      }

      const csvText = csvBytes.toString("utf8");
      const rows = parseCsvText(csvText);
      const preview = previewCsvRows(rows, {
        householdId: request.householdId,
        accountId: request.accountId,
        columnMapping: request.columnMapping,
        sourceIdentity: digestImportBytes(csvBytes),
      });
      const previewId = importPreviewRegistry.create({
        format: "csv",
        filePath: request.filePath,
        fileDigest: digestImportBytes(csvBytes),
        householdId,
        accountId,
        ...(request.columnMapping === undefined ? {} : { columnMapping: request.columnMapping }),
      });
      return { ok: true, previewId, headers: Object.keys(rows[0] ?? {}), ...preview };
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
      const importJobIdentity = [request.householdId, request.accountId, canonicalPath, digestImportBytes(csvBytes)].join("|");
      const importJobId = `import-csv-${createHash("sha256").update(importJobIdentity, "utf8").digest("hex").slice(0, 24)}`;
      const now = new Date().toISOString();

      const result = mapCsvRows(rows, {
        householdId: request.householdId,
        accountId: request.accountId,
        importJobId,
        idPrefix: importJobId,
        columnMapping: request.columnMapping,
        sourceIdentity: digestImportBytes(csvBytes),
      });

      if (result.skipped.length > 0) {
        importPreviewRegistry.release(parsedInput.previewId!);
        return normalizeCsvImportErrors(result.skipped);
      }

      try {
        const importJob: ImportJob = {
          id: importJobId,
          householdId: request.householdId,
          sourceType: "csv",
          sourceName: request.filePath,
          startedAtIso: now,
          finishedAtIso: now,
          provenance: { sourceIdentity: digestImportBytes(csvBytes) },
        };

        const categorizedTransactions = categorizeTransactions(result.transactions, learnedCategoryRules);
        const pendingTransactions = filterPreviouslyImportedCsvTransactions(
          categorizedTransactions,
          localLedgerDatabase.loadLedgerSnapshotData(),
          {
            filePath: request.filePath,
            accountId: request.accountId,
            sourceIdentity: digestImportBytes(csvBytes),
          }
        );
        const insertedCount = localLedgerDatabase.appendImportJobAndTransactions(
          importJob,
          pendingTransactions
        );

        appendUniqueTransactions(liveTransactions, pendingTransactions);
        importPreviewRegistry.complete(parsedInput.previewId!);

        return {
          ok: true,
          importJobId,
          transactionCount: insertedCount,
          duplicateCount: result.transactions.length - insertedCount,
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
          liveTransactions,
          localLedgerDatabase
        );
        if (response.ok) {
          liveTransactions.push(response.transaction);
        }
        return response;
      });
    }
  );

  ipcMain.handle("transaction:listReview", (event) => {
    assertTrustedRenderer(event);
    return localLedgerDatabase
      .loadLedgerSnapshotData()
      .transactions.filter((transaction) => transaction.categoryId === undefined);
  });

  ipcMain.handle("transaction:list", (event, input: unknown = {}) => {
    assertTrustedRenderer(event);
    return filterTransactions(liveTransactions, parseTransactionQuery(input));
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

      const transaction = liveTransactions.find((item) => item.id === transactionId);
      if (transaction === undefined) {
        throw new Error(`Transaction not found: ${transactionId}`);
      }

      const merchantAlias = normalizeMerchantName(transaction.merchantRaw);
      localLedgerDatabase.updateTransactionCategoryAndRule(transactionId, { merchantAlias, categoryId });
      learnedCategoryRules.set(merchantAlias, categoryId);
      transaction.categoryId = categoryId;
        return { ...transaction };
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

      let pdfBytes: Buffer;
      try {
        pdfBytes = readFileSync(request.filePath);
      } catch (fileError) {
        return normalizePdfImportErrors([
          {
            code: "FILE_READ_ERROR",
            message: fileError instanceof Error ? fileError.message : "Could not read PDF text file.",
          },
        ]);
      }

      const pdfText = await extractPdfTextFromBuffer(pdfBytes);
      const preview = previewPdfImportWorkflow(
        {
          pdfText,
          householdId: request.householdId,
          accountId: request.accountId,
        },
        defaultParserAdapterRegistry
      );
      if (!preview.ok) return preview;
      if (previewGeneration !== ledgerGeneration) {
        return normalizePdfImportErrors([{
          code: "FILE_READ_ERROR",
          message: "The ledger changed while the statement was being checked. Preview the statement again.",
        }]);
      }

      const previewId = importPreviewRegistry.create({
        format: "pdf",
        filePath: request.filePath,
        fileDigest: digestImportBytes(pdfBytes),
        householdId,
        accountId,
      });
      return { ...preview, previewId };
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

      const contentIdentity = buildRogalandImportJobId(pdfText, {
        householdId: request.householdId,
        accountId: request.accountId,
      });
      const importJobId = buildPdfImportJobId(contentIdentity, request.filePath);
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
          startedAtIso: now,
          finishedAtIso: now,
        }, {
          parserRegistry: defaultParserAdapterRegistry,
          hasImportJob: localLedgerDatabase.hasImportJob,
          getTransactionsForImportJob: localLedgerDatabase.getTransactionsForImportJob,
          getImportedTransactionsForSource: localLedgerDatabase.getImportedTransactionsForSource,
          appendImportJob: localLedgerDatabase.appendImportJob,
          appendImportJobAndTransactions: localLedgerDatabase.appendImportJobAndTransactions,
          appendTransactions: localLedgerDatabase.appendTransactions,
          onTransactionsPersisted: (transactions) => {
            appendUniqueTransactions(
              liveTransactions,
              transactions.map((transaction) => categorizeTransaction(transaction, learnedCategoryRules))
            );
          },
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
