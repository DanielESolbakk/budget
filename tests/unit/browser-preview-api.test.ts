import { describe, expect, it, vi } from "vitest";
import { getMonthlyAttentionSummary } from "../../src/shared/dashboard.js";
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
    expect(await resolved.api.accounts.getCurrent()).toMatchObject({
      householdName: "Preview Household",
      accounts: [{ currencyCode: "NOK" }],
    });

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
    await expect(resolved.api.accounts.create({
      accountName: "Savings",
      currencyCode: "NOK",
    })).rejects.toThrow("This action requires the desktop app");
    expect(await resolved.api.accounts.getHistorySummary("preview-account")).toEqual({
      transactionCount: 0,
      coveragePeriodCount: 0,
      checkpointCount: 0,
    });
    await expect(resolved.api.accounts.update({
      accountId: "preview-account",
      accountName: "Savings",
      currencyCode: "NOK",
    })).rejects.toThrow("This action requires the desktop app");
  });

  it("uses saved targets in the refreshed comparison and monthly checks", async () => {
    const { api } = resolveRendererBudgetApi(undefined, "2026-05");

    await api.categoryTargets.upsert({
      yearMonth: "2026-05", categoryId: "groceries", targetMinor: 600_000,
    });

    const view = await api.dashboard.getViewData("2026-05");
    expect(view).toMatchObject({
      state: "ready",
      snapshot: {
        targetVsActualCategoryRows: {
          rows: expect.arrayContaining([{
            categoryId: "groceries", targetMinor: 600_000, actualMinor: 620_000, deltaMinor: 20_000,
          }]),
        },
      },
    });
    expect(getMonthlyAttentionSummary(view)?.overTargetCategoryCount).toBe(1);
  });

  it("updates an existing target in the comparison without adding another saved row", async () => {
    const { api } = resolveRendererBudgetApi(undefined, "2026-05");
    await api.categoryTargets.upsert({
      yearMonth: "2026-05", categoryId: "groceries", targetMinor: 600_000,
    });
    await api.categoryTargets.upsert({
      yearMonth: "2026-05", categoryId: "groceries", targetMinor: 750_000,
    });

    expect(await api.categoryTargets.listByMonth("2026-05")).toEqual([{
      yearMonth: "2026-05", categoryId: "groceries", targetMinor: 750_000,
    }]);
    const view = await api.dashboard.getViewData("2026-05");
    expect(view).toMatchObject({
      snapshot: {
        targetVsActualCategoryRows: {
          rows: expect.arrayContaining([{
            categoryId: "groceries", targetMinor: 750_000, actualMinor: 620_000, deltaMinor: -130_000,
          }]),
        },
      },
    });
    expect(getMonthlyAttentionSummary(view)?.overTargetCategoryCount).toBe(0);
  });

  it("keeps target comparisons isolated by month and restores them on returning to a month", async () => {
    const { api } = resolveRendererBudgetApi(undefined, "2026-05");
    await api.categoryTargets.upsert({
      yearMonth: "2026-05", categoryId: "groceries", targetMinor: 0,
    });
    await api.categoryTargets.upsert({
      yearMonth: "2026-04", categoryId: "groceries", targetMinor: 700_000,
    });

    const may = await api.dashboard.getViewData("2026-05");
    const april = await api.dashboard.getViewData("2026-04");
    expect(april).toMatchObject({
      snapshot: {
        targetVsActualCategoryRows: {
          rows: expect.arrayContaining([{
            categoryId: "groceries", targetMinor: 700_000, actualMinor: 628_000, deltaMinor: -72_000,
          }]),
        },
      },
    });
    expect(getMonthlyAttentionSummary(may)?.overTargetCategoryCount).toBe(1);
    expect(getMonthlyAttentionSummary(april)?.overTargetCategoryCount).toBe(0);
    expect(await api.dashboard.getViewData("2026-05")).toEqual(may);
  });

  it("starts a separate preview without targets from another preview instance", async () => {
    const first = resolveRendererBudgetApi(undefined, "2026-05").api;
    await first.categoryTargets.upsert({
      yearMonth: "2026-05", categoryId: "groceries", targetMinor: 600_000,
    });

    const second = resolveRendererBudgetApi(undefined, "2026-05").api;
    expect(await second.categoryTargets.listByMonth("2026-05")).toEqual([]);
    expect(getMonthlyAttentionSummary(await second.dashboard.getViewData("2026-05"))
      ?.overTargetCategoryCount).toBe(0);
  });

  it("does not expose stored targets through save or list result references", async () => {
    const { api } = resolveRendererBudgetApi(undefined, "2026-05");
    const input = { yearMonth: "2026-05", categoryId: "groceries", targetMinor: 750_000 };
    const saved = await api.categoryTargets.upsert(input);
    input.targetMinor = 1;
    saved.targetMinor = 2;
    const listed = await api.categoryTargets.listByMonth("2026-05");
    expect(listed).toEqual([{
      yearMonth: "2026-05", categoryId: "groceries", targetMinor: 750_000,
    }]);
    const first = listed[0];
    if (first === undefined) throw new Error("Expected the saved preview target.");
    first.targetMinor = 3;
    listed.length = 0;
    expect(await api.categoryTargets.listByMonth("2026-05")).toEqual([{
      yearMonth: "2026-05", categoryId: "groceries", targetMinor: 750_000,
    }]);
  });

  it("rejects invalid target writes without changing previously saved targets", async () => {
    const { api } = resolveRendererBudgetApi(undefined, "2026-05");
    await api.categoryTargets.upsert({
      yearMonth: "2026-05", categoryId: "groceries", targetMinor: 750_000,
    });
    await expect(api.categoryTargets.upsert({
      yearMonth: "2026-05", categoryId: "groceries", targetMinor: -1,
    })).rejects.toThrow();
    await expect(api.categoryTargets.upsert({
      yearMonth: "2026-13", categoryId: "groceries", targetMinor: 1,
    })).rejects.toThrow();
    expect(await api.categoryTargets.listByMonth("2026-05")).toEqual([{
      yearMonth: "2026-05", categoryId: "groceries", targetMinor: 750_000,
    }]);
  });

  it("returns synchronous safe cleanup without emitting progress for unsupported imports", async () => {
    const { api } = resolveRendererBudgetApi(undefined, "2026-05");
    const listener = vi.fn();
    const cleanup = api.import.onPreflightProgress(listener);
    await expect(Promise.resolve(cleanup)).resolves.toBeTypeOf("function");
    expect(typeof cleanup).toBe("function");
    expect(() => cleanup()).not.toThrow();
    expect(() => cleanup()).not.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    ["account restoration", (api: BudgetApi) => api.accounts.restore("preview-account")],
    ["file dialog", (api: BudgetApi) => api.dialogs.chooseImportStatementPath()],
    ["import history", (api: BudgetApi) => api.import.history.list()],
    ["CSV profiles", (api: BudgetApi) => api.import.profiles.list()],
    ["import cancellation", (api: BudgetApi) => api.import.cancelPreview("synthetic-request")],
    ["saved ledger views", (api: BudgetApi) => api.ledger.savedViews.list()],
    ["review history", (api: BudgetApi) => api.review.history.corrections()],
    ["backup catalog", (api: BudgetApi) => api.backup.listSnapshots()],
  ] as const)("rejects desktop-only %s instead of returning synthetic success", async (_name, action) => {
    const { api } = resolveRendererBudgetApi(undefined, "2026-05");
    await expect(action(api)).rejects.toThrow("This action requires the desktop app");
  });
});