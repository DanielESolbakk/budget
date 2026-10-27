import { contextBridge, ipcRenderer } from "electron";
import type { DashboardData, DashboardViewContract, NokMonthlyReport } from "../app/dashboardApi.js";
import type { ExportCsvSummary } from "../app/exportCsv.js";
import type {
  CsvImportPreviewResponse,
  CsvImportResponse,
} from "../app/import/importCsv.js";
import type { ManualEntryResponse } from "../app/import/manualEntry.js";
import type {
  ImportReviewCorrectionResult,
  ImportReviewDismissalResult,
} from "../app/reviewService.js";
import type {
  PdfImportPreviewResponse,
  PdfImportResponse,
} from "../app/import/importPdf.js";
import type {
  AccountBalanceCheckpoint,
  AccountCoverageAssessment,
  AccountStatementCoveragePeriod,
  Account,
  ExchangeRate,
  ForecastEntry,
  ImportReviewCorrectionInput,
  ImportReviewItem,
  ManualEntryInput,
  MerchantCorrectionProvenance,
  MonthlyCategoryTarget,
  MonthlyCategoryTargetInput,
  PendingTransactionObservation,
  PropertyRecord,
  PropertyRecordInput,
  PropertyValuationInput,
  PropertyValuationSnapshot,
  PropertyWithValuations,
  SameMerchantPropagationApplyRequest,
  SameMerchantPropagationPreview,
  SameMerchantPropagationPreviewRequest,
  SameMerchantPropagationOperation,
  Transaction,
  TransactionCategoryAllocation,
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
import type { TransactionCategoryAllocationUpdateResult } from "../domain/ledger/transactionAllocations.js";
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
  chooseImportStatementPath: () => Promise<string | null>;
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
  importPdf: (input: { filePath: string; previewId: string; accountId?: string; duplicateDecisions?: DuplicateImportDecision[]; acknowledgeExcludedRows?: boolean }) => Promise<PdfImportResponse>;
  review: {
    list: () => Promise<ImportReviewItem[]>;
    correct: (input: { reviewItemId: string; correction: ImportReviewCorrectionInput }) => Promise<ImportReviewCorrectionResult>;
    dismiss: (input: { reviewItemId: string; reason: string }) => Promise<ImportReviewDismissalResult>;
  };
}

export interface ReviewApi {
  list: () => Promise<Transaction[]>;
  updateCategory: (input: { transactionId: string; categoryId: string }) => Promise<CategoryUpdateResult>;
  history: {
    corrections: () => Promise<MerchantCorrectionProvenance[]>;
    propagations: () => Promise<SameMerchantPropagationOperation[]>;
  };
  propagation: {
    preview: (input: SameMerchantPropagationPreviewRequest) => Promise<SameMerchantPropagationPreview>;
    apply: (input: SameMerchantPropagationApplyRequest) => Promise<SameMerchantPropagationOperation>;
    undo: (operationId: string) => Promise<boolean>;
  };
}

export interface CategoryUpdateResult {
  transaction: Transaction;
  futureMatchingChanged: boolean;
}

export interface LedgerApi {
  list: (query: TransactionQuery) => Promise<TransactionPage & { accounts: Account[] }>;
  updateCategoryAllocations: (
    input: { transactionId: string; allocations: TransactionCategoryAllocation[] }
  ) => Promise<TransactionCategoryAllocationUpdateResult>;
  savedViews: {
    list: () => Promise<SavedLedgerView[]>;
    save: (input: { name: string; filters: TransactionFilters }) => Promise<SavedLedgerView>;
    delete: (viewId: string) => Promise<boolean>;
  };
}

export interface AccountCoverageApi {
  listPeriods: (accountId: string) => Promise<AccountStatementCoveragePeriod[]>;
  savePeriod: (period: AccountStatementCoveragePeriod) => Promise<AccountStatementCoveragePeriod>;
  listCheckpoints: (accountId: string) => Promise<AccountBalanceCheckpoint[]>;
  appendCheckpoint: (checkpoint: AccountBalanceCheckpoint) => Promise<AccountBalanceCheckpoint>;
  getAssessment: (periodId: string, evaluatedAtIso: string) => Promise<AccountCoverageAssessment>;
}

export interface ExchangeRatesApi {
  list: (currencyCode?: string) => Promise<ExchangeRate[]>;
  record: (rate: ExchangeRate) => Promise<ExchangeRate>;
  importFromFile: () => Promise<ExchangeRate[] | null>;
  getMonthlyReport: (input: {
    yearMonth: string;
    monthlyReferenceRateIds?: Record<string, string>;
    useLatestRateScenario?: boolean;
  }) => Promise<NokMonthlyReport>;
}

export interface PendingApi {
  list: () => Promise<PendingTransactionObservation[]>;
}

export interface BackupApi {
  create: (outputPath: string) => Promise<BackupSnapshotFileOutput>;
  inspect: (input: RestoreSnapshotInput) => Promise<BackupSnapshotSummary>;
  listSnapshots: () => Promise<BackupSnapshotCatalogEntry[]>;
  restore: (input: RestoreSnapshotInput) => Promise<RestoreSnapshotResult>;
}

export interface PropertyRegistryApi {
  list: () => Promise<PropertyWithValuations[]>;
  create: (input: PropertyRecordInput) => Promise<PropertyRecord>;
  appendValuation: (input: PropertyValuationInput) => Promise<PropertyValuationSnapshot>;
}

