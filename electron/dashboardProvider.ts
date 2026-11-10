import type { DashboardData, DashboardViewContract } from "../src/app/dashboardApi.js";
import type { ReportingPeriodRule } from "../src/shared/applicationPreferences.js";

export type DashboardDataGetter = () => DashboardData;
export type DashboardViewDataGetter = (
  yearMonth: string,
  reportingPeriodRule?: ReportingPeriodRule,
  selectedPeriodStartDateIso?: string
) => DashboardViewContract;

export interface DashboardTestOverrides {
  getData: (getData: DashboardDataGetter) => DashboardData;
  getViewData: (
    yearMonth: string,
    getViewData: DashboardViewDataGetter,
    reportingPeriodRule?: ReportingPeriodRule,
    selectedPeriodStartDateIso?: string
  ) => Promise<DashboardViewContract>;
}

export interface DashboardProvider {
  getData: () => DashboardData;
  getViewData: (
    yearMonth: string,
    reportingPeriodRule?: ReportingPeriodRule,
    selectedPeriodStartDateIso?: string
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
    getViewData: async (yearMonth, reportingPeriodRule, selectedPeriodStartDateIso) =>
      options.testOverrides === undefined
        ? options.getViewData(yearMonth, reportingPeriodRule, selectedPeriodStartDateIso)
        : options.testOverrides.getViewData(
          yearMonth,
          options.getViewData,
          reportingPeriodRule,
          selectedPeriodStartDateIso
        ),
  };
}