import { contextBridge, ipcRenderer } from "electron";
import type { DashboardData } from "../app/dashboardApi.js";
import type { ForecastEntry } from "../domain/types.js";

export interface DashboardApi {
  getData: () => Promise<DashboardData>;
}

export interface ForecastApi {
  getEntries: () => Promise<ForecastEntry[]>;
}

export interface BudgetApi {
  dashboard: DashboardApi;
  forecast: ForecastApi;
}

const budgetApi: BudgetApi = {
  dashboard: {
    getData: (): Promise<DashboardData> => ipcRenderer.invoke("dashboard:getData"),
  },
  forecast: {
    getEntries: (): Promise<ForecastEntry[]> =>
      ipcRenderer.invoke("forecast:getEntries"),
  },
};

contextBridge.exposeInMainWorld("budgetApi", budgetApi);
