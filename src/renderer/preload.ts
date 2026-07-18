import { contextBridge, ipcRenderer } from "electron";
import type { DashboardData, DashboardViewContract } from "../app/dashboardApi.js";
import type {
  ForecastEntry,
  MonthlyCategoryTarget,
  MonthlyCategoryTargetInput,
} from "../domain/types.js";

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

export interface BudgetApi {
  dashboard: DashboardApi;
  forecast: ForecastApi;
  categoryTargets: CategoryTargetsApi;
}

const budgetApi: BudgetApi = {
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
};

contextBridge.exposeInMainWorld("budgetApi", budgetApi);
