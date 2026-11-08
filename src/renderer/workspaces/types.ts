import type { DashboardData, DashboardViewContract } from "../../shared/dashboard.js";

export type ReviewState =
  | { status: "loading" }
  | {
      status: "ready";
      dashboardData: DashboardData;
      viewContract: DashboardViewContract;
      selectedYearMonth: string;
      availableMonths: string[];
    }
  | { status: "error"; message: string };