export interface BudgetApi {
  dashboard: DashboardApi;
  accounts: AccountsApi;
  setup: SetupApi;
  forecast: ForecastApi;
  categoryTargets: CategoryTargetsApi;
  export: ExportApi;
  import: ImportApi;
  pending: PendingApi;
  review: ReviewApi;
  ledger: LedgerApi;
  accountCoverage: AccountCoverageApi;
  exchangeRates: ExchangeRatesApi;
  propertyRegistry: PropertyRegistryApi;
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
    importPdf: (input: { filePath: string; previewId: string; accountId?: string; duplicateDecisions?: DuplicateImportDecision[]; acknowledgeExcludedRows?: boolean }): Promise<PdfImportResponse> =>
      ipcRenderer.invoke("import:pdf", input),
    review: {
      list: (): Promise<ImportReviewItem[]> => ipcRenderer.invoke("importReview:list"),
      correct: (input: { reviewItemId: string; correction: ImportReviewCorrectionInput }): Promise<ImportReviewCorrectionResult> =>
        ipcRenderer.invoke("importReview:correct", input),
      dismiss: (input: { reviewItemId: string; reason: string }): Promise<ImportReviewDismissalResult> =>
        ipcRenderer.invoke("importReview:dismiss", input),
    },
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
      preview: (input: SameMerchantPropagationPreviewRequest): Promise<SameMerchantPropagationPreview> =>
        ipcRenderer.invoke("review:propagation:preview", input),
      apply: (input: SameMerchantPropagationApplyRequest): Promise<SameMerchantPropagationOperation> =>
        ipcRenderer.invoke("review:propagation:apply", input),
      undo: (operationId: string): Promise<boolean> =>
        ipcRenderer.invoke("review:propagation:undo", operationId),
    },
  },
  ledger: {
    list: (query: TransactionQuery): Promise<TransactionPage & { accounts: Account[] }> =>
      ipcRenderer.invoke("transaction:list", query),
    updateCategoryAllocations: (
      input: { transactionId: string; allocations: TransactionCategoryAllocation[] }
    ): Promise<TransactionCategoryAllocationUpdateResult> =>
      ipcRenderer.invoke("transaction:updateCategoryAllocations", input),
    savedViews: {
      list: (): Promise<SavedLedgerView[]> => ipcRenderer.invoke("ledgerView:list"),
      save: (input: { name: string; filters: TransactionFilters }): Promise<SavedLedgerView> =>
        ipcRenderer.invoke("ledgerView:save", input),
      delete: (viewId: string): Promise<boolean> => ipcRenderer.invoke("ledgerView:delete", viewId),
    },
  },
  pending: {
    list: (): Promise<PendingTransactionObservation[]> =>
      ipcRenderer.invoke("pending:list"),
  },
  accountCoverage: {
    listPeriods: (accountId: string): Promise<AccountStatementCoveragePeriod[]> =>
      ipcRenderer.invoke("accountCoverage:periods:list", accountId),
    savePeriod: (period: AccountStatementCoveragePeriod): Promise<AccountStatementCoveragePeriod> =>
      ipcRenderer.invoke("accountCoverage:period:save", period),
    listCheckpoints: (accountId: string): Promise<AccountBalanceCheckpoint[]> =>
      ipcRenderer.invoke("accountCoverage:checkpoints:list", accountId),
    appendCheckpoint: (checkpoint: AccountBalanceCheckpoint): Promise<AccountBalanceCheckpoint> =>
      ipcRenderer.invoke("accountCoverage:checkpoint:append", checkpoint),
    getAssessment: (periodId: string, evaluatedAtIso: string): Promise<AccountCoverageAssessment> =>
      ipcRenderer.invoke("accountCoverage:assessment:get", { periodId, evaluatedAtIso }),
  },
  exchangeRates: {
    list: (currencyCode?: string): Promise<ExchangeRate[]> =>
      ipcRenderer.invoke("exchangeRate:list", currencyCode),
    record: (rate: ExchangeRate): Promise<ExchangeRate> =>
      ipcRenderer.invoke("exchangeRate:record", rate),
    importFromFile: (): Promise<ExchangeRate[] | null> =>
      ipcRenderer.invoke("exchangeRate:importFromFile"),
    getMonthlyReport: (input): Promise<NokMonthlyReport> =>
      ipcRenderer.invoke("exchangeRate:monthlyReport", input),
  },
  propertyRegistry: {
    list: (): Promise<PropertyWithValuations[]> =>
      ipcRenderer.invoke("propertyRegistry:list"),
    create: (input: PropertyRecordInput): Promise<PropertyRecord> =>
      ipcRenderer.invoke("propertyRegistry:create", input),
    appendValuation: (input: PropertyValuationInput): Promise<PropertyValuationSnapshot> =>
      ipcRenderer.invoke("propertyRegistry:appendValuation", input),
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
    chooseImportStatementPath: (): Promise<string | null> =>
      ipcRenderer.invoke("dialog:chooseImportStatementPath"),
    chooseCsvExportPath: (): Promise<string | null> =>
      ipcRenderer.invoke("dialog:chooseCsvExportPath"),
    chooseBackupOutputPath: (): Promise<string | null> =>
      ipcRenderer.invoke("dialog:chooseBackupOutputPath"),
    chooseRestoreSnapshotPath: (): Promise<string | null> =>
      ipcRenderer.invoke("dialog:chooseRestoreSnapshotPath"),
  },
};

contextBridge.exposeInMainWorld("budgetApi", budgetApi);