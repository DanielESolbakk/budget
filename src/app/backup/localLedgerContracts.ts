import type { BackupSnapshotCatalogEntry, LedgerSnapshotData } from "../../domain/backup/snapshotContract.js";
import type { CsvImportProfile } from "../../domain/import/csvImportProfile.js";
import type { ImportJobHistoryEntry, UndoImportJobResult } from "../../domain/import/importJobHistory.js";
import {
  type SavedLedgerView,
  type TransactionPage,
  type TransactionQuery,
} from "../../domain/ledger/filterTransactions.js";
import type {
  AccountBalanceCheckpoint,
  AccountStatementCoveragePeriod,
  Account,
  CategorizationDecision,
  Household,
  HoldingRecord,
  HoldingRecordRevision,
  HoldingValuationSnapshot,
  ImportJob,
  ImportReviewItem,
  LoanBalanceSnapshot,
  LoanRecord,
  MerchantCorrectionProvenance,
  MerchantCategoryRule,
  MonthlyCategoryTarget,
  ExchangeRate,
  PendingTransactionObservation,
  PropertyRecord,
  PropertyValuationSnapshot,
  RecurringCommitment,
  RecurringCommitmentDecision,
  RecurringCommitmentPaymentLink,
  MonthlyTotal,
  SameMerchantPropagationInput,
  SameMerchantPropagationOperation,
  Transaction,
  TransactionCategoryAllocation,
} from "../../domain/types.js";

export interface LocalLedgerRuntimeMetadata {
  household: Household;
  accounts: Account[];
  monthlyCategoryTargets: MonthlyCategoryTarget[];
  merchantCategoryRules: MerchantCategoryRule[];
}

