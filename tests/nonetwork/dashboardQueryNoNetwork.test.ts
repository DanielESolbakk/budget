import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMonthlyCategoryTarget,
  createMonthlyCategoryTargetStore,
  queryCategoryBreakdown,
  queryHouseholdDashboardView,
  queryMonthlyTotals,
  queryTargetVsActualCategoryRows,
  readMonthlyCategoryTarget,
  reloadMonthlyCategoryTargets,
  updateMonthlyCategoryTarget,
} from "../../src/app/dashboardApi.js";
import { createBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";
import type { Transaction } from "../../src/domain/types.js";

const sampleTransactions: Transaction[] = [
  {
    id: "t1",
    householdId: "hh-1",
    accountId: "acc-1",
    bookedAtIso: "2026-05-10T10:00:00Z",
    amountMinor: 40000,
    merchantRaw: "Lønn AS",
    categoryId: "salary",
  },
  {
    id: "t2",
    householdId: "hh-1",
    accountId: "acc-1",
    bookedAtIso: "2026-05-15T12:00:00Z",
    amountMinor: -12000,
    merchantRaw: "Rema 1000",
  },
];

describe("dashboard query layer no-network verification", () => {
  const originalFetch = (globalThis as unknown as { fetch?: unknown }).fetch;

  afterEach(() => {
    (globalThis as unknown as { fetch?: unknown }).fetch = originalFetch;
  });

  it("queryMonthlyTotals does not invoke fetch", () => {
    let fetchCalled = false;
    (globalThis as unknown as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };

    const result = queryMonthlyTotals(sampleTransactions, "2026-05");
    expect(result.incomeMinor).toBe(40000);
    expect(result.expenseMinor).toBe(12000);
    expect(fetchCalled).toBe(false);
  });

  it("queryCategoryBreakdown does not invoke fetch", () => {
    let fetchCalled = false;
    (globalThis as unknown as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };

    const result = queryCategoryBreakdown(sampleTransactions, "2026-05");
    expect(result.entries.length).toBeGreaterThan(0);
    expect(fetchCalled).toBe(false);
  });

  it("reporting preference save, query, and backup restore stay local-only", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-reporting-no-network-"));
    const dbPath = join(directory, "ledger.sqlite");
    const snapshotPath = join(directory, "snapshot.json");
    let fetchCalled = false;
    (globalThis as unknown as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };
    let ledger: ReturnType<typeof createLocalLedgerDatabase> | undefined;

    try {
      ledger = createLocalLedgerDatabase({ dbPath });
      const { household } = ledger.createInitialHouseholdAndAccount({
        householdName: "Synthetic household",
        accountName: "Everyday",
        currencyCode: "NOK",
      });
      const rule = {
        type: "two-fixed-days",
        firstDayOfMonth: 15,
        secondDayOfMonth: 31,
      } as const;
      ledger.saveReportingPeriodRule(household.id, rule);
      expect(ledger.getReportingPeriodRule(household.id)).toEqual(rule);

      const view = queryHouseholdDashboardView(
        ledger,
        household.id,
        "2026-02",
        undefined,
        undefined,
        "2026-02-28"
      );
      expect(view).toMatchObject({
        state: "empty",
        snapshot: {
          reportingPeriodRange: {
            startDateIso: "2026-02-28",
            endDateExclusiveIso: "2026-03-15",
          },
        },
      });

      createBackupSnapshot({
        ...ledger.loadLedgerSnapshotData(),
        createdAtIso: "2026-06-01T12:00:00Z",
        outputPath: snapshotPath,
      });
      expect(restoreBackupSnapshot({ snapshotPath }).reportingPeriodRule).toEqual(rule);
      expect(fetchCalled).toBe(false);
    } finally {
      ledger?.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("target persistence operations do not invoke fetch", () => {
    let fetchCalled = false;
    (globalThis as unknown as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };

    const store = createMonthlyCategoryTargetStore();
    createMonthlyCategoryTarget(store, {
      yearMonth: "2026-05",
      categoryId: "groceries",
      targetMinor: 10000,
    });
    updateMonthlyCategoryTarget(store, {
      yearMonth: "2026-05",
      categoryId: "groceries",
      targetMinor: 12000,
    });

    const target = readMonthlyCategoryTarget(store, {
      yearMonth: "2026-05",
      categoryId: "groceries",
    });
    const reloaded = reloadMonthlyCategoryTargets(store, "2026-05");

    expect(target?.targetMinor).toBe(12000);
    expect(reloaded).toHaveLength(1);
    expect(fetchCalled).toBe(false);
  });

  it("target-vs-actual composition does not invoke fetch", () => {
    let fetchCalled = false;
    (globalThis as unknown as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };

    const store = createMonthlyCategoryTargetStore([
      { yearMonth: "2026-05", categoryId: "salary", targetMinor: 35000 },
      { yearMonth: "2026-05", categoryId: "groceries", targetMinor: 15000 },
    ]);

    const result = queryTargetVsActualCategoryRows(sampleTransactions, store, "2026-05");
    expect(result.rows.length).toBeGreaterThan(0);
    expect(fetchCalled).toBe(false);
  });

  it("guard detects network access if fetch is invoked during target workflows (regression guard)", () => {
    let fetchCalled = false;
    (globalThis as unknown as { fetch?: () => unknown }).fetch = () => {
      fetchCalled = true;
      throw new Error("Network access is not allowed in this test.");
    };

    // Verify the spy mechanism itself: any code path that calls fetch will be caught.
    const triggerFetch = (): void => {
      (globalThis as unknown as { fetch: () => unknown }).fetch();
    };

    expect(triggerFetch).toThrow("Network access is not allowed in this test.");
    expect(fetchCalled).toBe(true);
  });
});
