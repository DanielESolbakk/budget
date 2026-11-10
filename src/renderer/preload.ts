import { contextBridge, ipcRenderer } from "electron";
import type {
  DashboardData,
  DashboardViewContract,
  CashflowScenarioRequest,
  CashflowScenarioResult,
  SpendableCashEstimate,
  SpendableCashEstimateRequest,
  NokMonthlyReport,
  NokValuationReport,
} from "../shared/dashboard.js";
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
  HouseholdAccountContext,
  ExchangeRate,
  ForecastEntry,
  HoldingCorrectionInput,
  HoldingRecord,
  HoldingRecordInput,
  HoldingValuationInput,
  HoldingValuationCorrectionInput,
  HoldingValuationSnapshot,
  HoldingWithValuations,
  ImportReviewCorrectionInput,
  ImportReviewItem,
  LoanBalanceInput,
  LoanBalanceSnapshot,
  LoanRecord,
  LoanRecordInput,
  LoanResponsibilityShareUpdateInput,
  LoanWithBalances,
  ManualEntryInput,
  MerchantCorrectionProvenance,
  MonthlyCategoryTarget,
  MonthlyCategoryTargetInput,
  PendingTransactionObservation,
  PropertyLabelUpdateInput,
  PropertyOwnershipShareUpdateInput,
  PropertyRecord,
  PropertyRecordInput,
  PropertyValuationCorrectionInput,
  PropertyValuationInput,
  PropertyValuationSnapshot,
  PropertyWithValuations,
  RecurringCommitment,
  RecurringCommitmentInput,
  RecurringCommitmentPaymentLinkInput,
  RecurringCommitmentSchedule,
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
import type { ReportingPeriodRule } from "../shared/applicationPreferences.js";

export interface DashboardApi {
  getData: () => Promise<DashboardData>;
  getViewData: (
    yearMonth: string,
    reportingPeriodRule?: ReportingPeriodRule
  ) => Promise<DashboardViewContract>;
}

export interface ReportingPreferencesApi {
  getPeriodRule: () => Promise<ReportingPeriodRule>;
  savePeriodRule: (rule: ReportingPeriodRule) => Promise<ReportingPeriodRule>;
}

export interface ForecastApi {
  getEntries: () => Promise<ForecastEntry[]>;
}

export interface SpendableCashApi {
  getEstimate: (input: SpendableCashEstimateRequest) => Promise<SpendableCashEstimate>;
}

export interface CashflowScenariosApi {
  evaluate: (input: CashflowScenarioRequest) => Promise<CashflowScenarioResult>;
}

export interface CategoryTargetsApi {
  upsert: (input: MonthlyCategoryTargetInput) => Promise<MonthlyCategoryTarget>;
  listByMonth: (yearMonth: string) => Promise<MonthlyCategoryTarget[]>;
}

export interface AccountsApi {
  list: (householdId: string) => Promise<Account[]>;
  getCurrent: () => Promise<HouseholdAccountContext | null>;
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
  getValuationReport: (input: {
    valuationDateIso: string;
    monthlyReferenceRateIds?: Record<string, string>;
  }) => Promise<NokValuationReport>;
}

export interface PendingApi {
  list: () => Promise<PendingTransactionObservation[]>;
}

export interface RecurringCommitmentsApi {
  getSchedule: (evaluatedAtIso?: string) => Promise<RecurringCommitmentSchedule>;
  create: (input: RecurringCommitmentInput) => Promise<RecurringCommitment>;
  update: (commitmentId: string, input: RecurringCommitmentInput) => Promise<RecurringCommitment>;
  confirm: (commitmentId: string) => Promise<RecurringCommitment>;
  pause: (commitmentId: string) => Promise<RecurringCommitment>;
  resume: (commitmentId: string) => Promise<RecurringCommitment>;
  end: (commitmentId: string) => Promise<RecurringCommitment>;
  linkPayment: (input: RecurringCommitmentPaymentLinkInput) => Promise<void>;
  confirmPriceChange: (commitmentId: string, newAmountMinor: number) => Promise<RecurringCommitment>;
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
  renameProperty: (input: PropertyLabelUpdateInput) => Promise<PropertyRecord>;
  updateOwnershipShare: (input: PropertyOwnershipShareUpdateInput) => Promise<PropertyRecord>;
  appendValuation: (input: PropertyValuationInput) => Promise<PropertyValuationSnapshot>;
  appendCorrection: (input: PropertyValuationCorrectionInput) => Promise<PropertyValuationSnapshot>;
}

