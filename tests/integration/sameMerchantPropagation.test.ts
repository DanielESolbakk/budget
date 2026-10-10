import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import {
  applySameMerchantPropagation,
  listCategorizationReviewQueue,
  undoSameMerchantPropagation,
} from "../../src/app/reviewQueue.js";
import type { CategorizationDecision } from "../../src/domain/types.js";

const HOUSEHOLD = {
  id: "hh-same-merchant",
  name: "Same Merchant Household",
  createdAtIso: "2026-01-01T00:00:00Z",
};

const ACCOUNT = {
  id: "acc-same-merchant",
  householdId: HOUSEHOLD.id,
  name: "Brukskonto",
  currencyCode: "NOK" as const,
};

const SOURCE_TRANSACTION = {
  id: "tx-corrected",
  householdId: HOUSEHOLD.id,
  accountId: ACCOUNT.id,
  bookedAtIso: "2026-05-01T00:00:00Z",
  amountMinor: -1200,
  merchantRaw: "REMA 1000 AS",
};

const ORIGINAL_CATEGORIZATION: CategorizationDecision = {
  status: "ambiguous",
  categoryId: "groceries",
  confidence: 0.35,
  confidenceLevel: "low",
  requiresReview: true,
  selectedRule: {
    ruleId: "rule-a",
    merchantAlias: "REMA 1000",
    categoryId: "groceries",
    priority: 10,
  },
  matchingRules: [
    {
      ruleId: "rule-a",
      merchantAlias: "REMA 1000",
      categoryId: "groceries",
      priority: 10,
    },
    {
      ruleId: "rule-b",
      merchantAlias: "REMA 1000",
      categoryId: "transport",
      priority: 10,
    },
  ],
};

const CORRECTED_CATEGORIZATION: CategorizationDecision = {
  status: "categorized",
  categoryId: "transport",
  confidence: 0.95,
  confidenceLevel: "high",
  requiresReview: false,
  selectedRule: {
    ruleId: "learned:REMA 1000",
    merchantAlias: "REMA 1000",
    categoryId: "transport",
    priority: 100,
  },
  matchingRules: [
    {
      ruleId: "learned:REMA 1000",
      merchantAlias: "REMA 1000",
      categoryId: "transport",
      priority: 100,
    },
  ],
};

