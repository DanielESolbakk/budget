import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { listCategorizationReviewQueue } from "../../src/app/reviewQueue.js";
import { restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";
import { computeCategoryBreakdown } from "../../src/domain/aggregation/computeCategoryBreakdown.js";
import { computeMonthlyTotals } from "../../src/domain/aggregation/computeMonthlyTotals.js";
import { buildCsvOutput } from "../../src/domain/export/buildCsvRows.js";
import type { Transaction, TransactionCategoryAllocation } from "../../src/domain/types.js";

const transaction: Transaction = {
  id: "tx-allocation",
  householdId: "hh-allocation",
  accountId: "acc-allocation",
  bookedAtIso: "2026-05-12T00:00:00Z",
  amountMinor: -1_000,
  merchantRaw: "Household shop",
};

interface AllocationLedger {
  updateTransactionCategoryAllocations: (
    transactionId: string,
    allocations: TransactionCategoryAllocation[]
  ) => Transaction;
}

function createLedger(dbPath: string) {
  return createLocalLedgerDatabase({
    dbPath,
    seedData: {
      household: {
        id: "hh-allocation",
        name: "Synthetic household",
        createdAtIso: "2026-01-01T00:00:00Z",
      },
      accounts: [{
        id: "acc-allocation",
        householdId: "hh-allocation",
        name: "Synthetic account",
        currencyCode: "NOK",
      }],
      transactions: [transaction],
      importJobs: [],
      monthlyCategoryTargets: [],
    },
  });
}

function allocationLedger(ledger: ReturnType<typeof createLedger>) {
  const result = ledger as ReturnType<typeof createLedger> & AllocationLedger;
  expect(typeof result.updateTransactionCategoryAllocations).toBe("function");
  return result;
}

describe("transaction allocation persistence", () => {
  it("keeps allocation details through reopen and backup restore without duplicating the source transaction", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-allocation-roundtrip-"));
    const databasePath = join(directory, "ledger.sqlite");
    const snapshotPath = join(directory, "backup.json");
    const ledger = createLedger(databasePath);
    const allocations = [
      { categoryId: "housing", amountMinor: -300 },
      { categoryId: "groceries", amountMinor: -700 },
    ];
    let ledgerIsClosed = false;

    try {
      allocationLedger(ledger).updateTransactionCategoryAllocations(transaction.id, allocations);
      const stored = ledger.getTransactionById(transaction.id);
      expect(stored?.categoryAllocations).toEqual(allocations);
      expect(computeCategoryBreakdown([stored!], "2026-05").entries.map((entry) => entry.totalMinor))
        .toEqual([700, 300]);

      ledger.close();
      ledgerIsClosed = true;
      const reopened = createLedger(databasePath);
      try {
        expect(reopened.getTransactionById(transaction.id)?.categoryAllocations).toEqual(allocations);
        createBackupSnapshot({
          ...reopened.loadLedgerSnapshotData(),
          createdAtIso: "2026-06-01T00:00:00Z",
          outputPath: snapshotPath,
        });

        const restored = restoreBackupSnapshot({ snapshotPath });
        expect(restored.transactions).toHaveLength(1);
        expect(restored.transactions[0]?.categoryAllocations).toEqual(allocations);

        const restoredLedger = createLedger(join(directory, "restored.sqlite"));
        try {
          restoredLedger.replaceLedgerSnapshotData(restored);
          const restoredTransactions = restoredLedger.loadLedgerSnapshotData().transactions;
          expect(
            computeCategoryBreakdown(restoredTransactions, "2026-05").entries
              .map(({ categoryId, totalMinor }) => ({ categoryId, totalMinor }))
          ).toEqual([
            { categoryId: "groceries", totalMinor: 700 },
            { categoryId: "housing", totalMinor: 300 },
          ]);
          expect(computeMonthlyTotals(restoredTransactions, "2026-05")).toMatchObject({
            expenseMinor: 1_000,
            netMinor: -1_000,
          });
          const restoredAccountTransactions =
            restoredLedger.getTransactionsForAccount(transaction.accountId);
          expect(restoredAccountTransactions).toHaveLength(1);
          expect(computeMonthlyTotals(restoredAccountTransactions, "2026-05")).toMatchObject({
            expenseMinor: 1_000,
            netMinor: -1_000,
          });
        } finally {
          restoredLedger.close();
        }

        const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
          transactions: Array<{ categoryAllocations?: TransactionCategoryAllocation[] }>;
        };
        expect(snapshot.transactions[0]?.categoryAllocations).toEqual(allocations);
      } finally {
        reopened.close();
      }
    } finally {
      if (!ledgerIsClosed) ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps a failed allocation replacement from changing the saved allocation state", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-allocation-atomic-"));
    const ledger = createLedger(join(directory, "ledger.sqlite"));
    const allocations = [
      { categoryId: "groceries", amountMinor: -700 },
      { categoryId: "housing", amountMinor: -300 },
    ];

    try {
      const database = allocationLedger(ledger);
      database.updateTransactionCategoryAllocations(transaction.id, allocations);
      expect(() =>
        database.updateTransactionCategoryAllocations(transaction.id, [
          { categoryId: "groceries", amountMinor: -700 },
          { categoryId: "housing", amountMinor: -200 },
        ])
      ).toThrow();

      expect(ledger.getTransactionById(transaction.id)?.categoryAllocations).toEqual(allocations);
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("exports the source transaction once with its category allocation details", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-allocation-export-"));
    const ledger = createLedger(join(directory, "ledger.sqlite"));
    const allocations = [
      { categoryId: "housing", amountMinor: -300 },
      { categoryId: "groceries", amountMinor: -700 },
    ];

    try {
      allocationLedger(ledger).updateTransactionCategoryAllocations(transaction.id, allocations);
      const csv = buildCsvOutput(ledger.loadLedgerSnapshotData().transactions);
      const rows = csv.trimEnd().split("\n");

      expect(rows).toHaveLength(2);
      expect(rows[0]).toContain("categoryAllocations");
      expect(rows[1]).toContain("groceries");
      expect(rows[1]).toContain("housing");
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("finds a split transaction under each allocated category filter", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-allocation-category-filter-"));
    const ledger = createLedger(join(directory, "ledger.sqlite"));

    try {
      allocationLedger(ledger).updateTransactionCategoryAllocations(transaction.id, [
        { categoryId: "groceries", amountMinor: -700 },
        { categoryId: "housing", amountMinor: -300 },
      ]);

      expect(ledger.queryTransactions(transaction.householdId, {
        categoryId: "groceries",
      }).transactions.map((item) => item.id)).toEqual([transaction.id]);
      expect(ledger.queryTransactions(transaction.householdId, {
        categoryId: "housing",
      }).transactions.map((item) => item.id)).toEqual([transaction.id]);
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("excludes split transactions from the uncategorized ledger filter", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-allocation-uncategorized-filter-"));
    const ledger = createLedger(join(directory, "ledger.sqlite"));

    try {
      allocationLedger(ledger).updateTransactionCategoryAllocations(transaction.id, [
        { categoryId: "groceries", amountMinor: -700 },
        { categoryId: "housing", amountMinor: -300 },
      ]);

      expect(ledger.queryTransactions(transaction.householdId, {
        uncategorizedOnly: true,
      }).transactions).toEqual([]);
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("excludes split transactions from the categorization review queue", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-allocation-review-queue-"));
    const ledger = createLedger(join(directory, "ledger.sqlite"));

    try {
      allocationLedger(ledger).updateTransactionCategoryAllocations(transaction.id, [
        { categoryId: "groceries", amountMinor: -700 },
        { categoryId: "housing", amountMinor: -300 },
      ]);

      expect(listCategorizationReviewQueue(ledger, transaction.householdId)).toEqual([]);
    } finally {
      ledger.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
