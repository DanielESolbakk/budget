import {
  buildDashboardData,
  buildDashboardViewContract,
  createMonthlyCategoryTarget,
  createMonthlyCategoryTargetStore,
  queryMonthlyTotals,
  readMonthlyCategoryTarget,
  reloadMonthlyCategoryTargets,
  updateMonthlyCategoryTarget,
} from "../shared/dashboard.js";
import {
  DEFAULT_REPORTING_PERIOD_RULE,
  validateReportingPeriodRule,
  type ReportingPeriodRule,
} from "../shared/applicationPreferences.js";
import { toLocalYearMonth } from "../domain/date/localDateDefaults.js";
import type { Account, Transaction } from "../domain/types.js";
import type { BudgetApi } from "./preload.js";

const PREVIEW_HOUSEHOLD_ID = "browser-preview-household";
const PREVIEW_ACCOUNT_ID = "browser-preview-account";
const DESKTOP_ONLY_MESSAGE = "This action requires the desktop app.";

function monthAtOffset(yearMonth: string, offset: number): string {
  const year = Number(yearMonth.slice(0, 4));
  const month = Number(yearMonth.slice(5, 7));
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function createPreviewTransactions(yearMonths: string[]): Transaction[] {
  return yearMonths.flatMap((yearMonth, monthIndex) => {
    const groceriesMinor = 620_000 + (yearMonths.length - monthIndex - 1) * 8_000;
    const bookedAtIso = `${yearMonth}-05T12:00:00.000Z`;
    const transaction = (
      id: string,
      merchantRaw: string,
      amountMinor: number,
      categoryId: string
    ): Transaction => ({
      id: `preview-${yearMonth}-${id}`,
      householdId: PREVIEW_HOUSEHOLD_ID,
      accountId: PREVIEW_ACCOUNT_ID,
      bookedAtIso,
      amountMinor,
      merchantRaw,
      currencyCode: "NOK",
      categoryId,
      sourceType: "manual",
    });

    return [
      transaction("income", "Sample employer", 4_250_000, "salary"),
      transaction("housing", "Sample rent", -1_450_000, "housing"),
      transaction("groceries", "Sample grocery shop", -groceriesMinor, "groceries"),
      transaction("transit", "Sample transit card", -78_000, "transport"),
    ];
  });
}

async function desktopOnlyAction(): Promise<never> {
  throw new Error(DESKTOP_ONLY_MESSAGE);
}

export interface RendererBudgetApiResolution {
  api: BudgetApi;
  isBrowserPreview: boolean;
}

export interface RendererBudgetApiTarget {
  budgetApi?: BudgetApi;
}

export function resolveRendererBudgetApi(
  electronApi: BudgetApi | undefined,
  selectedYearMonth = toLocalYearMonth(new Date())
): RendererBudgetApiResolution {
  if (electronApi !== undefined) {
    return { api: electronApi, isBrowserPreview: false };
  }

  const previewAccount: Account = {
    id: PREVIEW_ACCOUNT_ID,
    householdId: PREVIEW_HOUSEHOLD_ID,
    name: "Everyday account",
    currencyCode: "NOK",
  };
  const previewMonths = [-3, -2, -1, 0].map((offset) => monthAtOffset(selectedYearMonth, offset));
  const transactions = createPreviewTransactions(previewMonths);
  let reportingPeriodRule: ReportingPeriodRule = { ...DEFAULT_REPORTING_PERIOD_RULE };
  const dashboardData = buildDashboardData({
    monthlyTotals: previewMonths.map((yearMonth) => ({
      yearMonth,
      totalMinor: queryMonthlyTotals(transactions, yearMonth).netMinor,
    })),
  });
  const targets = createMonthlyCategoryTargetStore();

  const previewApi = {
    setup: {
      isRequired: async () => false,
      create: desktopOnlyAction,
    },
    dashboard: {
      getData: async () => dashboardData,
      getViewData: async (yearMonth: string, requestedRule?: ReportingPeriodRule) =>
        buildDashboardViewContract({
          transactions,
          selectedYearMonth: yearMonth,
          reportingPeriodRule: requestedRule ?? reportingPeriodRule,
          monthlyCategoryTargetStore: targets,
          accounts: [previewAccount],
          rates: [],
        }),
    },
    reportingPreferences: {
      getPeriodRule: async () => ({ ...reportingPeriodRule }),
      savePeriodRule: async (rule: ReportingPeriodRule) => {
        reportingPeriodRule = validateReportingPeriodRule(rule);
        return { ...reportingPeriodRule };
      },
    },
    accounts: {
      list: async () => [previewAccount],
      getCurrent: async () => ({
        householdId: PREVIEW_HOUSEHOLD_ID,
        householdName: "Preview Household",
        accounts: [previewAccount],
      }),
    },
    forecast: {
      getEntries: desktopOnlyAction,
    },
    spendableCash: {
      getEstimate: desktopOnlyAction,
    },
    cashflowScenarios: {
      evaluate: desktopOnlyAction,
    },
    accountCoverage: {
      listPeriods: async () => [],
      savePeriod: desktopOnlyAction,
      listCheckpoints: async () => [],
      appendCheckpoint: desktopOnlyAction,
      getAssessment: desktopOnlyAction,
    },
    categoryTargets: {
      upsert: async (input) => readMonthlyCategoryTarget(targets, input) === null
        ? createMonthlyCategoryTarget(targets, input)
        : updateMonthlyCategoryTarget(targets, input),
      listByMonth: async (yearMonth) => reloadMonthlyCategoryTargets(targets, yearMonth),
    },
    export: {
      writeLedgerCsv: desktopOnlyAction,
    },
    import: {
      cancelPreview: desktopOnlyAction,
      // Imports never start in the preview, so there is no progress source to retain.
      onPreflightProgress: () => () => {},
      history: {
        list: desktopOnlyAction,
        undo: desktopOnlyAction,
      },
      profiles: {
        list: desktopOnlyAction,
        save: desktopOnlyAction,
        delete: desktopOnlyAction,
      },
      previewCsv: desktopOnlyAction,
      importCsv: desktopOnlyAction,
      addManualTransaction: desktopOnlyAction,
      previewPdf: desktopOnlyAction,
      importPdf: desktopOnlyAction,
      review: {
        list: desktopOnlyAction,
        correct: desktopOnlyAction,
        dismiss: desktopOnlyAction,
      },
    },
    pending: {
      list: desktopOnlyAction,
    },
    recurringCommitments: {
      getSchedule: async (evaluatedAtIso?: string) => ({
        evaluatedAtIso: evaluatedAtIso ?? new Date().toISOString(),
        commitments: [],
        occurrences: [],
        paymentCandidates: [],
        priceChanges: [],
      }),
      create: desktopOnlyAction,
      update: desktopOnlyAction,
      confirm: desktopOnlyAction,
      pause: desktopOnlyAction,
      resume: desktopOnlyAction,
      end: desktopOnlyAction,
      linkPayment: desktopOnlyAction,
      confirmPriceChange: desktopOnlyAction,
    },
    review: {
      list: desktopOnlyAction,
      updateCategory: desktopOnlyAction,
      history: {
        corrections: desktopOnlyAction,
        propagations: desktopOnlyAction,
      },
      propagation: {
        preview: desktopOnlyAction,
        apply: desktopOnlyAction,
        undo: desktopOnlyAction,
      },
    },
    ledger: {
      list: desktopOnlyAction,
      updateCategoryAllocations: desktopOnlyAction,
      savedViews: {
        list: desktopOnlyAction,
        save: desktopOnlyAction,
        delete: desktopOnlyAction,
      },
    },
    exchangeRates: {
      list: desktopOnlyAction,
      record: desktopOnlyAction,
      importFromFile: desktopOnlyAction,
      getMonthlyReport: desktopOnlyAction,
      getValuationReport: desktopOnlyAction,
    },
    propertyRegistry: {
      list: desktopOnlyAction,
      create: desktopOnlyAction,
      renameProperty: desktopOnlyAction,
      updateOwnershipShare: desktopOnlyAction,
      appendValuation: desktopOnlyAction,
      appendCorrection: desktopOnlyAction,
    },
    holdingRegistry: {
      list: desktopOnlyAction,
      create: desktopOnlyAction,
      appendValuation: desktopOnlyAction,
      correctHolding: desktopOnlyAction,
      correctValuation: desktopOnlyAction,
    },
    loanRegistry: {
      list: desktopOnlyAction,
      create: desktopOnlyAction,
      updateResponsibilityShare: desktopOnlyAction,
      appendBalance: desktopOnlyAction,
    },
    backup: {
      create: desktopOnlyAction,
      inspect: desktopOnlyAction,
      listSnapshots: desktopOnlyAction,
      restore: desktopOnlyAction,
    },
    dialogs: {
      chooseImportStatementPath: desktopOnlyAction,
      chooseCsvExportPath: desktopOnlyAction,
      chooseBackupOutputPath: desktopOnlyAction,
      chooseRestoreSnapshotPath: desktopOnlyAction,
    },
  } satisfies BudgetApi;

  return {
    api: previewApi,
    isBrowserPreview: true,
  };
}

export function installRendererBudgetApi(
  target: RendererBudgetApiTarget,
  selectedYearMonth?: string
): boolean {
  const resolution = resolveRendererBudgetApi(target.budgetApi, selectedYearMonth);
  if (resolution.isBrowserPreview) {
    target.budgetApi = resolution.api;
  }
  return resolution.isBrowserPreview;
}