import { contextBridge, ipcRenderer } from "electron";
import type { DashboardData, DashboardViewContract } from "../app/dashboardApi.js";
import type { ExportCsvOutput } from "../app/exportCsv.js";
import type {
  ForecastEntry,
  MonthlyCategoryTarget,
  MonthlyCategoryTargetInput,
  Transaction,
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

export interface ExportApi {
  toCsv: (transactions: Transaction[]) => Promise<ExportCsvOutput>;
}

export interface BudgetApi {
  dashboard: DashboardApi;
  forecast: ForecastApi;
  categoryTargets: CategoryTargetsApi;
  export: ExportApi;
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
  export: {
    toCsv: (transactions: Transaction[]): Promise<ExportCsvOutput> =>
      ipcRenderer.invoke("export:toCsv", transactions),
  },
};

contextBridge.exposeInMainWorld("budgetApi", budgetApi);
