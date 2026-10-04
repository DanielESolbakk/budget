import { contextBridge, ipcRenderer } from "electron";
import type { DashboardData, DashboardViewContract } from "../app/dashboardApi.js";
import type { ExportCsvSummary } from "../app/exportCsv.js";
import type {
  CsvImportPreviewResponse,
  CsvImportResponse,
} from "../app/import/importCsv.js";
import type { ManualEntryResponse } from "../app/import/manualEntry.js";
import type {
  PdfImportPreviewResponse,
  PdfImportResponse,
} from "../app/import/importPdf.js";
import type {
  Account,
  ForecastEntry,
  ManualEntryInput,
  MerchantCorrectionProvenance,
  MonthlyCategoryTarget,
  MonthlyCategoryTargetInput,
  SameMerchantPropagationInput,
  SameMerchantPropagationOperation,
  Transaction,
} from "../domain/types.js";
import type {
  BackupSnapshotCatalogEntry,
  BackupSnapshotFileOutput,
  BackupSnapshotSummary,
  RestoreSnapshotInput,
  RestoreSnapshotResult,
} from "../domain/backup/snapshotContract.js";
import type {
  TransactionPage,
  SavedLedgerView,
  TransactionFilters,
  TransactionQuery,
} from "../domain/ledger/filterTransactions.js";
import type { CsvColumnMapping } from "../domain/import/csvRowMapper.js";
import type { CsvImportProfile } from "../domain/import/csvImportProfile.js";
import type { DuplicateImportDecision } from "../domain/import/filterPreviouslyImportedTransactions.js";
import type { ImportJobHistoryEntry, UndoImportJobResult } from "../domain/import/importJobHistory.js";
import type { ImportPreflightProgress } from "../app/import/importPreflight.js";

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
  getCurrent: () => Promise<{ householdId: string; accounts: Account[] } | null>;
}

export interface SetupApi {
  isRequired: () => Promise<boolean>;
  create: (input: { householdName: string; accountName: string; currencyCode: string }) => Promise<void>;
}

export interface ExportApi {
  writeLedgerCsv: (outputPath: string) => Promise<ExportCsvSummary>;
}

export interface FileDialogApi {
  chooseCsvImportPath: () => Promise<string | null>;
  choosePdfImportPath: () => Promise<string | null>;
  chooseCsvExportPath: () => Promise<string | null>;
  chooseBackupOutputPath: () => Promise<string | null>;
  chooseRestoreSnapshotPath: () => Promise<string | null>;
}

export interface ImportApi {
  cancelPreview: (requestId: string) => Promise<boolean>;
  onPreflightProgress: (listener: (progress: ImportPreflightProgress) => void) => () => void;
  history: {
    list: () => Promise<ImportJobHistoryEntry[]>;
    undo: (importJobId: string) => Promise<UndoImportJobResult>;
  };
  profiles: {
    list: () => Promise<CsvImportProfile[]>;
    save: (input: { id?: string; name: string; accountId: string; columnMapping: CsvColumnMapping }) => Promise<CsvImportProfile>;
    delete: (profileId: string) => Promise<boolean>;
  };
  previewCsv: (input: { filePath: string; requestId?: string; accountId?: string; columnMapping?: CsvColumnMapping }) => Promise<CsvImportPreviewResponse>;
  importCsv: (input: { filePath: string; previewId: string; accountId?: string; columnMapping?: CsvColumnMapping; duplicateDecisions?: DuplicateImportDecision[] }) => Promise<CsvImportResponse>;
  addManualTransaction: (input: ManualEntryInput) => Promise<ManualEntryResponse>;
  previewPdf: (input: { filePath: string; requestId?: string; accountId?: string }) => Promise<PdfImportPreviewResponse>;
  importPdf: (input: { filePath: string; previewId: string; accountId?: string; duplicateDecisions?: DuplicateImportDecision[] }) => Promise<PdfImportResponse>;
}

export interface ReviewApi {
  list: () => Promise<Transaction[]>;
  updateCategory: (input: { transactionId: string; categoryId: string }) => Promise<CategoryUpdateResult>;
  history: {
    corrections: () => Promise<MerchantCorrectionProvenance[]>;
    propagations: () => Promise<SameMerchantPropagationOperation[]>;
  };
  propagation: {
    apply: (input: SameMerchantPropagationInput) => Promise<SameMerchantPropagationOperation>;
    undo: (operationId: string) => Promise<boolean>;
  };
}

export interface CategoryUpdateResult {
  transaction: Transaction;
  futureMatchingChanged: boolean;
}

export interface LedgerApi {
  list: (query: TransactionQuery) => Promise<TransactionPage & { accounts: Account[] }>;
  savedViews: {
    list: () => Promise<SavedLedgerView[]>;
    save: (input: { name: string; filters: TransactionFilters }) => Promise<SavedLedgerView>;
    delete: (viewId: string) => Promise<boolean>;
  };
}

export interface BackupApi {
  create: (outputPath: string) => Promise<BackupSnapshotFileOutput>;
  inspect: (input: RestoreSnapshotInput) => Promise<BackupSnapshotSummary>;
  listSnapshots: () => Promise<BackupSnapshotCatalogEntry[]>;
  restore: (input: RestoreSnapshotInput) => Promise<RestoreSnapshotResult>;
}

export interface BudgetApi {
  dashboard: DashboardApi;
  accounts: AccountsApi;
  setup: SetupApi;
  forecast: ForecastApi;
  categoryTargets: CategoryTargetsApi;
  export: ExportApi;
  import: ImportApi;
  review: ReviewApi;
  ledger: LedgerApi;
  backup: BackupApi;
  dialogs: FileDialogApi;
}

