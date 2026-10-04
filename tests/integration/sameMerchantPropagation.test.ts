import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";

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

describe("same-merchant correction persistence", () => {
  it("persists correction provenance with its source category and merchant rule after reopening", () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "budget-same-merchant-"));
    const dbPath = join(temporaryDirectory, "ledger.sqlite");
    const seedData = {
      household: HOUSEHOLD,
      accounts: [ACCOUNT],
      transactions: [SOURCE_TRANSACTION],
      importJobs: [],
      monthlyCategoryTargets: [],
    };
    let database = createLocalLedgerDatabase({ dbPath, seedData });

    try {
      database.updateTransactionCategoryAndRule(SOURCE_TRANSACTION.id, {
        merchantAlias: "REMA 1000",
        categoryId: "groceries",
      });
      database.close();

      database = createLocalLedgerDatabase({ dbPath, seedData });

      expect(database.listMerchantCorrectionProvenance()).toMatchObject([
        {
          sourceTransactionId: SOURCE_TRANSACTION.id,
          merchantAlias: "REMA 1000",
          categoryId: "groceries",
          correctedAtIso: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        },
      ]);
      expect(database.getTransactionById(SOURCE_TRANSACTION.id)?.categoryId).toBe("groceries");
      expect(database.listMerchantCategoryRules()).toEqual([
        { merchantAlias: "REMA 1000", categoryId: "groceries" },
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
});