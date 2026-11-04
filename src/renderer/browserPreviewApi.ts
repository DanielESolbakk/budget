import {
  buildDashboardData,
  buildDashboardViewContract,
  queryMonthlyTotals,
} from "../app/dashboardApi.js";
import { toLocalYearMonth } from "../domain/date/localDateDefaults.js";
import {
  validateMonthlyCategoryTargetInput,
  type Account,
  type MonthlyCategoryTarget,
  type Transaction,
} from "../domain/types.js";
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

function desktopOnlyAction(): never {
  throw new Error(DESKTOP_ONLY_MESSAGE);
}

const unavailablePath = new Proxy(
  () => Promise.reject(new Error(DESKTOP_ONLY_MESSAGE)),
  {
    get: (_target, property, receiver) => property === "then" ? undefined : receiver,
    apply: () => Promise.reject(new Error(DESKTOP_ONLY_MESSAGE)),
  }
);

function withDesktopOnlyFallback<T extends object>(value: T): T {
  return new Proxy(value, {
    get: (target, property, receiver) => {
      if (!Reflect.has(target, property)) return unavailablePath;
      const propertyValue = Reflect.get(target, property, receiver);
      return propertyValue !== null && typeof propertyValue === "object"
        ? withDesktopOnlyFallback(propertyValue)
        : propertyValue;
    },
  });
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
  const dashboardData = buildDashboardData({
    monthlyTotals: previewMonths.map((yearMonth) => ({
      yearMonth,
      totalMinor: queryMonthlyTotals(transactions, yearMonth).netMinor,
    })),
  });
  const targets = new Map<string, MonthlyCategoryTarget>();

  const previewApi = {
    setup: {
      isRequired: async () => false,
      create: async () => desktopOnlyAction(),
    },
    dashboard: {
      getData: async () => dashboardData,
      getViewData: async (yearMonth: string) =>
        buildDashboardViewContract({
          transactions,
          selectedYearMonth: yearMonth,
          accounts: [previewAccount],
          rates: [],
        }),
    },
    accounts: {
      list: async () => [previewAccount],
      getCurrent: async () => ({
        householdId: PREVIEW_HOUSEHOLD_ID,
        accounts: [previewAccount],
      }),
    },
    accountCoverage: {
      listPeriods: async () => [],
      savePeriod: async () => desktopOnlyAction(),
      listCheckpoints: async () => [],
      appendCheckpoint: async () => desktopOnlyAction(),
      getAssessment: async () => desktopOnlyAction(),
    },
    categoryTargets: {
      upsert: async (input) => {
        const target = validateMonthlyCategoryTargetInput(input);
        targets.set(`${target.yearMonth}:${target.categoryId}`, target);
        return target;
      },
      listByMonth: async (yearMonth) =>
        [...targets.values()].filter((target) => target.yearMonth === yearMonth),
    },
    recurringCommitments: {
      getSchedule: async (evaluatedAtIso?: string) => ({
        evaluatedAtIso: evaluatedAtIso ?? new Date().toISOString(),
        commitments: [],
        occurrences: [],
        paymentCandidates: [],
        priceChanges: [],
      }),
        create: async () => desktopOnlyAction(),
        update: async () => desktopOnlyAction(),
        confirm: async () => desktopOnlyAction(),
        pause: async () => desktopOnlyAction(),
        resume: async () => desktopOnlyAction(),
        end: async () => desktopOnlyAction(),
        linkPayment: async () => desktopOnlyAction(),
        confirmPriceChange: async () => desktopOnlyAction(),
    },
  } satisfies Pick<
    BudgetApi,
    | "setup"
    | "dashboard"
    | "accounts"
    | "accountCoverage"
    | "categoryTargets"
    | "recurringCommitments"
  >;

  return {
    api: withDesktopOnlyFallback(previewApi) as unknown as BudgetApi,
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