const budgetApi: BudgetApi = {
  setup: {
    isRequired: (): Promise<boolean> => ipcRenderer.invoke("setup:isRequired"),
    create: (input): Promise<void> => ipcRenderer.invoke("setup:create", input),
  },
  accounts: {
    list: (householdId: string): Promise<Account[]> =>
      ipcRenderer.invoke("account:list", householdId),
    getCurrent: (): Promise<{ householdId: string; accounts: Account[] } | null> =>
      ipcRenderer.invoke("account:getCurrent"),
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
    cancelPreview: (requestId: string): Promise<boolean> =>
      ipcRenderer.invoke("import:preflight:cancel", requestId),
    onPreflightProgress: (listener: (progress: ImportPreflightProgress) => void): (() => void) => {
      const handleProgress = (_event: Electron.IpcRendererEvent, progress: ImportPreflightProgress): void => listener(progress);
      ipcRenderer.on("import:preflight:progress", handleProgress);
      return () => ipcRenderer.removeListener("import:preflight:progress", handleProgress);
    },
    history: {
      list: (): Promise<ImportJobHistoryEntry[]> => ipcRenderer.invoke("import:history:list"),
      undo: (importJobId: string): Promise<UndoImportJobResult> =>
        ipcRenderer.invoke("import:history:undo", importJobId),
    },
    profiles: {
      list: (): Promise<CsvImportProfile[]> => ipcRenderer.invoke("import:csvProfiles:list"),
      save: (input: { id?: string; name: string; accountId: string; columnMapping: CsvColumnMapping }): Promise<CsvImportProfile> =>
        ipcRenderer.invoke("import:csvProfiles:save", input),
      delete: (profileId: string): Promise<boolean> =>
        ipcRenderer.invoke("import:csvProfiles:delete", profileId),
    },
    previewCsv: (input: { filePath: string; requestId?: string; accountId?: string; columnMapping?: CsvColumnMapping }): Promise<CsvImportPreviewResponse> =>
      ipcRenderer.invoke("import:csvPreview", input),
    importCsv: (input: { filePath: string; previewId: string; accountId?: string; columnMapping?: CsvColumnMapping; duplicateDecisions?: DuplicateImportDecision[] }): Promise<CsvImportResponse> =>
      ipcRenderer.invoke("import:csv", input),
    addManualTransaction: (input: ManualEntryInput): Promise<ManualEntryResponse> =>
      ipcRenderer.invoke("transaction:addManual", input),
    previewPdf: (input: { filePath: string; requestId?: string; accountId?: string }): Promise<PdfImportPreviewResponse> =>
      ipcRenderer.invoke("import:pdfPreview", input),
    importPdf: (input: { filePath: string; previewId: string; accountId?: string; duplicateDecisions?: DuplicateImportDecision[] }): Promise<PdfImportResponse> =>
      ipcRenderer.invoke("import:pdf", input),
  },
  review: {
    list: (): Promise<Transaction[]> => ipcRenderer.invoke("transaction:listReview"),
    updateCategory: (input: { transactionId: string; categoryId: string }): Promise<CategoryUpdateResult> =>
      ipcRenderer.invoke("transaction:updateCategory", input),
    history: {
      corrections: (): Promise<MerchantCorrectionProvenance[]> =>
        ipcRenderer.invoke("review:correctionHistory:list"),
      propagations: (): Promise<SameMerchantPropagationOperation[]> =>
        ipcRenderer.invoke("review:propagationHistory:list"),
    },
    propagation: {
      apply: (input: SameMerchantPropagationInput): Promise<SameMerchantPropagationOperation> =>
        ipcRenderer.invoke("review:propagation:apply", input),
      undo: (operationId: string): Promise<boolean> =>
        ipcRenderer.invoke("review:propagation:undo", operationId),
    },
  },
  ledger: {
    list: (query: TransactionQuery): Promise<TransactionPage & { accounts: Account[] }> =>
      ipcRenderer.invoke("transaction:list", query),
    savedViews: {
      list: (): Promise<SavedLedgerView[]> => ipcRenderer.invoke("ledgerView:list"),
      save: (input: { name: string; filters: TransactionFilters }): Promise<SavedLedgerView> =>
        ipcRenderer.invoke("ledgerView:save", input),
      delete: (viewId: string): Promise<boolean> => ipcRenderer.invoke("ledgerView:delete", viewId),
    },
  },
  backup: {
    create: (outputPath: string): Promise<BackupSnapshotFileOutput> =>
      ipcRenderer.invoke("backup:create", outputPath),
    inspect: (input: RestoreSnapshotInput): Promise<BackupSnapshotSummary> =>
      ipcRenderer.invoke("backup:inspect", input),
    listSnapshots: (): Promise<BackupSnapshotCatalogEntry[]> =>
      ipcRenderer.invoke("backup:listSnapshots"),
    restore: (input: RestoreSnapshotInput): Promise<RestoreSnapshotResult> =>
      ipcRenderer.invoke("backup:restore", input),
  },
  dialogs: {
    chooseCsvImportPath: (): Promise<string | null> =>
      ipcRenderer.invoke("dialog:chooseCsvImportPath"),
    choosePdfImportPath: (): Promise<string | null> =>
      ipcRenderer.invoke("dialog:choosePdfImportPath"),
    chooseCsvExportPath: (): Promise<string | null> =>
      ipcRenderer.invoke("dialog:chooseCsvExportPath"),
    chooseBackupOutputPath: (): Promise<string | null> =>
      ipcRenderer.invoke("dialog:chooseBackupOutputPath"),
    chooseRestoreSnapshotPath: (): Promise<string | null> =>
      ipcRenderer.invoke("dialog:chooseRestoreSnapshotPath"),
  },
};

contextBridge.exposeInMainWorld("budgetApi", budgetApi);