export interface HoldingRegistryApi {
  list: () => Promise<HoldingWithValuations[]>;
  create: (input: HoldingRecordInput) => Promise<HoldingRecord>;
  appendValuation: (input: HoldingValuationInput) => Promise<HoldingValuationSnapshot>;
  correctHolding: (input: HoldingCorrectionInput) => Promise<HoldingRecord>;
  correctValuation: (input: HoldingValuationCorrectionInput) => Promise<HoldingValuationSnapshot>;
}

export interface LoanRegistryApi {
  list: () => Promise<LoanWithBalances[]>;
  create: (input: LoanRecordInput) => Promise<LoanRecord>;
  updateResponsibilityShare: (input: LoanResponsibilityShareUpdateInput) => Promise<LoanRecord>;
  appendBalance: (input: LoanBalanceInput) => Promise<LoanBalanceSnapshot>;
}

export interface BudgetApi {
  dashboard: DashboardApi;
  reportingPreferences: ReportingPreferencesApi;
  accounts: AccountsApi;
  setup: SetupApi;
  forecast: ForecastApi;
  spendableCash: SpendableCashApi;
  cashflowScenarios: CashflowScenariosApi;
  categoryTargets: CategoryTargetsApi;
  export: ExportApi;
  import: ImportApi;
  pending: PendingApi;
  recurringCommitments: RecurringCommitmentsApi;
  review: ReviewApi;
  ledger: LedgerApi;
  accountCoverage: AccountCoverageApi;
  exchangeRates: ExchangeRatesApi;
  propertyRegistry: PropertyRegistryApi;
  holdingRegistry: HoldingRegistryApi;
  loanRegistry: LoanRegistryApi;
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
    getCurrent: (): Promise<HouseholdAccountContext | null> =>
      ipcRenderer.invoke("account:getCurrent"),
  },
  dashboard: {
    getData: (): Promise<DashboardData> => ipcRenderer.invoke("dashboard:getData"),
    getViewData: (
      yearMonth: string,
      reportingPeriodRule?: ReportingPeriodRule
    ): Promise<DashboardViewContract> =>
      ipcRenderer.invoke("dashboard:getViewData", yearMonth, reportingPeriodRule),
  },
  reportingPreferences: {
    getPeriodRule: (): Promise<ReportingPeriodRule> =>
      ipcRenderer.invoke("reportingPreferences:getPeriodRule"),
    savePeriodRule: (rule: ReportingPeriodRule): Promise<ReportingPeriodRule> =>
      ipcRenderer.invoke("reportingPreferences:savePeriodRule", rule),
  },
  forecast: {
    getEntries: (): Promise<ForecastEntry[]> =>
      ipcRenderer.invoke("forecast:getEntries"),
  },
  spendableCash: {
    getEstimate: (input: SpendableCashEstimateRequest): Promise<SpendableCashEstimate> =>
      ipcRenderer.invoke("spendableCash:estimate", input),
  },
  cashflowScenarios: {
    evaluate: (input: CashflowScenarioRequest): Promise<CashflowScenarioResult> =>
      ipcRenderer.invoke("cashflowScenario:evaluate", input),
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
  recurringCommitments: {
    getSchedule: (evaluatedAtIso?: string): Promise<RecurringCommitmentSchedule> =>
      ipcRenderer.invoke("recurringCommitment:schedule", evaluatedAtIso),
    create: (input: RecurringCommitmentInput): Promise<RecurringCommitment> =>
      ipcRenderer.invoke("recurringCommitment:create", input),
    update: (commitmentId: string, input: RecurringCommitmentInput): Promise<RecurringCommitment> =>
      ipcRenderer.invoke("recurringCommitment:update", { commitmentId, input }),
    confirm: (commitmentId: string): Promise<RecurringCommitment> =>
      ipcRenderer.invoke("recurringCommitment:confirm", commitmentId),
    pause: (commitmentId: string): Promise<RecurringCommitment> =>
      ipcRenderer.invoke("recurringCommitment:pause", commitmentId),
    resume: (commitmentId: string): Promise<RecurringCommitment> =>
      ipcRenderer.invoke("recurringCommitment:resume", commitmentId),
    end: (commitmentId: string): Promise<RecurringCommitment> =>
      ipcRenderer.invoke("recurringCommitment:end", commitmentId),
    linkPayment: (input: RecurringCommitmentPaymentLinkInput): Promise<void> =>
      ipcRenderer.invoke("recurringCommitment:linkPayment", input),
    confirmPriceChange: (commitmentId: string, newAmountMinor: number): Promise<RecurringCommitment> =>
      ipcRenderer.invoke("recurringCommitment:confirmPriceChange", { commitmentId, newAmountMinor }),
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
    getValuationReport: (input): Promise<NokValuationReport> =>
      ipcRenderer.invoke("exchangeRate:valuationReport", input),
  },
  propertyRegistry: {
    list: (): Promise<PropertyWithValuations[]> =>
      ipcRenderer.invoke("propertyRegistry:list"),
    create: (input: PropertyRecordInput): Promise<PropertyRecord> =>
      ipcRenderer.invoke("propertyRegistry:create", input),
    renameProperty: (input: PropertyLabelUpdateInput): Promise<PropertyRecord> =>
      ipcRenderer.invoke("propertyRegistry:rename", input),
    updateOwnershipShare: (input: PropertyOwnershipShareUpdateInput): Promise<PropertyRecord> =>
      ipcRenderer.invoke("propertyRegistry:updateOwnershipShare", input),
    appendValuation: (input: PropertyValuationInput): Promise<PropertyValuationSnapshot> =>
      ipcRenderer.invoke("propertyRegistry:appendValuation", input),
    appendCorrection: (input: PropertyValuationCorrectionInput): Promise<PropertyValuationSnapshot> =>
      ipcRenderer.invoke("propertyRegistry:appendCorrection", input),
  },
  holdingRegistry: {
    list: (): Promise<HoldingWithValuations[]> =>
      ipcRenderer.invoke("holdingRegistry:list"),
    create: (input: HoldingRecordInput): Promise<HoldingRecord> =>
      ipcRenderer.invoke("holdingRegistry:create", input),
    appendValuation: (input: HoldingValuationInput): Promise<HoldingValuationSnapshot> =>
      ipcRenderer.invoke("holdingRegistry:appendValuation", input),
    correctHolding: (input: HoldingCorrectionInput): Promise<HoldingRecord> =>
      ipcRenderer.invoke("holdingRegistry:correctHolding", input),
    correctValuation: (input: HoldingValuationCorrectionInput): Promise<HoldingValuationSnapshot> =>
      ipcRenderer.invoke("holdingRegistry:correctValuation", input),
  },
  loanRegistry: {
    list: (): Promise<LoanWithBalances[]> =>
      ipcRenderer.invoke("loanRegistry:list"),
    create: (input: LoanRecordInput): Promise<LoanRecord> =>
      ipcRenderer.invoke("loanRegistry:create", input),
    updateResponsibilityShare: (input: LoanResponsibilityShareUpdateInput): Promise<LoanRecord> =>
      ipcRenderer.invoke("loanRegistry:updateResponsibilityShare", input),
    appendBalance: (input: LoanBalanceInput): Promise<LoanBalanceSnapshot> =>
      ipcRenderer.invoke("loanRegistry:appendBalance", input),
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