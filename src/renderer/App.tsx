import React from "react";
import type { DashboardData } from "../app/dashboardApi.js";
import { ForecastSection } from "./dashboard/ForecastSection.js";
import { loadDashboardData } from "./dashboard/loadDashboardData.js";

type DashboardState =
  | { status: "loading" }
  | { status: "ready"; dashboardData: DashboardData }
  | { status: "error"; message: string };

export function App(): React.JSX.Element {
  const [dashboardState, setDashboardState] = React.useState<DashboardState>({
    status: "loading",
  });

  React.useEffect(() => {
    let isActive = true;

    loadDashboardData(window.budgetApi)
      .then((dashboardData) => {
        if (isActive) {
          setDashboardState({ status: "ready", dashboardData });
        }
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Unknown dashboard loading error.";
        setDashboardState({ status: "error", message });
      });

    return () => {
      isActive = false;
    };
  }, []);

  return (
    <div>
      <h1>Budget Planner</h1>
      <p>Local-first budget planning for your household.</p>
      {dashboardState.status === "loading" ? <p>Loading forecast…</p> : null}
      {dashboardState.status === "error" ? (
        <p role="alert">Unable to load forecast: {dashboardState.message}</p>
      ) : null}
      {dashboardState.status === "ready" ? (
        <ForecastSection dashboardData={dashboardState.dashboardData} />
      ) : null}
    </div>
  );
}
