import type { IpcMain } from "electron";
import type { LocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import type { createCashflowScenarioService } from "../../src/app/cashflowScenarioService.js";
import type { DashboardData } from "../../src/app/dashboardApi.js";
import type { createAccountLifecycleService } from "../../src/app/accountLifecycleService.js";
import type { createHoldingRegistry } from "../../src/app/holdingRegistry.js";
import type { ImportPreviewRegistry } from "../../src/app/import/importPreviewRegistry.js";
import type { LedgerOperationCoordinator } from "../../src/app/ledgerOperationCoordinator.js";
import type { createLoanRegistry } from "../../src/app/loanRegistry.js";
import type { createPropertyRegistry } from "../../src/app/propertyRegistry.js";
import type { createRecurringCommitmentService } from "../../src/app/recurringCommitmentService.js";
import type { createSpendableCashService } from "../../src/app/spendableCashService.js";
import type { Account, Household, MonthlyCategoryTargetInput } from "../../src/domain/types.js";
import type { MonthlyCategoryTargetStore } from "../../src/shared/dashboard.js";
import type { createDashboardProvider } from "../dashboardProvider.js";
import type {
  BackupOutputDialog,
  CsvExportDialog,
  ExchangeRateImportDialog,
  ImportStatementDialog,
  RestoreSnapshotDialog,
} from "../fileDialogProvider.js";

export interface LedgerChannelContext {
  ipcMain: Pick<IpcMain, "handle">;
  assertTrustedRenderer: (event: Electron.IpcMainInvokeEvent) => void;
  localLedgerDatabase: LocalLedgerDatabase;
  accountLifecycleService: ReturnType<typeof createAccountLifecycleService>;
  sampleHousehold: Household;
  sampleTargetStore: MonthlyCategoryTargetStore;
  runtimeState: { ledgerGeneration: number };
  propertyRegistry: ReturnType<typeof createPropertyRegistry>;
  holdingRegistry: ReturnType<typeof createHoldingRegistry>;
  loanRegistry: ReturnType<typeof createLoanRegistry>;
  recurringCommitmentService: ReturnType<typeof createRecurringCommitmentService>;
  spendableCashService: ReturnType<typeof createSpendableCashService>;
  cashflowScenarioService: ReturnType<typeof createCashflowScenarioService>;
  learnedCategoryRules: Map<string, string>;
  importPreviewRegistry: ImportPreviewRegistry;
  ledgerOperationCoordinator: LedgerOperationCoordinator;
  activeImportPreflights: Map<string, { cancelled: boolean }>;
  resolveDefaultAccountId: (householdId: string) => string;
  accountBelongsToHousehold: (accountId: string, householdId: string) => boolean;
  applyRuntimeLedgerSnapshot: (snapshot: {
    household: Household;
    accounts: Account[];
    monthlyCategoryTargets: MonthlyCategoryTargetInput[];
    merchantCategoryRules?: Array<{ merchantAlias: string; categoryId: string }>;
  }) => void;
  getDashboardData: () => DashboardData;
  applyTransactionListTestControl: (queryKind: "ledger" | "review") => Promise<void>;
  applyRecoveryOperationTestDelay: () => Promise<void>;
  dashboardProvider: ReturnType<typeof createDashboardProvider>;
  backupOutputDialog: BackupOutputDialog;
  csvExportDialog: CsvExportDialog;
  exchangeRateImportDialog: ExchangeRateImportDialog;
  importStatementDialog: ImportStatementDialog;
  restoreSnapshotDialog: RestoreSnapshotDialog;
}
