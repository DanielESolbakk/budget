import {
  app,
  BrowserWindow,
  ipcMain,
  session,
} from "electron";
import { pathToFileURL } from "node:url";
import { join } from "path";
import { createLocalLedgerDatabase } from "../src/app/backup/localLedgerSqlite.js";
import { createCashflowScenarioService } from "../src/app/cashflowScenarioService.js";
import {
  createMonthlyCategoryTargetStore,
  queryHouseholdDashboardData,
  queryHouseholdDashboardView,
  type DashboardData,
  type DashboardViewContract,
} from "../src/app/dashboardApi.js";
import { createHoldingRegistry } from "../src/app/holdingRegistry.js";
import { ImportPreviewRegistry } from "../src/app/import/importPreviewRegistry.js";
import { LedgerOperationCoordinator } from "../src/app/ledgerOperationCoordinator.js";
import { createLoanRegistry } from "../src/app/loanRegistry.js";
import { createPropertyRegistry } from "../src/app/propertyRegistry.js";
import { createRecurringCommitmentService } from "../src/app/recurringCommitmentService.js";
import { createSpendableCashService } from "../src/app/spendableCashService.js";
import type {
  Account,
  Household,
  MonthlyCategoryTargetInput,
  Transaction,
} from "../src/domain/types.js";
import type { ReportingPeriodRule } from "../src/shared/applicationPreferences.js";
import { createDashboardProvider } from "./dashboardProvider.js";
import {
  createBackupOutputDialog,
  createCsvExportDialog,
  createExchangeRateImportDialog,
  createImportStatementDialog,
  createRestoreSnapshotDialog,
} from "./fileDialogProvider.js";
import { registerDialogsChannels } from "./ipc/dialogsChannels.js";
import { registerImportsChannels } from "./ipc/importsChannels.js";
import { registerRecoveryChannels } from "./ipc/recoveryChannels.js";
import { registerRecurringChannels } from "./ipc/recurringChannels.js";
import { registerRegistriesChannels } from "./ipc/registriesChannels.js";
import { registerReportsChannels } from "./ipc/reportsChannels.js";
import { registerReviewLedgerChannels } from "./ipc/reviewLedgerChannels.js";
import { registerSetupChannels } from "./ipc/setupChannels.js";
import { installNetworkGuard } from "./networkGuard.js";

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
const shouldSeedTestLedger =
  isTestEnvironment && process.env["BUDGET_TEST_LEDGER_SEED"] !== "empty";
const runtimeAccounts: Account[] = [];
const sampleTargetStore = createMonthlyCategoryTargetStore(shouldSeedTestLedger ? sampleTargets : []);

const localLedgerDatabase = createLocalLedgerDatabase({
  ...(shouldSeedTestLedger
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
const propertyRegistry = createPropertyRegistry(localLedgerDatabase);
const holdingRegistry = createHoldingRegistry(localLedgerDatabase);
const loanRegistry = createLoanRegistry(localLedgerDatabase);
const recurringCommitmentService = createRecurringCommitmentService(localLedgerDatabase);
const spendableCashService = createSpendableCashService(localLedgerDatabase);
const cashflowScenarioService = createCashflowScenarioService(localLedgerDatabase);
const learnedCategoryRules = new Map(
  localLedgerDatabase.listMerchantCategoryRules().map((rule) => [rule.merchantAlias, rule.categoryId])
);
const importPreviewRegistry = new ImportPreviewRegistry();
const ledgerOperationCoordinator = new LedgerOperationCoordinator();
let mainWindow: BrowserWindow | undefined;
const runtimeState = { ledgerGeneration: 0 };
const activeImportPreflights = new Map<string, { cancelled: boolean }>();

// Refresh shared objects in place so registered channels observe setup and restore.
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

function assertTrustedRenderer(event: Electron.IpcMainInvokeEvent): void {
  if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) {
    throw new Error("Untrusted renderer sender.");
  }
  const senderUrl = event.senderFrame?.url;
  const packagedRendererUrl = pathToFileURL(join(__dirname, "../renderer/index.html")).href;
  // Fragment navigation stays within the approved renderer document.
  if (senderUrl?.split("#", 1)[0] === packagedRendererUrl) return;

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

function getDashboardData(): DashboardData {
  return queryHouseholdDashboardData(localLedgerDatabase, sampleHousehold.id);
}

function getViewData(
  yearMonth: string,
  reportingPeriodRule?: ReportingPeriodRule,
  selectedPeriodStartDateIso?: string
): DashboardViewContract {
  return queryHouseholdDashboardView(
    localLedgerDatabase,
    sampleHousehold.id,
    yearMonth,
    reportingPeriodRule,
    sampleTargetStore,
    selectedPeriodStartDateIso
  );
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
  const exchangeRateImportDialog = createExchangeRateImportDialog();
  const importStatementDialog = createImportStatementDialog();
  const restoreSnapshotDialog = createRestoreSnapshotDialog();

  registerReportsChannels({
    ipcMain, assertTrustedRenderer, localLedgerDatabase, sampleHousehold, sampleTargetStore,
    spendableCashService, cashflowScenarioService, ledgerOperationCoordinator,
    getDashboardData, dashboardProvider, exchangeRateImportDialog,
  });
  registerDialogsChannels({
    ipcMain, assertTrustedRenderer, backupOutputDialog, csvExportDialog,
    importStatementDialog, restoreSnapshotDialog,
  });
  registerSetupChannels({
    ipcMain, assertTrustedRenderer, localLedgerDatabase, sampleHousehold,
    runtimeState, applyRuntimeLedgerSnapshot,
  });
  registerRecurringChannels({
    ipcMain, assertTrustedRenderer, recurringCommitmentService, ledgerOperationCoordinator,
  });
  registerRegistriesChannels({
    ipcMain, assertTrustedRenderer, propertyRegistry, holdingRegistry,
    loanRegistry, ledgerOperationCoordinator,
  });
  registerImportsChannels({
    ipcMain, assertTrustedRenderer, localLedgerDatabase, sampleHousehold, runtimeState,
    learnedCategoryRules, importPreviewRegistry, ledgerOperationCoordinator,
    activeImportPreflights, resolveDefaultAccountId, accountBelongsToHousehold,
    applyRuntimeLedgerSnapshot,
  });
  registerRecoveryChannels({
    ipcMain, assertTrustedRenderer, localLedgerDatabase, runtimeState, importPreviewRegistry,
    ledgerOperationCoordinator, applyRuntimeLedgerSnapshot, applyRecoveryOperationTestDelay,
  });
  registerReviewLedgerChannels({
    ipcMain, assertTrustedRenderer, localLedgerDatabase, sampleHousehold, runtimeState,
    learnedCategoryRules, ledgerOperationCoordinator, applyTransactionListTestControl,
  });

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