import { contextBridge, ipcRenderer } from "electron";
import type { DashboardData, DashboardViewContract } from "../app/dashboardApi.js";
import type { ExportCsvSummary } from "../app/exportCsv.js";
import type { CsvImportResponse } from "../app/import/importCsv.js";
import type { ManualEntryResponse } from "../app/import/manualEntry.js";
import type { PdfImportResponse } from "../app/import/importPdf.js";
import type {
  Account,
  ForecastEntry,
  ManualEntryInput,
  MonthlyCategoryTarget,
  MonthlyCategoryTargetInput,
} from "../domain/types.js";
import type {
  BackupSnapshotFileOutput,
  RestoreSnapshotInput,
  RestoreSnapshotOutput,
} from "../domain/backup/snapshotContract.js";

export interface DashboardApi {
  getData: () => Promise<DashboardData>;
  getViewData: (yearMonth: string) => Promise<DashboardViewContract>;
}

export interface ForecastApi {
  getEntries: () => Promise<ForecastEntry[]>;
}

export interface CategoryTargetsApi {
  upsert: (input: MonthlyCategoryTargetInput) => Promise<MonthlyCategoryTarget>;
  listByMonth: (yearMonth: string) => Promise<MonthlyCategoryTarget[]>;
}

export interface AccountsApi {
  list: (householdId: string) => Promise<Account[]>;
}

export interface ExportApi {
  writeLedgerCsv: (outputPath: string) => Promise<ExportCsvSummary>;
}

export interface FileDialogApi {
  chooseCsvExportPath: () => Promise<string | null>;
  chooseBackupOutputPath: () => Promise<string | null>;
  chooseRestoreSnapshotPath: () => Promise<string | null>;
}

export interface ImportApi {
  importCsv: (input: { filePath: string; accountId?: string }) => Promise<CsvImportResponse>;
  addManualTransaction: (input: ManualEntryInput) => Promise<ManualEntryResponse>;
  importPdf: (input: { filePath: string; accountId?: string }) => Promise<PdfImportResponse>;
}

export interface BackupApi {
  create: (outputPath: string) => Promise<BackupSnapshotFileOutput>;
  restore: (input: RestoreSnapshotInput) => Promise<RestoreSnapshotOutput>;
}

export interface BudgetApi {
  dashboard: DashboardApi;
  accounts: AccountsApi;
  forecast: ForecastApi;
  categoryTargets: CategoryTargetsApi;
  export: ExportApi;
  import: ImportApi;
  backup: BackupApi;
  dialogs: FileDialogApi;
}

const budgetApi: BudgetApi = {
  accounts: {
    list: (householdId: string): Promise<Account[]> =>
      ipcRenderer.invoke("account:list", householdId),
  },
  dashboard: {
    getData: (): Promise<DashboardData> => ipcRenderer.invoke("dashboard:getData"),
    getViewData: (yearMonth: string): Promise<DashboardViewContract> =>
      ipcRenderer.invoke("dashboard:getViewData", yearMonth),
  },
  forecast: {
    getEntries: (): Promise<ForecastEntry[]> =>
      ipcRenderer.invoke("forecast:getEntries"),
  },
  categoryTargets: {
    upsert: (input: MonthlyCategoryTargetInput): Promise<MonthlyCategoryTarget> =>
      ipcRenderer.invoke("categoryTarget:upsert", input),
    listByMonth: (yearMonth: string): Promise<MonthlyCategoryTarget[]> =>
      ipcRenderer.invoke("categoryTarget:listByMonth", yearMonth),
  },
  export: {
    writeLedgerCsv: (outputPath: string): Promise<ExportCsvSummary> =>
      ipcRenderer.invoke("export:writeLedgerCsv", outputPath),
  },
  import: {
    importCsv: (input: { filePath: string; accountId?: string }): Promise<CsvImportResponse> =>
      ipcRenderer.invoke("import:csv", input),
    addManualTransaction: (input: ManualEntryInput): Promise<ManualEntryResponse> =>
      ipcRenderer.invoke("transaction:addManual", input),
    importPdf: (input: { filePath: string; accountId?: string }): Promise<PdfImportResponse> =>
      ipcRenderer.invoke("import:pdf", input),
  },
  backup: {
    create: (outputPath: string): Promise<BackupSnapshotFileOutput> =>
      ipcRenderer.invoke("backup:create", outputPath),
    restore: (input: RestoreSnapshotInput): Promise<RestoreSnapshotOutput> =>
      ipcRenderer.invoke("backup:restore", input),
  },
  dialogs: {
    chooseCsvExportPath: (): Promise<string | null> =>
      ipcRenderer.invoke("dialog:chooseCsvExportPath"),
    chooseBackupOutputPath: (): Promise<string | null> =>
      ipcRenderer.invoke("dialog:chooseBackupOutputPath"),
    chooseRestoreSnapshotPath: (): Promise<string | null> =>
      ipcRenderer.invoke("dialog:chooseRestoreSnapshotPath"),
  },
};

contextBridge.exposeInMainWorld("budgetApi", budgetApi);
