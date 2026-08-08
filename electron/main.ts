import { app, BrowserWindow, ipcMain, session } from "electron";
import { installNetworkGuard } from "./networkGuard.js";
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
import { parseCsvText } from "../src/domain/import/parseCsvText.js";
import { mapCsvRows } from "../src/domain/import/csvRowMapper.js";
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

app.whenReady().then(() => {
  installNetworkGuard(session.defaultSession);

  ipcMain.handle("dashboard:getData", () => {
    return getDashboardData();
  });

  ipcMain.handle("dashboard:getViewData", (_event, yearMonth: string) => {
    return getViewData(yearMonth);
  });

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
    (_event, filePath: string): CsvImportResponse => {
      const { householdId, accountId } = sampleHousehold.id
        ? { householdId: sampleHousehold.id, accountId: sampleAccounts[0]?.id ?? "sample-acc" }
        : { householdId: "sample-hh", accountId: "sample-acc" };

      const request = buildCsvImportRequest(filePath, { householdId, accountId });
      const csvText = readFileSync(request.filePath, "utf8");
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