describe("same-merchant correction persistence", () => {
  it("retains the original categorization decision in correction history after reopening", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "budget-same-merchant-"));
    const dbPath = join(temporaryDirectory, "ledger.sqlite");
    const seedData = {
      household: HOUSEHOLD,
      accounts: [ACCOUNT],
      transactions: [{ ...SOURCE_TRANSACTION, categorization: ORIGINAL_CATEGORIZATION }],
      importJobs: [],
      monthlyCategoryTargets: [],
    };
    let database = createLocalLedgerDatabase({ dbPath, seedData });

    try {
      database.updateTransactionCategoryAndRule(SOURCE_TRANSACTION.id, {
        merchantAlias: "REMA 1000",
        categoryId: "transport",
      }, CORRECTED_CATEGORIZATION);
      database.close();

      database = createLocalLedgerDatabase({ dbPath, seedData });

      expect(database.listMerchantCorrectionProvenance()).toMatchObject([
        {
          sourceTransactionId: SOURCE_TRANSACTION.id,
          merchantAlias: "REMA 1000",
          categoryId: "transport",
          actor: "local-user",
          originalCategorization: ORIGINAL_CATEGORIZATION,
          correctedAtIso: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        },
      ]);
      const correctedTransaction = database.loadLedgerSnapshotData().transactions.find(
        (transaction) => transaction.id === SOURCE_TRANSACTION.id
      );
      expect(correctedTransaction).toMatchObject({
        categoryId: "transport",
        categorization: CORRECTED_CATEGORIZATION,
      });
      expect(database.listMerchantCategoryRules()).toEqual([
        { merchantAlias: "REMA 1000", categoryId: "transport" },
      ]);
    } finally {
      database.close();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("updates only selected uncategorized transactions and records their before and after categories", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "budget-same-merchant-batch-"));
    const seedData = {
      household: HOUSEHOLD,
      accounts: [ACCOUNT],
      transactions: [
        SOURCE_TRANSACTION,
        { ...SOURCE_TRANSACTION, id: "tx-selected", merchantRaw: "Rema 1000" },
        { ...SOURCE_TRANSACTION, id: "tx-unselected", merchantRaw: "REMA 1000 ASA" },
        { ...SOURCE_TRANSACTION, id: "tx-unrelated", merchantRaw: "Stavanger Taxi" },
        { ...SOURCE_TRANSACTION, id: "tx-already-categorized", categoryId: "transport" },
      ],
      importJobs: [],
      monthlyCategoryTargets: [],
    };
    const database = createLocalLedgerDatabase({
      dbPath: join(temporaryDirectory, "ledger.sqlite"),
      seedData,
    });

    try {
      database.updateTransactionCategoryAndRule(SOURCE_TRANSACTION.id, {
        merchantAlias: "REMA 1000",
        categoryId: "groceries",
      });

      const operation = database.applySameMerchantPropagation({
        sourceTransactionId: SOURCE_TRANSACTION.id,
        merchantAlias: "REMA 1000",
        categoryId: "groceries",
        transactionIds: ["tx-selected"],
      });

      expect(operation).toMatchObject({
        sourceTransactionId: SOURCE_TRANSACTION.id,
        merchantAlias: "REMA 1000",
        categoryId: "groceries",
        changes: [
          { transactionId: "tx-selected", beforeCategoryId: null, afterCategoryId: "groceries" },
        ],
      });
      expect(database.getTransactionById("tx-selected")?.categoryId).toBe("groceries");
      expect(database.getTransactionById("tx-unselected")?.categoryId).toBeUndefined();
      expect(database.getTransactionById("tx-unrelated")?.categoryId).toBeUndefined();
      expect(database.getTransactionById("tx-already-categorized")?.categoryId).toBe("transport");
      expect(database.listSameMerchantPropagationOperations()).toMatchObject([operation]);
    } finally {
      database.close();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("rolls back every selected row when a propagation selection contains a categorized transaction", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "budget-same-merchant-rollback-"));
    const seedData = {
      household: HOUSEHOLD,
      accounts: [ACCOUNT],
      transactions: [
        SOURCE_TRANSACTION,
        { ...SOURCE_TRANSACTION, id: "tx-first", merchantRaw: "Rema 1000" },
        { ...SOURCE_TRANSACTION, id: "tx-categorized", merchantRaw: "REMA 1000", categoryId: "transport" },
      ],
      importJobs: [],
      monthlyCategoryTargets: [],
    };
    const database = createLocalLedgerDatabase({
      dbPath: join(temporaryDirectory, "ledger.sqlite"),
      seedData,
    });

    try {
      database.updateTransactionCategoryAndRule(SOURCE_TRANSACTION.id, {
        merchantAlias: "REMA 1000",
        categoryId: "groceries",
      });

      expect(() => database.applySameMerchantPropagation({
        sourceTransactionId: SOURCE_TRANSACTION.id,
        merchantAlias: "REMA 1000",
        categoryId: "groceries",
        transactionIds: ["tx-first", "tx-categorized"],
      })).toThrow("Transaction is already categorized: tx-categorized");
      expect(database.getTransactionById("tx-first")?.categoryId).toBeUndefined();
      expect(database.getTransactionById("tx-categorized")?.categoryId).toBe("transport");
      expect(database.listSameMerchantPropagationOperations()).toEqual([]);
    } finally {
      database.close();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("rolls back every selected row when a SQLite write fails during propagation", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "budget-same-merchant-write-failure-"));
    const dbPath = join(temporaryDirectory, "ledger.sqlite");
    const database = createLocalLedgerDatabase({
      dbPath,
      seedData: {
        household: HOUSEHOLD,
        accounts: [ACCOUNT],
        transactions: [
          SOURCE_TRANSACTION,
          { ...SOURCE_TRANSACTION, id: "tx-first", merchantRaw: "Rema 1000" },
          { ...SOURCE_TRANSACTION, id: "tx-second", merchantRaw: "REMA 1000" },
        ],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });
    let failureInjector: DatabaseSync | undefined;

    try {
      database.updateTransactionCategoryAndRule(SOURCE_TRANSACTION.id, {
        merchantAlias: "REMA 1000",
        categoryId: "groceries",
      });

      failureInjector = new DatabaseSync(dbPath);
      failureInjector.exec(`
        CREATE TRIGGER fail_second_propagation_change
        BEFORE INSERT ON same_merchant_propagation_changes
        WHEN NEW.transaction_id = 'tx-second'
        BEGIN
          SELECT RAISE(ABORT, 'Injected propagation write failure.');
        END;
      `);
      failureInjector.close();
      failureInjector = undefined;

      expect(() => database.applySameMerchantPropagation({
        sourceTransactionId: SOURCE_TRANSACTION.id,
        merchantAlias: "REMA 1000",
        categoryId: "groceries",
        transactionIds: ["tx-first", "tx-second"],
      })).toThrow("Injected propagation write failure.");

      expect(database.getTransactionById("tx-first")?.categoryId).toBeUndefined();
      expect(database.getTransactionById("tx-second")?.categoryId).toBeUndefined();
      expect(database.listSameMerchantPropagationOperations()).toEqual([]);
    } finally {
      failureInjector?.close();
      database.close();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("rejects propagation without a persisted source correction", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "budget-same-merchant-source-"));
    const database = createLocalLedgerDatabase({
      dbPath: join(temporaryDirectory, "ledger.sqlite"),
      seedData: {
        household: HOUSEHOLD,
        accounts: [ACCOUNT],
        transactions: [
          SOURCE_TRANSACTION,
          { ...SOURCE_TRANSACTION, id: "tx-selected", merchantRaw: "Rema 1000" },
        ],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      expect(() => database.applySameMerchantPropagation({
        sourceTransactionId: SOURCE_TRANSACTION.id,
        merchantAlias: "REMA 1000",
        categoryId: "groceries",
        transactionIds: ["tx-selected"],
      })).toThrow(`Source correction not found: ${SOURCE_TRANSACTION.id}`);
      expect(database.getTransactionById("tx-selected")?.categoryId).toBeUndefined();
      expect(database.listSameMerchantPropagationOperations()).toEqual([]);
    } finally {
      database.close();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("rejects an uncategorized transaction with a different normalized merchant", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "budget-same-merchant-alias-"));
    const unrelatedTransaction = {
      ...SOURCE_TRANSACTION,
      id: "tx-unrelated",
      merchantRaw: "Stavanger Taxi",
    };
    const database = createLocalLedgerDatabase({
      dbPath: join(temporaryDirectory, "ledger.sqlite"),
      seedData: {
        household: HOUSEHOLD,
        accounts: [ACCOUNT],
        transactions: [SOURCE_TRANSACTION, unrelatedTransaction],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      database.updateTransactionCategoryAndRule(SOURCE_TRANSACTION.id, {
        merchantAlias: "REMA 1000",
        categoryId: "groceries",
      });

      expect(() => database.applySameMerchantPropagation({
        sourceTransactionId: SOURCE_TRANSACTION.id,
        merchantAlias: "REMA 1000",
        categoryId: "groceries",
        transactionIds: [unrelatedTransaction.id],
      })).toThrow(`Transaction is not eligible for same-merchant propagation: ${unrelatedTransaction.id}`);
      expect(database.getTransactionById(unrelatedTransaction.id)?.categoryId).toBeUndefined();
      expect(database.listSameMerchantPropagationOperations()).toEqual([]);
    } finally {
      database.close();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("rejects a same-merchant transaction from another household", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "budget-same-merchant-household-"));
    const otherHouseholdTransaction = {
      ...SOURCE_TRANSACTION,
      id: "tx-other-household",
      householdId: "hh-other",
    };
    const database = createLocalLedgerDatabase({
      dbPath: join(temporaryDirectory, "ledger.sqlite"),
      seedData: {
        household: HOUSEHOLD,
        accounts: [ACCOUNT],
        transactions: [SOURCE_TRANSACTION, otherHouseholdTransaction],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      database.updateTransactionCategoryAndRule(SOURCE_TRANSACTION.id, {
        merchantAlias: "REMA 1000",
        categoryId: "groceries",
      });

      expect(() => database.applySameMerchantPropagation({
        sourceTransactionId: SOURCE_TRANSACTION.id,
        merchantAlias: "REMA 1000",
        categoryId: "groceries",
        transactionIds: [otherHouseholdTransaction.id],
      })).toThrow(`Transaction is not eligible for same-merchant propagation: ${otherHouseholdTransaction.id}`);
      expect(database.getTransactionById(otherHouseholdTransaction.id)?.categoryId).toBeUndefined();
      expect(database.listSameMerchantPropagationOperations()).toEqual([]);
    } finally {
      database.close();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("undoes a persisted propagation after reopening without changing the correction or merchant rule", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "budget-same-merchant-undo-"));
    const dbPath = join(temporaryDirectory, "ledger.sqlite");
    const seedData = {
      household: HOUSEHOLD,
      accounts: [ACCOUNT],
      transactions: [
        SOURCE_TRANSACTION,
        { ...SOURCE_TRANSACTION, id: "tx-selected", merchantRaw: "Rema 1000" },
        { ...SOURCE_TRANSACTION, id: "tx-unselected", merchantRaw: "REMA 1000 ASA" },
        { ...SOURCE_TRANSACTION, id: "tx-unrelated", merchantRaw: "Stavanger Taxi" },
        { ...SOURCE_TRANSACTION, id: "tx-already-categorized", categoryId: "transport" },
      ],
      importJobs: [],
      monthlyCategoryTargets: [],
    };
    let database = createLocalLedgerDatabase({ dbPath, seedData });

    try {
      database.updateTransactionCategoryAndRule(SOURCE_TRANSACTION.id, {
        merchantAlias: "REMA 1000",
        categoryId: "groceries",
      });
      const operation = database.applySameMerchantPropagation({
        sourceTransactionId: SOURCE_TRANSACTION.id,
        merchantAlias: "REMA 1000",
        categoryId: "groceries",
        transactionIds: ["tx-selected"],
      });
      database.close();

      database = createLocalLedgerDatabase({ dbPath, seedData });
      expect(database.undoSameMerchantPropagation(operation.id)).toBe(true);
      expect(database.undoSameMerchantPropagation(operation.id)).toBe(false);

      expect(database.getTransactionById("tx-selected")?.categoryId).toBeUndefined();
      expect(database.getTransactionById("tx-unselected")?.categoryId).toBeUndefined();
      expect(database.getTransactionById("tx-unrelated")?.categoryId).toBeUndefined();
      expect(database.getTransactionById("tx-already-categorized")?.categoryId).toBe("transport");
      expect(database.getTransactionById(SOURCE_TRANSACTION.id)?.categoryId).toBe("groceries");
      expect(database.listMerchantCategoryRules()).toEqual([
        { merchantAlias: "REMA 1000", categoryId: "groceries" },
      ]);
      expect(database.listMerchantCorrectionProvenance()).toMatchObject([
        { sourceTransactionId: SOURCE_TRANSACTION.id, merchantAlias: "REMA 1000", categoryId: "groceries" },
      ]);
      expect(database.listSameMerchantPropagationOperations()).toMatchObject([
        { id: operation.id, undoneAtIso: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) },
      ]);
    } finally {
      database.close();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("clears correction and propagation history when a ledger snapshot replaces the ledger", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "budget-same-merchant-replace-"));
    const database = createLocalLedgerDatabase({
      dbPath: join(temporaryDirectory, "ledger.sqlite"),
      seedData: {
        household: HOUSEHOLD,
        accounts: [ACCOUNT],
        transactions: [
          SOURCE_TRANSACTION,
          { ...SOURCE_TRANSACTION, id: "tx-selected", merchantRaw: "Rema 1000" },
        ],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      database.updateTransactionCategoryAndRule(SOURCE_TRANSACTION.id, {
        merchantAlias: "REMA 1000",
        categoryId: "groceries",
      });
      const operation = database.applySameMerchantPropagation({
        sourceTransactionId: SOURCE_TRANSACTION.id,
        merchantAlias: "REMA 1000",
        categoryId: "groceries",
        transactionIds: ["tx-selected"],
      });

      database.replaceLedgerSnapshotData({
        household: HOUSEHOLD,
        accounts: [ACCOUNT],
        transactions: [{ ...SOURCE_TRANSACTION, id: "tx-restored", categoryId: "transport" }],
        importJobs: [],
        monthlyCategoryTargets: [],
        merchantCategoryRules: [],
      });

      expect(database.listMerchantCorrectionProvenance()).toEqual([]);
      expect(database.listSameMerchantPropagationOperations()).toEqual([]);
      expect(database.undoSameMerchantPropagation(operation.id)).toBe(false);
    } finally {
      database.close();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("applies only previewed candidates through the review service and allows one undo", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "budget-same-merchant-service-"));
    const database = createLocalLedgerDatabase({
      dbPath: join(temporaryDirectory, "ledger.sqlite"),
      seedData: {
        household: HOUSEHOLD,
        accounts: [ACCOUNT],
        transactions: [
          SOURCE_TRANSACTION,
          { ...SOURCE_TRANSACTION, id: "tx-selected", merchantRaw: "Rema 1000" },
          { ...SOURCE_TRANSACTION, id: "tx-unselected", merchantRaw: "REMA 1000 ASA" },
          { ...SOURCE_TRANSACTION, id: "tx-unrelated", merchantRaw: "Stavanger Taxi" },
          { ...SOURCE_TRANSACTION, id: "tx-already-categorized", categoryId: "transport" },
        ],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      database.updateTransactionCategoryAndRule(SOURCE_TRANSACTION.id, {
        merchantAlias: "REMA 1000",
        categoryId: "groceries",
      });
      const input = {
        sourceTransactionId: SOURCE_TRANSACTION.id,
        merchantAlias: "REMA 1000",
        categoryId: "groceries",
        transactionIds: ["tx-selected"],
      };

      expect(() => applySameMerchantPropagation(database, {
        ...input,
        transactionIds: ["tx-unrelated"],
      })).toThrow("Transaction is not in the current same-merchant preview: tx-unrelated");
      expect(database.listSameMerchantPropagationOperations()).toEqual([]);

      const operation = applySameMerchantPropagation(database, input);
      expect(operation.changes.map((change) => change.transactionId)).toEqual(["tx-selected"]);
      expect(database.getTransactionById("tx-selected")?.categoryId).toBe("groceries");
      expect(database.getTransactionById("tx-unselected")?.categoryId).toBeUndefined();

      expect(undoSameMerchantPropagation(database, operation.id)).toBe(true);
      expect(undoSameMerchantPropagation(database, operation.id)).toBe(false);
      expect(database.getTransactionById("tx-selected")?.categoryId).toBeUndefined();
      expect(database.getTransactionById(SOURCE_TRANSACTION.id)?.categoryId).toBe("groceries");
      expect(database.listMerchantCategoryRules()).toEqual([
        { merchantAlias: "REMA 1000", categoryId: "groceries" },
      ]);
    } finally {
      database.close();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it("resolves propagated review metadata and restores it when the propagation is undone", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "budget-same-merchant-review-state-"));
    const selectedTransaction = {
      ...SOURCE_TRANSACTION,
      id: "tx-needs-review",
      merchantRaw: "Rema 1000",
      categorization: ORIGINAL_CATEGORIZATION,
    };
    const database = createLocalLedgerDatabase({
      dbPath: join(temporaryDirectory, "ledger.sqlite"),
      seedData: {
        household: HOUSEHOLD,
        accounts: [ACCOUNT],
        transactions: [SOURCE_TRANSACTION, selectedTransaction],
        importJobs: [],
        monthlyCategoryTargets: [],
      },
    });

    try {
      database.updateTransactionCategoryAndRule(SOURCE_TRANSACTION.id, {
        merchantAlias: "REMA 1000",
        categoryId: "groceries",
      }, CORRECTED_CATEGORIZATION);
      expect(listCategorizationReviewQueue(database, HOUSEHOLD.id).map((transaction) => transaction.id))
        .toContain(selectedTransaction.id);

      const operation = applySameMerchantPropagation(database, {
        sourceTransactionId: SOURCE_TRANSACTION.id,
        merchantAlias: "REMA 1000",
        categoryId: "groceries",
        transactionIds: [selectedTransaction.id],
      });

      expect(listCategorizationReviewQueue(database, HOUSEHOLD.id).map((transaction) => transaction.id))
        .not.toContain(selectedTransaction.id);
      const propagatedTransaction = database.loadLedgerSnapshotData().transactions.find(
        (transaction) => transaction.id === selectedTransaction.id
      );
      expect(propagatedTransaction?.categorization?.requiresReview).toBe(false);

      expect(undoSameMerchantPropagation(database, operation.id)).toBe(true);
      expect(database.getTransactionById(selectedTransaction.id)?.categoryId).toBeUndefined();
      const undoneTransaction = database.loadLedgerSnapshotData().transactions.find(
        (transaction) => transaction.id === selectedTransaction.id
      );
      expect(undoneTransaction?.categorization).toEqual(ORIGINAL_CATEGORIZATION);
      expect(listCategorizationReviewQueue(database, HOUSEHOLD.id).map((transaction) => transaction.id))
        .toContain(selectedTransaction.id);
    } finally {
      database.close();
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});