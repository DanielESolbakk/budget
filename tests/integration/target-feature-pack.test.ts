import { describe, expect, it } from "vitest";
import {
  createMonthlyCategoryTarget,
  createMonthlyCategoryTargetStore,
  queryTargetVsActualCategoryRows,
  readMonthlyCategoryTarget,
  reloadMonthlyCategoryTargets,
  updateMonthlyCategoryTarget,
} from "../../src/app/dashboardApi.js";
import { MonthlyCategoryTargetValidationError, type Transaction } from "../../src/domain/types.js";

function makeTx(
  overrides: Partial<Transaction> & { amountMinor: number; bookedAtIso: string }
): Transaction {
  return {
    id: crypto.randomUUID(),
    householdId: "hh-1",
    accountId: "acc-1",
    merchantRaw: "Test Merchant",
    ...overrides,
  };
}

describe("monthly category target persistence", () => {
  it("supports deterministic create, read, update, and reload behavior", () => {
    const store = createMonthlyCategoryTargetStore();

    createMonthlyCategoryTarget(store, {
      yearMonth: "2026-05",
      categoryId: "transport",
      targetMinor: 5000,
    });
    createMonthlyCategoryTarget(store, {
      yearMonth: "2026-05",
      categoryId: "groceries",
      targetMinor: 12000,
    });

    const readBeforeUpdate = readMonthlyCategoryTarget(store, {
      yearMonth: "2026-05",
      categoryId: "groceries",
    });
    expect(readBeforeUpdate).toEqual({
      yearMonth: "2026-05",
      categoryId: "groceries",
      targetMinor: 12000,
    });

    updateMonthlyCategoryTarget(store, {
      yearMonth: "2026-05",
      categoryId: "groceries",
      targetMinor: 15000,
    });

    const readAfterUpdate = readMonthlyCategoryTarget(store, {
      yearMonth: "2026-05",
      categoryId: "groceries",
    });
    expect(readAfterUpdate).toEqual({
      yearMonth: "2026-05",
      categoryId: "groceries",
      targetMinor: 15000,
    });

    const firstReload = reloadMonthlyCategoryTargets(store, "2026-05");
    const secondReload = reloadMonthlyCategoryTargets(store, "2026-05");

    expect(firstReload).toEqual([
      {
        yearMonth: "2026-05",
        categoryId: "groceries",
        targetMinor: 15000,
      },
      {
        yearMonth: "2026-05",
        categoryId: "transport",
        targetMinor: 5000,
      },
    ]);
    expect(secondReload).toEqual(firstReload);
  });

  it("rejects duplicate create and missing-update operations", () => {
    const store = createMonthlyCategoryTargetStore();

    createMonthlyCategoryTarget(store, {
      yearMonth: "2026-05",
      categoryId: "groceries",
      targetMinor: 10000,
    });

    expect(() =>
      createMonthlyCategoryTarget(store, {
        yearMonth: "2026-05",
        categoryId: "groceries",
        targetMinor: 11000,
      })
    ).toThrow(/already exists/);

    expect(() =>
      updateMonthlyCategoryTarget(store, {
        yearMonth: "2026-05",
        categoryId: "dining",
        targetMinor: 6000,
      })
    ).toThrow(/missing/);
  });

  it("rejects invalid payloads with a stable validation error contract", () => {
    const store = createMonthlyCategoryTargetStore();

    expect(() =>
      createMonthlyCategoryTarget(store, {
        yearMonth: "2026-13",
        categoryId: "groceries",
        targetMinor: 10000,
      })
    ).toThrowError(
      expect.objectContaining<Partial<MonthlyCategoryTargetValidationError>>({
        name: "MonthlyCategoryTargetValidationError",
        code: "INVALID_TARGET_YEAR_MONTH",
        message: "Invalid target yearMonth: 2026-13",
      })
    );

    expect(() =>
      updateMonthlyCategoryTarget(store, {
        yearMonth: "2026-05",
        categoryId: " ",
        targetMinor: 10000,
      })
    ).toThrowError(
      expect.objectContaining<Partial<MonthlyCategoryTargetValidationError>>({
        name: "MonthlyCategoryTargetValidationError",
        code: "INVALID_TARGET_CATEGORY_ID",
        message: "Target categoryId must be a non-empty string.",
      })
    );

    expect(() =>
      createMonthlyCategoryTarget(store, {
        yearMonth: "2026-05",
        categoryId: "transport",
        targetMinor: 1.5,
      })
    ).toThrowError(
      expect.objectContaining<Partial<MonthlyCategoryTargetValidationError>>({
        name: "MonthlyCategoryTargetValidationError",
        code: "INVALID_TARGET_MINOR_INTEGER",
        message: "Target targetMinor must be an integer: 1.5",
      })
    );
  });
});

describe("target-vs-actual contract composition", () => {
  // queryCategoryBreakdown converts amountMinor values to absolute totals per category.
  const mayTransactions: Transaction[] = [
    makeTx({ id: "g1", bookedAtIso: "2026-05-02T09:00:00Z", amountMinor: -8000, categoryId: "groceries" }),
    makeTx({ id: "g2", bookedAtIso: "2026-05-10T09:00:00Z", amountMinor: -4000, categoryId: "groceries" }),
    makeTx({ id: "t1", bookedAtIso: "2026-05-08T09:00:00Z", amountMinor: -3000, categoryId: "transport" }),
    makeTx({ id: "u1", bookedAtIso: "2026-05-12T09:00:00Z", amountMinor: -700 }),
  ];

  it("returns explicit target, actual, and delta rows with deterministic ordering", () => {
    const store = createMonthlyCategoryTargetStore([
      { yearMonth: "2026-05", categoryId: "transport", targetMinor: 5000 },
      { yearMonth: "2026-05", categoryId: "groceries", targetMinor: 10000 },
      { yearMonth: "2026-05", categoryId: "dining", targetMinor: 6000 },
    ]);

    const result = queryTargetVsActualCategoryRows(mayTransactions, store, "2026-05");

    expect(result).toEqual({
      yearMonth: "2026-05",
      rows: [
        {
          categoryId: "dining",
          targetMinor: 6000,
          actualMinor: 0,
          deltaMinor: -6000,
        },
        {
          categoryId: "groceries",
          targetMinor: 10000,
          actualMinor: 12000,
          deltaMinor: 2000,
        },
        {
          categoryId: "transport",
          targetMinor: 5000,
          actualMinor: 3000,
          deltaMinor: -2000,
        },
        {
          categoryId: null,
          targetMinor: null,
          actualMinor: 700,
          deltaMinor: null,
        },
      ],
    });

    const refreshed = queryTargetVsActualCategoryRows(mayTransactions, store, "2026-05");
    expect(refreshed).toEqual(result);
  });

  it("refreshes delta values when targets are updated", () => {
    const store = createMonthlyCategoryTargetStore([
      { yearMonth: "2026-05", categoryId: "groceries", targetMinor: 10000 },
    ]);

    const first = queryTargetVsActualCategoryRows(mayTransactions, store, "2026-05");
    const groceriesBefore = first.rows.find(row => row.categoryId === "groceries");
    expect(groceriesBefore?.deltaMinor).toBe(2000);

    updateMonthlyCategoryTarget(store, {
      yearMonth: "2026-05",
      categoryId: "groceries",
      targetMinor: 12000,
    });

    const second = queryTargetVsActualCategoryRows(mayTransactions, store, "2026-05");
    const groceriesAfter = second.rows.find(row => row.categoryId === "groceries");
    expect(groceriesAfter?.deltaMinor).toBe(0);
  });
});
