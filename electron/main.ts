import { app, BrowserWindow, ipcMain, session } from "electron";
import { installNetworkGuard } from "./networkGuard.js";
import { createDashboardProvider } from "./dashboardProvider.js";
import { join } from "path";
import { readFileSync } from "node:fs";
import {
  buildDashboardData,
  buildDashboardViewContract,
  createMonthlyCategoryTargetStore,
  reloadMonthlyCategoryTargets,
  type DashboardData,
  type DashboardViewContract,
} from "../src/app/dashboardApi.js";
import { exportCsv, exportCsvToFile } from "../src/app/exportCsv.js";
import { createBackupSnapshot } from "../src/app/backup/createBackupSnapshot.js";
import { createLocalLedgerDatabase } from "../src/app/backup/localLedgerSqlite.js";
import { restoreBackupSnapshot } from "../src/app/backup/restoreBackupSnapshot.js";
import {
  buildCsvImportRequest,
  normalizeCsvImportErrors,
  type CsvImportResponse,
} from "../src/app/import/importCsv.js";
import {
  submitManualEntry,
  type ManualEntryResponse,
} from "../src/app/import/manualEntry.js";
import {
  buildPdfImportRequest,
  normalizePdfImportErrors,
  runPdfImportWorkflow,
  type PdfImportResponse,
} from "../src/app/import/importPdf.js";
import { parseCsvText } from "../src/domain/import/parseCsvText.js";
import { mapCsvRows } from "../src/domain/import/csvRowMapper.js";
import { defaultParserAdapterRegistry } from "../src/domain/import/parserAdapterRegistry.js";
import { buildRogalandImportJobId } from "../src/domain/import/pdfTextParser.js";
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
  type MonthlyTotal,
  type Transaction,
} from "../src/domain/types.js";

const sampleMonthlyTotals: MonthlyTotal[] = [
  { yearMonth: "2026-03", totalMinor: 48000 },
  { yearMonth: "2026-04", totalMinor: 51000 },
  { yearMonth: "2026-05", totalMinor: 54000 },
];

// TODO: Replace with persistence-backed data when the storage layer is wired up.
// Tracked in: https://github.com/DanielESolbakk/budget/issues/38
const sampleHousehold: Household = {
  id: "sample-hh",
  name: "Sample Household",
  createdAtIso: "2026-01-01T00:00:00Z",
};

const sampleAccounts: Account[] = [
  { id: "sample-acc", householdId: "sample-hh", name: "Brukskonto", currencyCode: "NOK" },
];

const sampleImportJobs: ImportJob[] = [];

// Live transaction set: starts with sample data and grows with each import.
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

// Load persisted transactions from the SQLite ledger so that dashboard views include
// data imported in previous sessions. This merges DB transactions with the seed set
// by deduplicating on id to avoid double-counting sample rows already in the ledger.
(function hydrateFromLedger(): void {
  try {
    const snapshot = localLedgerDatabase.loadLedgerSnapshotData();
    const existingIds = new Set(liveTransactions.map((tx) => tx.id));
    for (const tx of snapshot.transactions) {
      if (!existingIds.has(tx.id)) {
        liveTransactions.push(tx);
        existingIds.add(tx.id);
      }
    }
  } catch (error) {
    console.error("Failed to hydrate transactions from local ledger:", error);
  }
})();

function resolveDefaultAccountId(householdId: string): string {
  const account = sampleAccounts.find((item) => item.householdId === householdId);
  if (!account) {
    throw new Error(`No account available for household ${householdId}`);
  }

  return account.id;
}

