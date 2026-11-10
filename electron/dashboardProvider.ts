import type { DashboardData, DashboardViewContract } from "../src/app/dashboardApi.js";
import type { ReportingPeriodRule } from "../src/shared/applicationPreferences.js";

export type DashboardDataGetter = () => DashboardData;
export type DashboardViewDataGetter = (
  yearMonth: string,
  reportingPeriodRule?: ReportingPeriodRule
) => DashboardViewContract;

export interface DashboardTestOverrides {
  getData: (getData: DashboardDataGetter) => DashboardData;
  getViewData: (
    yearMonth: string,
    getViewData: DashboardViewDataGetter,
    reportingPeriodRule?: ReportingPeriodRule
  ) => Promise<DashboardViewContract>;
}

export interface DashboardProvider {
  getData: () => DashboardData;
  getViewData: (
    yearMonth: string,
    reportingPeriodRule?: ReportingPeriodRule
  ) => Promise<DashboardViewContract>;
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
    getViewData: async (yearMonth, reportingPeriodRule) =>
      options.testOverrides === undefined
        ? options.getViewData(yearMonth, reportingPeriodRule)
        : options.testOverrides.getViewData(yearMonth, options.getViewData, reportingPeriodRule),
  };
}