export interface LocalLedgerDatabase {
  hasHousehold: () => boolean;
  createInitialHouseholdAndAccount: (input: {
    householdName: string;
    accountName: string;
    currencyCode: string;
  }) => { household: Household; account: Account };
  loadRuntimeMetadata: () => LocalLedgerRuntimeMetadata | null;
  listMonthlyTotals: (householdId: string) => MonthlyTotal[];
  getTransactionsForMonth: (householdId: string, yearMonth: string) => Transaction[];
  getTransactionsForAccount: (accountId: string) => Transaction[];
  listPendingTransactionObservations: (householdId: string) => PendingTransactionObservation[];
  getTransactionById: (transactionId: string) => Transaction | undefined;
  updateTransactionCategoryAllocations: (
    transactionId: string,
    allocations: TransactionCategoryAllocation[]
  ) => Transaction;
  saveAccountStatementCoveragePeriod: (period: AccountStatementCoveragePeriod) => void;
  appendAccountBalanceCheckpoint: (checkpoint: AccountBalanceCheckpoint) => void;
  listAccountStatementCoveragePeriods: (accountId: string) => AccountStatementCoveragePeriod[];
  listAccountBalanceCheckpoints: (accountId: string) => AccountBalanceCheckpoint[];
  upsertExchangeRate: (rate: ExchangeRate) => void;
  upsertExchangeRates: (rates: ExchangeRate[]) => void;
  listExchangeRates: (currencyCode?: string) => ExchangeRate[];
  createPropertyRecord: (property: PropertyRecord) => void;
  updatePropertyRecordLabel: (propertyId: string, label: string) => void;
  updatePropertyOwnershipShare: (propertyId: string, basisPoints: number) => void;
  listPropertyRecords: (householdId: string) => PropertyRecord[];
  appendPropertyValuationSnapshot: (valuation: PropertyValuationSnapshot) => void;
  listPropertyValuationSnapshots: (propertyId: string) => PropertyValuationSnapshot[];
  createHoldingRecord: (holding: HoldingRecord) => void;
  correctHoldingRecord: (holding: HoldingRecord, revision: HoldingRecordRevision) => void;
  listHoldingRecords: (householdId: string) => HoldingRecord[];
  appendHoldingValuationSnapshot: (valuation: HoldingValuationSnapshot) => void;
  listHoldingValuationSnapshots: (holdingId: string) => HoldingValuationSnapshot[];
  createLoanRecord: (loan: LoanRecord) => void;
  updateLoanResponsibilityShare: (loanId: string, basisPoints: number) => void;
  listLoanRecords: (householdId: string) => LoanRecord[];
  appendLoanBalanceSnapshot: (balance: LoanBalanceSnapshot) => void;
  listLoanBalanceSnapshots: (loanId: string) => LoanBalanceSnapshot[];
  createRecurringCommitment: (commitment: RecurringCommitment) => void;
  updateRecurringCommitment: (commitment: RecurringCommitment) => void;
  updateRecurringCommitmentAndDecision: (
    commitment: RecurringCommitment,
    decision: RecurringCommitmentDecision
  ) => void;
  listRecurringCommitments: (householdId: string) => RecurringCommitment[];
  createRecurringCommitmentPaymentLink: (link: RecurringCommitmentPaymentLink) => void;
  listRecurringCommitmentPaymentLinks: (householdId: string) => RecurringCommitmentPaymentLink[];
  createRecurringCommitmentDecision: (decision: RecurringCommitmentDecision) => void;
  listRecurringCommitmentDecisions: (householdId: string) => RecurringCommitmentDecision[];
  loadLedgerSnapshotData: () => LedgerSnapshotData;
  replaceLedgerSnapshotData: (snapshot: LedgerSnapshotData) => void;
  saveBackupSnapshot: (entry: BackupSnapshotCatalogEntry) => void;
  listBackupSnapshots: () => BackupSnapshotCatalogEntry[];
  deleteBackupSnapshot: (snapshotPath: string) => boolean;
  queryTransactions: (householdId: string, query: TransactionQuery) => TransactionPage;
  listUncategorizedTransactions: (householdId: string) => Transaction[];
  saveLedgerView: (savedLedgerView: SavedLedgerView) => void;
  listSavedLedgerViews: () => SavedLedgerView[];
  deleteSavedLedgerView: (viewId: string) => boolean;
  saveCsvImportProfile: (profile: CsvImportProfile) => void;
  listCsvImportProfiles: (householdId: string) => CsvImportProfile[];
  deleteCsvImportProfile: (householdId: string, profileId: string) => boolean;
  listImportJobHistory: (householdId: string) => ImportJobHistoryEntry[];
  undoImportJob: (importJobId: string) => UndoImportJobResult;
  getAccountsForHousehold: (householdId: string) => Account[];
  upsertMonthlyCategoryTarget: (target: MonthlyCategoryTarget) => void;
  appendImportJob: (importJob: ImportJob) => void;
  hasImportJob: (importJobId: string) => boolean;
  getTransactionsForImportJob: (importJobId: string) => Transaction[];
  getImportedTransactionsForSource: (sourceType: ImportJob["sourceType"], sourceName: string, accountId: string, sourceIdentity?: string) => Transaction[];
  listImportReviewItems: (householdId: string) => ImportReviewItem[];
  completeImportReviewCorrection: (
    reviewItemId: string,
    transaction: Transaction,
    correctionJson: string,
    correctedAtIso: string
  ) => { item: ImportReviewItem; transaction: Transaction };
  completeImportReviewDismissal: (
    reviewItemId: string,
    reason: string,
    dismissedAtIso: string
  ) => ImportReviewItem;
  appendImportJobAndTransactions: (
    importJob: ImportJob,
    transactions: Transaction[],
    reviewItems?: ImportReviewItem[],
    pendingObservations?: PendingTransactionObservation[]
  ) => number;
  appendTransactions: (transactions: Transaction[]) => number;
  updateTransactionCategory: (transactionId: string, categoryId: string) => void;
  updateTransactionCategoryAndRule: (
    transactionId: string,
    rule: MerchantCategoryRule,
    categorization?: CategorizationDecision
  ) => void;
  listMerchantCorrectionProvenance: () => MerchantCorrectionProvenance[];
  applySameMerchantPropagation: (input: SameMerchantPropagationInput) => SameMerchantPropagationOperation;
  listSameMerchantPropagationOperations: () => SameMerchantPropagationOperation[];
  undoSameMerchantPropagation: (operationId: string) => boolean;
  listMerchantCategoryRules: () => MerchantCategoryRule[];
  upsertMerchantCategoryRule: (rule: MerchantCategoryRule) => void;
  appendManualEntry: (importJob: ImportJob, transaction: Transaction) => void;
  close: () => void;
}
