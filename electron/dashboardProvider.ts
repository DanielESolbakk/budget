import type { DashboardData, DashboardViewContract } from "../src/app/dashboardApi.js";

export type DashboardDataGetter = () => DashboardData;
export type DashboardViewDataGetter = (yearMonth: string) => DashboardViewContract;

export interface DashboardTestOverrides {
  getData: (getData: DashboardDataGetter) => DashboardData;
  getViewData: (
    yearMonth: string,
    getViewData: DashboardViewDataGetter
  ) => Promise<DashboardViewContract>;
}

export interface DashboardProvider {
  getData: () => DashboardData;
  getViewData: (yearMonth: string) => Promise<DashboardViewContract>;
}

export interface DashboardProviderOptions {
  getData: DashboardDataGetter;
  getViewData: DashboardViewDataGetter;
  testOverrides?: DashboardTestOverrides;
}

export function createDashboardProvider(options: DashboardProviderOptions): DashboardProvider {
  return {
    getData: () =>
      options.testOverrides === undefined
        ? options.getData()
        : options.testOverrides.getData(options.getData),
    getViewData: async (yearMonth) =>
      options.testOverrides === undefined
        ? options.getViewData(yearMonth)
        : options.testOverrides.getViewData(yearMonth, options.getViewData),
  };
}