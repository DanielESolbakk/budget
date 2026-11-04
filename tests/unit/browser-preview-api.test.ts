import { describe, expect, it } from "vitest";
import type { BudgetApi } from "../../src/renderer/preload.js";
import {
  installRendererBudgetApi,
  resolveRendererBudgetApi,
} from "../../src/renderer/browserPreviewApi.js";

describe("renderer budget API resolution", () => {
  it("keeps the Electron API when the preload bridge is available", () => {
    const electronApi = {} as BudgetApi;

    const resolved = resolveRendererBudgetApi(electronApi, "2026-05");

    expect(resolved.api).toBe(electronApi);
    expect(resolved.isBrowserPreview).toBe(false);
  });

  it("does not assign over the Electron contextBridge property", () => {
    const electronApi = {} as BudgetApi;
    const target = Object.defineProperty({}, "budgetApi", {
      value: electronApi,
      writable: false,
    }) as { budgetApi?: BudgetApi };

    expect(() => installRendererBudgetApi(target)).not.toThrow();
    expect(target.budgetApi).toBe(electronApi);
  });

  it("installs the browser preview API when the preload bridge is absent", () => {
    const target: { budgetApi?: BudgetApi } = {};

    expect(installRendererBudgetApi(target, "2026-05")).toBe(true);
    expect(target.budgetApi).toBeDefined();
  });

  it("allows edits to synthetic dashboard data when Electron is unavailable", async () => {
    const resolved = resolveRendererBudgetApi(undefined, "2026-05");

    expect(resolved.isBrowserPreview).toBe(true);
    expect(await resolved.api.setup.isRequired()).toBe(false);

    const dashboardData = await resolved.api.dashboard.getData();
    expect(dashboardData.monthlyTotals.map(({ yearMonth }) => yearMonth)).toEqual([
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
    ]);

    const view = await resolved.api.dashboard.getViewData("2026-05");
    expect(view).toMatchObject({
      state: "ready",
      snapshot: {
        monthlyTotals: {
        yearMonth: "2026-05",
        incomeMinor: 4_250_000,
        expenseMinor: 2_148_000,
        netMinor: 2_102_000,
        },
      },
    });

    const target = await resolved.api.categoryTargets.upsert({
      yearMonth: "2026-05",
      categoryId: "groceries",
      targetMinor: 750_000,
    });
    expect(target).toEqual({
      yearMonth: "2026-05",
      categoryId: "groceries",
      targetMinor: 750_000,
    });
    expect(await resolved.api.categoryTargets.listByMonth("2026-05")).toEqual([target]);
    await expect(resolved.api.dialogs.chooseImportStatementPath()).rejects.toThrow(
      "This action requires the desktop app"
    );
  });
});