function getDashboardData(): DashboardData {
  return buildDashboardData({ monthlyTotals: sampleMonthlyTotals });
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

  ipcMain.handle("dashboard:getData", () => {
    return dashboardProvider.getData();
  });

  ipcMain.handle("dashboard:getViewData", (_event, yearMonth: string) =>
    dashboardProvider.getViewData(yearMonth)
  );

  ipcMain.handle("forecast:getEntries", () => {
    return getDashboardData().forecast.entries;
  });

  ipcMain.handle("categoryTarget:upsert", (_event, input: MonthlyCategoryTargetInput) => {
    // validateMonthlyCategoryTargetInput throws MonthlyCategoryTargetValidationError on invalid
    // input; Electron IPC propagates thrown errors to the renderer as a rejected promise, which
    // the renderer's catch block converts into a user-visible validation message.
    const validated = validateMonthlyCategoryTargetInput(input);
    const key = `${validated.yearMonth}::${validated.categoryId}`;
    const persisted = {
      yearMonth: validated.yearMonth,
      categoryId: validated.categoryId,
      targetMinor: validated.targetMinor,
    };
    sampleTargetStore.targetsByMonthAndCategory.set(key, persisted);
    localLedgerDatabase.upsertMonthlyCategoryTarget(persisted);
    return { ...persisted };
  });

  ipcMain.handle("categoryTarget:listByMonth", (_event, yearMonth: string) => {
    return reloadMonthlyCategoryTargets(sampleTargetStore, yearMonth);
  });

  ipcMain.handle("account:list", (_event, householdId: unknown): Account[] => {
    if (typeof householdId !== "string" || householdId.trim().length === 0) {
      return [];
    }
    return localLedgerDatabase.getAccountsForHousehold(householdId.trim());
  });

  ipcMain.handle("export:toCsv", (_event, transactions: Transaction[]) => {
    return exportCsv({ transactions });
  });

  ipcMain.handle("export:writeCsv", (_event, transactions: Transaction[], outputPath: string) => {
    return exportCsvToFile({ transactions, outputPath });
  });

  ipcMain.handle(
    "backup:create",
    (_event, outputPath: string): BackupSnapshotFileOutput => {
      const ledgerSnapshotData = localLedgerDatabase.loadLedgerSnapshotData();
      return createBackupSnapshot({
        ...ledgerSnapshotData,
        outputPath,
      });
    }
  );

  ipcMain.handle(
    "backup:restore",
    (_event, input: RestoreSnapshotInput): RestoreSnapshotOutput => {
      return restoreBackupSnapshot(input);
    }
  );

  ipcMain.handle(
    "import:csv",
    (
      _event,
      input: { filePath: string; accountId?: string }
    ): CsvImportResponse => {
      const householdId = sampleHousehold.id;
      const accountId = input.accountId ?? resolveDefaultAccountId(householdId);

      const request = buildCsvImportRequest(input.filePath, { householdId, accountId });

      let csvText: string;
      try {
        csvText = readFileSync(request.filePath, "utf8");
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

      const rows = parseCsvText(csvText);
      const importJobId = `import-csv-${Date.now()}`;
      const now = new Date().toISOString();

      const result = mapCsvRows(rows, {
        householdId: request.householdId,
        accountId: request.accountId,
        importJobId,
        idPrefix: importJobId,
      });

      if (result.skipped.length > 0) {
        return normalizeCsvImportErrors(result.skipped);
      }

      const importJob: ImportJob = {
        id: importJobId,
        householdId: request.householdId,
        sourceType: "csv",
        sourceName: request.filePath,
        startedAtIso: now,
        finishedAtIso: now,
      };

      localLedgerDatabase.appendImportJob(importJob);
      localLedgerDatabase.appendTransactions(result.transactions);

      for (const transaction of result.transactions) {
        liveTransactions.push(transaction);
      }

      return {
        ok: true,
        importJobId,
        transactionCount: result.transactions.length,
      };
    }
  );

  ipcMain.handle(
    "transaction:addManual",
    (_event, input: unknown): ManualEntryResponse => {
      const inputRecord =
        typeof input === "object" && input !== null
          ? (input as Record<string, unknown>)
          : undefined;

      if (
        inputRecord === undefined ||
        typeof inputRecord.householdId !== "string" ||
        typeof inputRecord.accountId !== "string" ||
        typeof inputRecord.bookedAtIso !== "string" ||
        typeof inputRecord.amountMinor !== "number" ||
        typeof inputRecord.merchantRaw !== "string"
      ) {
        return {
          ok: false,
          reason: "validation",
          code: "INVALID_HOUSEHOLD_ID",
          message: "Manual entry input is missing required fields or has invalid types.",
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
    }
  );

  ipcMain.handle(
    "import:pdf",
    (
      _event,
      input: { filePath: string; accountId?: string }
    ): PdfImportResponse => {
      const householdId = sampleHousehold.id;
      const accountId = input.accountId ?? resolveDefaultAccountId(householdId);

      const request = buildPdfImportRequest(input.filePath, { householdId, accountId });

      let pdfText: string;
      try {
        pdfText = readFileSync(request.filePath, "utf8");
      } catch (fileError) {
        const message =
          fileError instanceof Error ? fileError.message : "Could not read PDF text file.";
        return normalizePdfImportErrors([{ code: "FILE_READ_ERROR", message }]);
      }

      const importJobId = buildRogalandImportJobId(pdfText, {
        householdId: request.householdId,
        accountId: request.accountId,
      });
      const now = new Date().toISOString();

      return runPdfImportWorkflow(
        {
          pdfText,
          filePath: request.filePath,
          householdId: request.householdId,
          accountId: request.accountId,
          importJobId,
          startedAtIso: now,
          finishedAtIso: now,
        },
        {
          parserRegistry: defaultParserAdapterRegistry,
          appendImportJob: localLedgerDatabase.appendImportJob,
          appendTransactions: localLedgerDatabase.appendTransactions,
          onTransactionsPersisted: (transactions) => {
            const existingIds = new Set(liveTransactions.map((transaction) => transaction.id));
            for (const transaction of transactions) {
              if (!existingIds.has(transaction.id)) {
                liveTransactions.push(transaction);
                existingIds.add(transaction.id);
              }
            }
          },
        }
      );
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
