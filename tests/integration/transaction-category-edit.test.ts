import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { LedgerOperationCoordinator } from "../../src/app/ledgerOperationCoordinator.js";
import { createBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";
import {
  applyTransactionCategoryEdit,
  getTransactionCategoryEditContext,
} from "../../src/app/reviewService.js";
import type { Transaction } from "../../src/domain/types.js";
import { registerReviewLedgerChannels } from "../../electron/ipc/reviewLedgerChannels.js";

const transaction: Transaction = {
  id: "tx-category-edit",
  householdId: "hh-category-edit",
  accountId: "acc-category-edit",
  bookedAtIso: "2026-05-01T00:00:00Z",
  amountMinor: -10_000,
  merchantRaw: "MENY AS",
  currencyCode: "NOK",
  sourceType: "manual",
  categoryId: "fuel",
  categorization: {
    status: "categorized",
    categoryId: "fuel",
    confidence: 1,
    confidenceLevel: "high",
    requiresReview: false,
    matchingRules: [],
  },
};

function createDatabase(
  dbPath: string,
  options: {
    transactions?: Transaction[];
    merchantCategoryRules?: Array<{ merchantAlias: string; categoryId: string }>;
  } = {}
) {
  return createLocalLedgerDatabase({
    dbPath,
    seedData: {
      household: {
        id: "hh-category-edit",
        name: "Synthetic household",
        createdAtIso: "2026-01-01T00:00:00Z",
      },
      accounts: [{
        id: "acc-category-edit",
        householdId: "hh-category-edit",
        name: "Brukskonto",
        currencyCode: "NOK",
      }],
      transactions: options.transactions ?? [
        transaction,
        { ...transaction, id: "tx-unrelated", merchantRaw: "KIWI", categoryId: "groceries" },
      ],
      importJobs: [],
      monthlyCategoryTargets: [],
      merchantCategoryRules: options.merchantCategoryRules ?? [{ merchantAlias: "MENY", categoryId: "fuel" }],
    },
  });
}

describe("transaction category edits", () => {
  it("exposes a validated context and edit through the serialized desktop IPC channels", async () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-category-edit-ipc-"));
    const database = createDatabase(join(directory, "ledger.sqlite"));
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const runtimeState = { ledgerGeneration: 0, databaseGeneration: 2 };
    const learnedCategoryRules = new Map([["MENY", "fuel"]]);

    try {
      registerReviewLedgerChannels({
        ipcMain: {
          handle: (
            channel: string,
            handler: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
          ) => {
            handlers.set(channel, handler as (...args: unknown[]) => unknown);
          },
        },
        assertTrustedRenderer: () => undefined,
        localLedgerDatabase: database,
        categoryManagementService: {} as never,
        sampleHousehold: {
          id: "hh-category-edit",
          name: "Synthetic household",
          createdAtIso: "2026-01-01T00:00:00Z",
        },
        runtimeState,
        learnedCategoryRules,
        ledgerOperationCoordinator: new LedgerOperationCoordinator(),
        applyTransactionListTestControl: async () => undefined,
      } as never);

      const event = {} as Electron.IpcMainInvokeEvent;
      const context = await handlers.get("transaction:categoryEditContext")!(event, transaction.id) as {
        expectedState: { databaseGeneration: number };
      };
      expect(context.expectedState.databaseGeneration).toBe(2);

      const result = await handlers.get("transaction:editCategory")!(event, {
        transactionId: transaction.id,
        expectedState: context.expectedState,
        mode: "single",
        categoryId: "groceries",
        rememberForMerchant: false,
      });
      expect(result).toMatchObject({ ok: true, merchantRuleEffect: "not-requested" });
      expect(runtimeState.ledgerGeneration).toBe(1);
      expect(() => handlers.get("transaction:editCategory")!(event, {
        transactionId: transaction.id,
        expectedState: context.expectedState,
        mode: "single",
        categoryId: "",
        rememberForMerchant: false,
      })).toThrow(/categoryId/);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("saves a one-off category correction without changing its remembered merchant rule", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-category-edit-"));
    const databasePath = join(directory, "ledger.sqlite");
    const database = createDatabase(databasePath);
    const learnedCategoryRules = new Map([["MENY", "fuel"]]);

    try {
      const context = getTransactionCategoryEditContext(database, transaction.id, 3);
      const result = applyTransactionCategoryEdit(database, learnedCategoryRules, {
        transactionId: transaction.id,
        expectedState: context.expectedState,
        mode: "single",
        categoryId: "groceries",
        rememberForMerchant: false,
      }, 3);

      expect(result).toMatchObject({
        ok: true,
        merchantRuleEffect: "not-requested",
        transaction: {
          id: transaction.id,
          categoryId: "groceries",
          amountMinor: transaction.amountMinor,
          bookedAtIso: transaction.bookedAtIso,
          accountId: transaction.accountId,
          categorization: {
            categoryId: "groceries",
            requiresReview: false,
            decisionSource: "manual",
          },
        },
      });
      expect(database.listMerchantCategoryRules()).toEqual([
        { merchantAlias: "MENY", categoryId: "fuel" },
      ]);
      expect(learnedCategoryRules).toEqual(new Map([["MENY", "fuel"]]));
      expect(database.getTransactionById("tx-unrelated")).toMatchObject({
        categoryId: "groceries",
        merchantRaw: "KIWI",
      });
      expect(database.getTransactionById(transaction.id)?.categoryAllocations).toBeUndefined();
    } finally {
      database.close();
    }

    const reopened = createDatabase(databasePath);
    try {
      expect(reopened.getTransactionById(transaction.id)).toMatchObject({
        categoryId: "groceries",
        amountMinor: transaction.amountMinor,
        categorization: {
          decisionSource: "manual",
          requiresReview: false,
        },
      });
      expect(reopened.listMerchantCategoryRules()).toEqual([
        { merchantAlias: "MENY", categoryId: "fuel" },
      ]);
      expect(reopened.loadLedgerSnapshotData().recoveryHistory).toMatchObject({
        transactionCategoryEdits: [{
          sourceTransactionId: transaction.id,
          merchantAlias: "MENY",
          mode: "single",
          categoryId: "groceries",
          rememberForMerchant: false,
          merchantRuleEffect: "not-requested",
        }],
      });
    } finally {
      reopened.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("saves a rule-only learning change and avoids duplicate history when the rule already matches", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-category-rule-only-"));
    const database = createDatabase(join(directory, "ledger.sqlite"), {
      merchantCategoryRules: [{ merchantAlias: "MENY", categoryId: "groceries" }],
    });
    const learnedCategoryRules = new Map([["MENY", "fuel"]]);

    try {
      const context = getTransactionCategoryEditContext(database, transaction.id, 0);
      const ruleOnlyResult = applyTransactionCategoryEdit(database, learnedCategoryRules, {
        transactionId: transaction.id,
        expectedState: context.expectedState,
        mode: "single",
        categoryId: "fuel",
        rememberForMerchant: true,
      }, 0);

      expect(ruleOnlyResult).toMatchObject({
        ok: true,
        transactionChanged: false,
        merchantRuleEffect: "updated",
      });
      expect(database.getTransactionById(transaction.id)).toMatchObject({
        categoryId: "fuel",
        amountMinor: transaction.amountMinor,
      });
      expect(database.listMerchantCategoryRules()).toEqual([
        { merchantAlias: "MENY", categoryId: "fuel" },
      ]);
      expect(learnedCategoryRules).toEqual(new Map([["MENY", "fuel"]]));

      const matchingContext = getTransactionCategoryEditContext(database, transaction.id, 0);
      const alreadyMatchingResult = applyTransactionCategoryEdit(database, learnedCategoryRules, {
        transactionId: transaction.id,
        expectedState: matchingContext.expectedState,
        mode: "single",
        categoryId: "fuel",
        rememberForMerchant: true,
      }, 0);

      expect(alreadyMatchingResult).toMatchObject({
        ok: true,
        transactionChanged: false,
        merchantRuleEffect: "already-matching",
      });
      expect(database.loadLedgerSnapshotData().recoveryHistory?.transactionCategoryEdits).toHaveLength(1);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rolls transaction, rule, learned-map, and provenance writes back after a mid-edit SQLite failure", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-category-edit-rollback-"));
    const databasePath = join(directory, "ledger.sqlite");
    const database = createDatabase(databasePath);
    const failedWrite = new DatabaseSync(databasePath);
    const learnedCategoryRules = new Map([["MENY", "fuel"]]);

    try {
      failedWrite.exec(`
        CREATE TRIGGER fail_transaction_category_edit
        BEFORE INSERT ON transaction_category_edit_provenance
        BEGIN
          SELECT RAISE(ABORT, 'Injected transaction category edit failure');
        END;
      `);
      const context = getTransactionCategoryEditContext(database, transaction.id, 0);

      expect(() => applyTransactionCategoryEdit(database, learnedCategoryRules, {
        transactionId: transaction.id,
        expectedState: context.expectedState,
        mode: "single",
        categoryId: "groceries",
        rememberForMerchant: true,
      }, 0)).toThrow(/Injected transaction category edit failure/);

      expect(database.getTransactionById(transaction.id)).toMatchObject({
        categoryId: "fuel",
        amountMinor: transaction.amountMinor,
      });
      expect(database.listMerchantCategoryRules()).toEqual([
        { merchantAlias: "MENY", categoryId: "fuel" },
      ]);
      expect(learnedCategoryRules).toEqual(new Map([["MENY", "fuel"]]));
      expect(database.loadLedgerSnapshotData().recoveryHistory?.transactionCategoryEdits).toEqual([]);
    } finally {
      failedWrite.close();
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects stale merchant-rule state and a changed database generation without writing", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-category-edit-stale-"));
    const database = createDatabase(join(directory, "ledger.sqlite"));
    const learnedCategoryRules = new Map([["MENY", "fuel"]]);

    try {
      const staleRuleContext = getTransactionCategoryEditContext(database, transaction.id, 4);
      database.upsertMerchantCategoryRule({ merchantAlias: "MENY", categoryId: "groceries" });
      const staleRuleResult = applyTransactionCategoryEdit(database, learnedCategoryRules, {
        transactionId: transaction.id,
        expectedState: staleRuleContext.expectedState,
        mode: "single",
        categoryId: "housing",
        rememberForMerchant: false,
      }, 4);

      expect(staleRuleResult).toMatchObject({ ok: false, code: "STALE_EDIT" });
      const staleDatabaseContext = getTransactionCategoryEditContext(database, transaction.id, 4);
      const staleDatabaseResult = applyTransactionCategoryEdit(database, learnedCategoryRules, {
        transactionId: transaction.id,
        expectedState: staleDatabaseContext.expectedState,
        mode: "single",
        categoryId: "housing",
        rememberForMerchant: false,
      }, 5);

      expect(staleDatabaseResult).toMatchObject({ ok: false, code: "STALE_EDIT" });
      expect(database.getTransactionById(transaction.id)).toMatchObject({
        categoryId: "fuel",
        amountMinor: transaction.amountMinor,
      });
      expect(database.listMerchantCategoryRules()).toEqual([
        { merchantAlias: "MENY", categoryId: "groceries" },
      ]);
      expect(learnedCategoryRules).toEqual(new Map([["MENY", "fuel"]]));
      expect(database.loadLedgerSnapshotData().recoveryHistory?.transactionCategoryEdits).toEqual([]);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("preserves all 10,000 synthetic transaction amounts while replacing one transaction with a split", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-category-edit-10k-"));
    const transactions = Array.from({ length: 10_000 }, (_, index) => ({
      ...transaction,
      id: index === 0 ? transaction.id : `tx-category-edit-${index}`,
      amountMinor: index === 0 ? transaction.amountMinor : -100,
      merchantRaw: index === 0 ? transaction.merchantRaw : `Synthetic merchant ${index}`,
    }));
    const database = createDatabase(join(directory, "ledger.sqlite"), { transactions });
    const learnedCategoryRules = new Map([["MENY", "fuel"]]);

    try {
      const before = database.loadLedgerSnapshotData().transactions;
      const amountBefore = before.reduce((total, item) => total + item.amountMinor, 0);
      const context = getTransactionCategoryEditContext(database, transaction.id, 0);
      const result = applyTransactionCategoryEdit(database, learnedCategoryRules, {
        transactionId: transaction.id,
        expectedState: context.expectedState,
        mode: "split",
        allocations: [
          { categoryId: "groceries", amountMinor: -4_000 },
          { categoryId: "housing", amountMinor: -6_000 },
        ],
        rememberForMerchant: false,
      }, 0);
      const after = database.loadLedgerSnapshotData().transactions;

      expect(result).toMatchObject({ ok: true, transactionChanged: true, merchantRuleEffect: "not-requested" });
      expect(after).toHaveLength(10_000);
      expect(after.find((item) => item.id === transaction.id)).toMatchObject({
        id: transaction.id,
        amountMinor: transaction.amountMinor,
        categoryAllocations: [
          { categoryId: "groceries", amountMinor: -4_000 },
          { categoryId: "housing", amountMinor: -6_000 },
        ],
      });
      expect(after.filter((item) => item.id !== transaction.id))
        .toEqual(before.filter((item) => item.id !== transaction.id));
      expect(after.reduce((total, item) => total + item.amountMinor, 0)).toBe(amountBefore);
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("restores category edit provenance and split allocations from the current backup format", () => {
    const directory = mkdtempSync(join(tmpdir(), "budget-category-edit-backup-"));
    const database = createDatabase(join(directory, "ledger.sqlite"));
    const snapshotPath = join(directory, "category-edit-backup.json");

    try {
      const context = getTransactionCategoryEditContext(database, transaction.id, 0);
      applyTransactionCategoryEdit(database, new Map([["MENY", "fuel"]]), {
        transactionId: transaction.id,
        expectedState: context.expectedState,
        mode: "split",
        allocations: [
          { categoryId: "groceries", amountMinor: -4_000 },
          { categoryId: "housing", amountMinor: -6_000 },
        ],
        rememberForMerchant: false,
      }, 0);
      createBackupSnapshot({
        ...database.loadLedgerSnapshotData(),
        outputPath: snapshotPath,
        createdAtIso: "2026-06-01T00:00:00Z",
      });

      const restored = restoreBackupSnapshot({ snapshotPath });
      const restoredDatabase = createLocalLedgerDatabase({
        dbPath: join(directory, "restored.sqlite"),
        seedData: restored,
      });
      try {
        expect(restoredDatabase.getTransactionById(transaction.id)?.categoryAllocations).toEqual([
          { categoryId: "groceries", amountMinor: -4_000 },
          { categoryId: "housing", amountMinor: -6_000 },
        ]);
        expect(restoredDatabase.loadLedgerSnapshotData().recoveryHistory?.transactionCategoryEdits)
          .toMatchObject([{
            sourceTransactionId: transaction.id,
            mode: "split",
            rememberForMerchant: false,
            allocations: [
              { categoryId: "groceries", amountMinor: -4_000 },
              { categoryId: "housing", amountMinor: -6_000 },
            ],
          }]);
      } finally {
        restoredDatabase.close();
      }
    } finally {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
