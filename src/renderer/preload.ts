import { contextBridge, ipcRenderer } from "electron";
import type { ForecastEntry } from "../domain/types.js";

export interface ForecastApi {
  getEntries: () => Promise<ForecastEntry[]>;
}

export interface BudgetApi {
  forecast: ForecastApi;
}

const budgetApi: BudgetApi = {
  forecast: {
    getEntries: (): Promise<ForecastEntry[]> =>
      ipcRenderer.invoke("forecast:getEntries"),
  },
};

contextBridge.exposeInMainWorld("budgetApi", budgetApi);
