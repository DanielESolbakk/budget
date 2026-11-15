import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { buildBackupSnapshot, createBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";
import { describe, expect, it } from "vitest";
import { createLocalLedgerDatabase, type LocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
import { createCategoryManagementService } from "../../src/app/categoryManagementService.js";
import { applyCategorizationCorrection } from "../../src/app/reviewService.js";
import { withIsolatedLedger } from "../helpers/isolatedLedger.js";
import type { Category, Transaction } from "../../src/domain/types.js";

const customCategory: Category = {
  id: "category-car-001",
  householdId: "hh-isolated",
  label: "  Car \t repairs  ",
  createdAtIso: "2026-05-01T00:00:00.000Z",
  updatedAtIso: "2026-05-01T00:00:00.000Z",
};

function importBaselines(dbPath: string) {
  const database = new DatabaseSync(dbPath);
  try {
    return database.prepare(`SELECT import_job_id, transaction_id, baseline_json
      FROM import_job_transaction_baselines ORDER BY import_job_id, transaction_id`).all().map((row) => {
      if (typeof row.baseline_json !== "string") throw new Error("Expected a saved import baseline.");
      const baseline: unknown = JSON.parse(row.baseline_json);
      return { importJobId: row.import_job_id, transactionId: row.transaction_id, baseline };
    });
  } finally {
    database.close();
  }
}

describe("household category persistence", () => {
  it("uses a custom catalog category for a correction and its future merchant rule", async () => {
    await withIsolatedLedger({}, ({ ledger }) => {
      const snapshot = ledger.loadLedgerSnapshotData();
      ledger.replaceLedgerSnapshotData({
        ...snapshot,
        transactions: [{
          id: "custom-correction", householdId: "hh-isolated", accountId: "acc-isolated",
          bookedAtIso: "2026-05-01", amountMinor: -1200, merchantRaw: "Synthetic workshop",
        }],
      });
      ledger.createCategoryRecord(customCategory);
      const learnedRules = new Map<string, string>();
      expect(() => applyCategorizationCorrection(
        ledger, learnedRules, "custom-correction", "category-car-001",
      )).not.toThrow();
      expect(ledger.loadLedgerSnapshotData().transactions.find(({ id }) => id === "custom-correction")).toMatchObject({
        amountMinor: -1200, categoryId: "category-car-001",
        categorization: { categoryId: "category-car-001", requiresReview: false },
      });
      expect(ledger.listMerchantCorrectionProvenance()).toMatchObject([{
        categoryId: "category-car-001", sourceTransactionId: "custom-correction",
      }]);
      expect(ledger.listMerchantCategoryRules()).toContainEqual({
        merchantAlias: "SYNTHETIC WORKSHOP", categoryId: "category-car-001",
      });
    });
  });

  it("sorts ledger pages by current custom and renamed display names", async () => {
    await withIsolatedLedger({}, ({ ledger }) => {
      const snapshot = ledger.loadLedgerSnapshotData();
      ledger.replaceLedgerSnapshotData({
        ...snapshot,
        categories: [...(snapshot.categories ?? []), { ...customCategory, label: "ZZ Vehicle" }],
        transactions: [
          { id: "vehicle", householdId: "hh-isolated", accountId: "acc-isolated",
            bookedAtIso: "2026-05-01", amountMinor: -1200, merchantRaw: "Synthetic workshop",
            categoryId: "category-car-001" },
          { id: "food", householdId: "hh-isolated", accountId: "acc-isolated",
            bookedAtIso: "2026-05-01", amountMinor: -500, merchantRaw: "Synthetic grocery", categoryId: "groceries" },
        ],
      });
      const query = { sortBy: "categoryId", sortDirection: "asc" } as const;
      expect(ledger.queryTransactions("hh-isolated", query).transactions.map(({ id }) => id))
        .toEqual(["food", "vehicle"]);
      ledger.updateCategoryRecordLabel("hh-isolated", "category-car-001", "Bike repairs", "2026-06-01T00:00:00Z");
      expect(ledger.queryTransactions("hh-isolated", query).transactions.map(({ id }) => id))
        .toEqual(["vehicle", "food"]);
    });
  });

  it("initializes the expanded catalog for a seeded household", async () => {
    await withIsolatedLedger({}, ({ ledger }) => {
      const categories = ledger.listCategories("hh-isolated");
      expect(categories).toHaveLength(14);
      expect(categories).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "groceries", label: "Groceries & food", householdId: "hh-isolated" }),
        expect.objectContaining({ id: "dining", label: "Dining", householdId: "hh-isolated" }),
        expect.objectContaining({ id: "public-transit", label: "Public transit", householdId: "hh-isolated" }),
      ]));
    });
  });

  it("persists onboarding categories for a second database connection", async () => {
    await withIsolatedLedger({}, ({ directory }) => {
      const dbPath = join(directory, "onboarding.sqlite");
      const ledger = createLocalLedgerDatabase({ dbPath });
      try {
        const { household } = ledger.createInitialHouseholdAndAccount({
          householdName: "Synthetic household",
          accountName: "Brukskonto",
          currencyCode: "NOK",
        });
        expect(ledger.listCategories(household.id)).toHaveLength(14);
        const reopened = createLocalLedgerDatabase({ dbPath });
        try {
          expect(reopened.listCategories(household.id)).toEqual(ledger.listCategories(household.id));
        } finally {
          reopened.close();
        }
      } finally {
        ledger.close();
      }
    });
  });

  it.each(["", "missing"])("rejects catalog access without an existing household: %j", async (householdId) => {
    await withIsolatedLedger({}, ({ ledger }) => {
      expect(() => ledger.listCategories(householdId)).toThrow(/household/i);
    });
  });

  it("creates a normalized category with an identity independent of its label", async () => {
    await withIsolatedLedger({}, ({ ledger }) => {
      ledger.createCategoryRecord(customCategory);
      expect(ledger.listCategories("hh-isolated").find((category) => category.id === "category-car-001"))
        .toEqual({
          id: "category-car-001",
          householdId: "hh-isolated",
          label: "Car repairs",
          createdAtIso: "2026-05-01T00:00:00.000Z",
          updatedAtIso: "2026-05-01T00:00:00.000Z",
        });
    });
  });

  it("rejects creating a case/whitespace-equivalent name without altering the catalog", async () => {
    await withIsolatedLedger({}, ({ ledger }) => {
      expect(() => ledger.createCategoryRecord({
        ...customCategory, label: "  gRoCeRiEs \t & food ",
      })).toThrow(/already exists/i);
      expect(ledger.listCategories("hh-isolated")).toHaveLength(14);
    });
  });

  it.each([
    { override: { label: "" }, error: /non-empty string/i },
    { override: { id: "" }, error: /category.*id/i },
    { override: { id: "groceries" }, error: /category.*id.*already exists/i },
    { override: { householdId: "missing" }, error: /household/i },
    { override: { createdAtIso: "not-a-date" }, error: /timestamp/i },
    { override: { updatedAtIso: "2026-05-01" }, error: /timestamp/i },
  ])("rejects invalid category creation $override", async ({ override, error }) => {
    await withIsolatedLedger({}, ({ ledger }) => {
      expect(() => ledger.createCategoryRecord({ ...customCategory, ...override })).toThrow(error);
      expect(ledger.listCategories("hh-isolated")).toHaveLength(14);
    });
  });

  it("renames a category without rewriting financial references or categorization evidence", async () => {
    await withIsolatedLedger({}, ({ ledger, dbPath, directory }) => {
      ledger.createCategoryRecord(customCategory);
      ledger.appendImportJobAndTransactions({
        id: "import-car", householdId: "hh-isolated", sourceType: "csv", sourceName: "synthetic-car.csv",
        startedAtIso: "2026-05-23T00:00:00Z", finishedAtIso: "2026-05-23T00:00:01Z",
        candidateCount: 2, provenance: { sourceIdentity: "synthetic-car", accountId: "acc-isolated" },
      }, [{
        id: "tx-car", householdId: "hh-isolated", accountId: "acc-isolated",
        bookedAtIso: "2026-05-23", amountMinor: -24900, currencyCode: "NOK",
        merchantRaw: "Mekonomen Stavanger", categoryId: "category-car-001", importJobId: "import-car", sourceType: "csv",
        categorization: {
          status: "categorized", confidence: 0.9, confidenceLevel: "high",
          requiresReview: false,
          selectedRule: {
            ruleId: "rule-car", merchantAlias: "MEKONOMEN STAVANGER",
            categoryId: "category-car-001", priority: 0,
          },
          matchingRules: [{
            ruleId: "rule-car", merchantAlias: "MEKONOMEN STAVANGER",
            categoryId: "category-car-001", priority: 0,
          }],
        },
      }, {
        id: "tx-car-split", householdId: "hh-isolated", accountId: "acc-isolated",
        bookedAtIso: "2026-05-23", amountMinor: -15000, currencyCode: "NOK", merchantRaw: "Biltema Stavanger",
        sourceType: "csv", importJobId: "import-car",
        categoryAllocations: [
          { categoryId: "category-car-001", amountMinor: -10000 }, { categoryId: "fees", amountMinor: -5000 },
        ],
      }]);
      ledger.upsertMonthlyCategoryTarget({
        yearMonth: "2026-05", categoryId: "category-car-001", targetMinor: 50000,
      });
      ledger.upsertMerchantCategoryRule({
        merchantAlias: "MEKONOMEN STAVANGER", categoryId: "category-car-001",
      });
      ledger.updateTransactionCategoryAndRule("tx-car", {
        merchantAlias: "MEKONOMEN STAVANGER", categoryId: "category-car-001",
      });
      const before = ledger.loadLedgerSnapshotData();
      const corrections = ledger.listMerchantCorrectionProvenance();
      const history = ledger.listImportJobHistory("hh-isolated");
      const baselines = importBaselines(dbPath);
      expect(corrections).toHaveLength(1);
      expect(baselines).toHaveLength(2);
      const archivePath = join(directory, "before-category-rename.json");
      createBackupSnapshot({ ...before, outputPath: archivePath, createdAtIso: "2026-05-31T00:00:00Z" });
      const archivedBytes = readFileSync(archivePath, "utf8");
      ledger.updateCategoryRecordLabel(
        "hh-isolated", "category-car-001", "  Vehicle   repairs ", "2026-06-01T00:00:00.000Z",
      );
      const after = ledger.loadLedgerSnapshotData();
      expect(after.transactions).toEqual(before.transactions);
      expect(after.monthlyCategoryTargets).toEqual(before.monthlyCategoryTargets);
      expect(after.merchantCategoryRules).toEqual(before.merchantCategoryRules);
      expect(ledger.listMerchantCorrectionProvenance()).toEqual(corrections);
      expect(ledger.listImportJobHistory("hh-isolated")).toEqual(history);
      expect(importBaselines(dbPath)).toEqual(baselines);
      expect(readFileSync(archivePath, "utf8")).toBe(archivedBytes);
      const reopened = createLocalLedgerDatabase({ dbPath });
      try {
        expect(reopened.loadLedgerSnapshotData().transactions).toEqual(before.transactions);
        expect(reopened.listMerchantCorrectionProvenance()).toEqual(corrections);
        expect(reopened.listImportJobHistory("hh-isolated")).toEqual(history);
        expect(importBaselines(dbPath)).toEqual(baselines);
        expect(reopened.listCategories("hh-isolated").find((category) => category.id === "category-car-001"))
          .toEqual({
            id: "category-car-001", householdId: "hh-isolated", label: "Vehicle repairs",
            createdAtIso: "2026-05-01T00:00:00.000Z", updatedAtIso: "2026-06-01T00:00:00.000Z",
          });
      } finally {
        reopened.close();
      }
    });
  });

  it("does not overwrite a renamed default when reopening the catalog", async () => {
    await withIsolatedLedger({}, ({ ledger, dbPath }) => {
      ledger.updateCategoryRecordLabel("hh-isolated", "groceries", "Food", "2026-06-01T00:00:00.000Z");
      const reopened = createLocalLedgerDatabase({ dbPath });
      try {
        expect(reopened.listCategories("hh-isolated").find((category) => category.id === "groceries")?.label)
          .toBe("Food");
      } finally {
        reopened.close();
      }
    });
  });

  async function withRestoredPropagation(
    run: (recovered: LocalLedgerDatabase, operationId: string, originalTransactions: Transaction[]) => void,
  ): Promise<void> {
    await withIsolatedLedger({}, ({ ledger, directory }) => {
      ledger.createCategoryRecord(customCategory);
      for (const [index, id] of ["source", "first", "second"].entries()) {
        ledger.appendTransactions([{
          id, householdId: "hh-isolated", accountId: "acc-isolated", bookedAtIso: "2026-05-23",
          amountMinor: -(index + 1) * 10000, currencyCode: "NOK", merchantRaw: "Mekonomen Stavanger",
          categorization: {
            status: "unmatched", confidence: 0, confidenceLevel: "low", requiresReview: true, matchingRules: [],
          },
        }]);
      }
      applyCategorizationCorrection(ledger, new Map(), "source", "category-car-001");
      const beforePropagation = ledger.loadLedgerSnapshotData();
      const propagation = ledger.applySameMerchantPropagation({
        sourceTransactionId: "source", merchantAlias: "MEKONOMEN STAVANGER",
        categoryId: "category-car-001", transactionIds: ["first", "second"],
      });
      const snapshotPath = join(directory, "active-propagation.json");
      createBackupSnapshot({
        ...ledger.loadLedgerSnapshotData(), outputPath: snapshotPath, createdAtIso: "2026-06-02T00:00:00Z",
      });
      const recovered = createLocalLedgerDatabase({
        dbPath: join(directory, "active-propagation.sqlite"), seedData: restoreBackupSnapshot({ snapshotPath }),
      });
      try {
        run(recovered, propagation.id, beforePropagation.transactions);
      } finally {
        recovered.close();
      }
    });
  }

  it("restores active propagation undo for unchanged transactions", async () => {
    await withRestoredPropagation((recovered, operationId, originalTransactions) => {
      expect(recovered.undoSameMerchantPropagation(operationId)).toBe(true);
      expect(recovered.loadLedgerSnapshotData().transactions).toEqual(originalTransactions);
      expect(recovered.undoSameMerchantPropagation(operationId)).toBe(false);
    });
  });

  it("restores active propagation undo that atomically protects a later correction", async () => {
    await withRestoredPropagation((recovered, operationId) => {
      applyCategorizationCorrection(recovered, new Map(), "second", "fees");
      const beforeFailure = recovered.loadLedgerSnapshotData();
      expect(() => recovered.undoSameMerchantPropagation(operationId)).toThrow(/changed.*second/i);
      expect(recovered.loadLedgerSnapshotData()).toEqual(beforeFailure);
    });
  });

  it("restores correction and propagation evidence with import undo that protects changed transactions", async () => {
      await withIsolatedLedger({}, ({ ledger, directory }) => {
        ledger.createCategoryRecord(customCategory);
        ledger.appendImportJobAndTransactions({
          id: "import-history", householdId: "hh-isolated", sourceType: "csv", sourceName: "synthetic-history.csv",
          startedAtIso: "2026-05-23T00:00:00Z", finishedAtIso: "2026-05-23T00:00:01Z",
          candidateCount: 2, provenance: { sourceIdentity: "synthetic-history", accountId: "acc-isolated" },
        }, ["source", "target"].map((id, index): Transaction => ({
          id, householdId: "hh-isolated", accountId: "acc-isolated", bookedAtIso: "2026-05-23",
          amountMinor: -(index + 1) * 10000, currencyCode: "NOK", merchantRaw: "Mekonomen Stavanger",
          importJobId: "import-history", sourceType: "csv", sourceReference: `synthetic-history.csv:row-${index + 1}`,
          categorization: {
            status: "unmatched", confidence: 0, confidenceLevel: "low", requiresReview: true, matchingRules: [],
          },
        })));
        applyCategorizationCorrection(ledger, new Map(), "source", "category-car-001");
        const propagation = ledger.applySameMerchantPropagation({
          sourceTransactionId: "source", merchantAlias: "MEKONOMEN STAVANGER",
          categoryId: "category-car-001", transactionIds: ["target"],
        });
        expect(ledger.undoSameMerchantPropagation(propagation.id)).toBe(true);
        ledger.updateCategoryRecordLabel("hh-isolated", "category-car-001", "Vehicle repairs", "2026-06-01T00:00:00Z");
        const original = ledger.loadLedgerSnapshotData();
        const corrections = ledger.listMerchantCorrectionProvenance();
        const propagations = ledger.listSameMerchantPropagationOperations();
        const history = ledger.listImportJobHistory("hh-isolated");
        const snapshotPath = join(directory, "history-recovery.json");
        createBackupSnapshot({ ...original, outputPath: snapshotPath, createdAtIso: "2026-06-02T00:00:00Z" });
        const recovered = createLocalLedgerDatabase({
          dbPath: join(directory, "history-recovered.sqlite"), seedData: restoreBackupSnapshot({ snapshotPath }),
        });
        try {
          expect(recovered.listMerchantCorrectionProvenance()).toEqual(corrections);
          expect(recovered.listSameMerchantPropagationOperations()).toEqual(propagations);
          expect(recovered.listImportJobHistory("hh-isolated")).toEqual(history);
          expect(recovered.undoSameMerchantPropagation(propagation.id)).toBe(false);
          expect(recovered.loadLedgerSnapshotData().transactions).toEqual(original.transactions);
          expect(recovered.undoImportJob("import-history")).toMatchObject({
            removedCount: 1, retainedCount: 1, alreadyUndone: false,
            retainedTransactions: [{ id: "source", reason: "changed-after-import" }],
          });
          expect(recovered.getTransactionById("source")).toMatchObject({
            amountMinor: -10000, categoryId: "category-car-001",
          });
          expect(recovered.getTransactionById("target")).toBeUndefined();
          expect(recovered.listMerchantCategoryRules()).toEqual(original.merchantCategoryRules);
          const undoneHistory = recovered.listImportJobHistory("hh-isolated");
          const secondSnapshotPath = join(directory, "undone-history.json");
          createBackupSnapshot({
            ...recovered.loadLedgerSnapshotData(), outputPath: secondSnapshotPath, createdAtIso: "2026-06-03T00:00:00Z",
          });
          const reopened = createLocalLedgerDatabase({
            dbPath: join(directory, "undone-history-recovered.sqlite"),
            seedData: restoreBackupSnapshot({ snapshotPath: secondSnapshotPath }),
          });
          try {
            expect(reopened.listImportJobHistory("hh-isolated")).toEqual(undoneHistory);
            expect(reopened.undoImportJob("import-history")).toMatchObject({
              removedCount: 1, retainedCount: 1, alreadyUndone: true,
            });
            expect(reopened.getTransactionById("source")?.amountMinor).toBe(-10000);
          } finally {
            reopened.close();
          }
        } finally {
          recovered.close();
        }
      });
  });

  it.each([
    { id: "category-car-001", label: "  HEALTH ", timestamp: "2026-06-01T00:00:00Z", error: /already exists/i },
    { id: "category-car-001", label: "", timestamp: "2026-06-01T00:00:00Z", error: /non-empty string/i },
    { id: "missing", label: "Repairs", timestamp: "2026-06-01T00:00:00Z", error: /category.*not found/i },
    { id: "", label: "Repairs", timestamp: "2026-06-01T00:00:00Z", error: /category.*not found/i },
    { id: "category-car-001", label: "Repairs", timestamp: "not-a-date", error: /timestamp/i },
  ])("leaves the saved category unchanged after a rejected rename: $id / $label", async ({ id, label, timestamp, error }) => {
    await withIsolatedLedger({}, ({ ledger }) => {
      ledger.createCategoryRecord(customCategory);
      expect(() => ledger.updateCategoryRecordLabel("hh-isolated", id, label, timestamp)).toThrow(error);
      expect(ledger.listCategories("hh-isolated").find((category) => category.id === "category-car-001"))
        .toMatchObject({ label: "Car repairs", updatedAtIso: "2026-05-01T00:00:00.000Z" });
    });
  });

  it("surfaces a failed rename and releases its transaction for the next connection", async () => {
    await withIsolatedLedger({}, ({ ledger, dbPath }) => {
      ledger.createCategoryRecord(customCategory);
      const raw = new DatabaseSync(dbPath);
      try {
        raw.exec(`CREATE TRIGGER reject_category_rename BEFORE UPDATE ON categories
          BEGIN SELECT RAISE(ABORT, 'synthetic category rename fault'); END;`);
      } finally {
        raw.close();
      }
      expect(() => ledger.updateCategoryRecordLabel(
        "hh-isolated", "category-car-001", "Repairs", "2026-06-01T00:00:00.000Z",
      )).toThrow("synthetic category rename fault");
      const reopened = createLocalLedgerDatabase({ dbPath });
      try {
        expect(reopened.listCategories("hh-isolated").find((category) => category.id === "category-car-001"))
          .toMatchObject({ label: "Car repairs", updatedAtIso: "2026-05-01T00:00:00.000Z" });
      } finally {
        reopened.close();
      }
    });
  });

  it("includes custom and renamed categories in a serialized backup and recovery", async () => {
    await withIsolatedLedger({}, ({ ledger, directory }) => {
      ledger.createCategoryRecord(customCategory);
      ledger.updateCategoryRecordLabel("hh-isolated", "groceries", "Food", "2026-06-01T00:00:00.000Z");
      const snapshotPath = join(directory, "categories.json");
      createBackupSnapshot({
        ...ledger.loadLedgerSnapshotData(), outputPath: snapshotPath,
        createdAtIso: "2026-06-02T00:00:00.000Z",
      });
      const recovered = restoreBackupSnapshot({ snapshotPath });
      expect(recovered.categories).toEqual(expect.arrayContaining([
        {
          id: "category-car-001", householdId: "hh-isolated", label: "Car repairs",
          createdAtIso: "2026-05-01T00:00:00.000Z", updatedAtIso: "2026-05-01T00:00:00.000Z",
        },
        expect.objectContaining({ id: "groceries", label: "Food", updatedAtIso: "2026-06-01T00:00:00.000Z" }),
      ]));
      const recoveredLedger = createLocalLedgerDatabase({
        dbPath: join(directory, "recovered.sqlite"), seedData: recovered,
      });
      try {
        expect(recoveredLedger.listCategories("hh-isolated")).toEqual(ledger.listCategories("hh-isolated"));
      } finally {
        recoveredLedger.close();
      }
    });
  });

  it("replaces ledger data without losing the current catalog or leaving foreign-key failures", async () => {
    await withIsolatedLedger({}, ({ ledger, dbPath }) => {
      ledger.createCategoryRecord(customCategory);
      ledger.updateCategoryRecordLabel("hh-isolated", "groceries", "Food", "2026-06-01T00:00:00.000Z");
      const categories = ledger.listCategories("hh-isolated");
      const snapshot = ledger.loadLedgerSnapshotData();
      expect(() => ledger.replaceLedgerSnapshotData(snapshot)).not.toThrow();
      const reopened = createLocalLedgerDatabase({ dbPath });
      try {
        expect(reopened.listCategories("hh-isolated")).toEqual(categories);
      } finally {
        reopened.close();
      }
    });
  });

  it.each([
    { name: "missing collection", categories: undefined },
    { name: "non-array collection", categories: "invalid" },
    { name: "non-record entry", categories: ["invalid"] },
    { name: "blank name", categories: [{ ...customCategory, label: " " }] },
    { name: "invalid creation time", categories: [{ ...customCategory, createdAtIso: "not-a-date" }] },
    { name: "invalid update time", categories: [{ ...customCategory, updatedAtIso: "2026-05-01" }] },
    { name: "foreign household", categories: [{ ...customCategory, householdId: "another-household" }] },
    { name: "duplicate ID", categories: [customCategory, { ...customCategory, label: "Fuel repairs" }] },
    { name: "equivalent names", categories: [customCategory, { ...customCategory, id: "category-other", label: "CAR repairs" }] },
  ])("rejects a malformed version-13 catalog before recovery: $name", async ({ categories }) => {
    await withIsolatedLedger({}, ({ ledger, directory }) => {
      const snapshotPath = join(directory, "invalid-categories.json");
      const snapshot = buildBackupSnapshot(ledger.loadLedgerSnapshotData());
      writeFileSync(snapshotPath, JSON.stringify({
        ...snapshot, metadata: { ...snapshot.metadata, version: "13" }, categories,
      }), "utf8");
      expect(() => restoreBackupSnapshot({ snapshotPath })).toThrow(/Invalid snapshot categories/i);
    });
  });

  it.each([
    { name: "negative operation count", candidateCount: -1, householdId: "hh-isolated" },
    { name: "foreign undo baseline", candidateCount: 1, householdId: "foreign-household" },
  ])("rejects malformed current-format recovery history: $name", async ({ candidateCount, householdId }) => {
    await withIsolatedLedger({}, ({ ledger, directory }) => {
      ledger.appendImportJob({
        id: "archive", householdId: "hh-isolated", sourceType: "csv", sourceName: "synthetic-history.csv",
        startedAtIso: "2026-05-23T00:00:00Z",
      });
      const snapshotPath = join(directory, "invalid-history.json");
      writeFileSync(snapshotPath, JSON.stringify({
        ...buildBackupSnapshot(ledger.loadLedgerSnapshotData()),
        recoveryHistory: {
          merchantCorrections: [], sameMerchantPropagations: [],
          importOperations: [{
            importJobId: "archive", accountId: "acc-isolated", candidateCount, importedCount: 1, duplicateCount: 0,
            undoAvailable: true, undoRemovedCount: 0, undoRetainedCount: 0,
            transactionBaselines: [{
              transactionId: "archived-row",
              serializedTransaction: JSON.stringify({
                id: "archived-row", householdId, accountId: "acc-isolated", bookedAtIso: "2026-05-23",
                amountMinor: -10000, merchantRaw: "Synthetic workshop", currencyCode: "NOK", sourceType: "csv",
                sourceReference: "synthetic-history.csv:row-1", categoryId: null, categoryAllocations: null,
                importJobId: "archive",
              }),
            }],
          }],
        },
      }), "utf8");
      expect(() => restoreBackupSnapshot({ snapshotPath })).toThrow(/recovery history/i);
    });
  });

  it("rejects a current snapshot whose financial category reference is missing from its catalog", async () => {
    await withIsolatedLedger({}, ({ ledger, directory }) => {
      const snapshotPath = join(directory, "missing-category-reference.json");
      const snapshot = buildBackupSnapshot(ledger.loadLedgerSnapshotData());
      writeFileSync(snapshotPath, JSON.stringify({
        ...snapshot,
        metadata: { ...snapshot.metadata, version: "13", transactionCount: 1 },
        transactions: [{
          id: "tx-missing", householdId: "hh-isolated", accountId: "acc-isolated",
          bookedAtIso: "2026-05-01", amountMinor: -1000, merchantRaw: "Synthetic workshop",
          categoryId: "missing-category",
        }],
      }), "utf8");
      expect(() => restoreBackupSnapshot({ snapshotPath })).toThrow(/Invalid snapshot categories/i);
    });
  });

  it("recovers signed allocations that use persisted custom categories", async () => {
    await withIsolatedLedger({}, ({ ledger, directory }) => {
      ledger.createCategoryRecord(customCategory);
      const snapshotPath = join(directory, "custom-allocations.json");
      const snapshot = buildBackupSnapshot({
        ...ledger.loadLedgerSnapshotData(),
        transactions: [{
          id: "tx-split", householdId: "hh-isolated", accountId: "acc-isolated",
          bookedAtIso: "2026-05-01", amountMinor: -15000, currencyCode: "NOK",
          merchantRaw: "Synthetic workshop",
          categoryAllocations: [
            { categoryId: "category-car-001", amountMinor: -10000 },
            { categoryId: "health", amountMinor: -5000 },
          ],
        }],
      });
      writeFileSync(snapshotPath, JSON.stringify(snapshot), "utf8");
      expect(() => restoreBackupSnapshot({ snapshotPath })).not.toThrow();
      expect(restoreBackupSnapshot({ snapshotPath }).transactions[0]?.categoryAllocations).toEqual([
        { categoryId: "category-car-001", amountMinor: -10000 },
        { categoryId: "health", amountMinor: -5000 },
      ]);
      let recoveredAllocations: Transaction["categoryAllocations"];
      expect(() => {
        const recoveredLedger = createLocalLedgerDatabase({
          dbPath: join(directory, "recovered-allocations.sqlite"),
          seedData: restoreBackupSnapshot({ snapshotPath }),
        });
        try {
          recoveredAllocations = recoveredLedger.getTransactionById("tx-split")?.categoryAllocations;
        } finally {
          recoveredLedger.close();
        }
      }).not.toThrow();
      expect(recoveredAllocations).toEqual([
        { categoryId: "category-car-001", amountMinor: -10000 },
        { categoryId: "health", amountMinor: -5000 },
      ]);
    });
  });

  it("uses the persisted catalog consistently for split writes, updates, and ledger reads", async () => {
    await withIsolatedLedger({}, ({ ledger }) => {
      ledger.createCategoryRecord(customCategory);
      const allocations = [
        { categoryId: "category-car-001", amountMinor: -10000 },
        { categoryId: "health", amountMinor: -5000 },
      ];
      expect(() => ledger.appendTransactions([{
        id: "tx-current-split", householdId: "hh-isolated", accountId: "acc-isolated",
        bookedAtIso: "2026-05-23", amountMinor: -15000, currencyCode: "NOK",
        merchantRaw: "Synthetic workshop", categoryAllocations: allocations,
      }])).not.toThrow();
      expect(ledger.getTransactionById("tx-current-split")?.categoryAllocations).toEqual(allocations);
      expect(ledger.getTransactionsForMonth("hh-isolated", "2026-05")[0]?.categoryAllocations).toEqual(allocations);
      expect(ledger.getTransactionsForDateRange("hh-isolated", "2026-05-01", "2026-06-01")[0]?.categoryAllocations)
        .toEqual(allocations);
      expect(ledger.getTransactionsForAccount("acc-isolated")[0]?.categoryAllocations).toEqual(allocations);
      expect(ledger.queryTransactions("hh-isolated", {}).transactions[0]?.categoryAllocations).toEqual(allocations);
      expect(ledger.loadLedgerSnapshotData().transactions[0]?.categoryAllocations).toEqual(allocations);
      expect(() => ledger.updateTransactionCategoryAllocations("tx-current-split", [
        { categoryId: "category-car-001", amountMinor: -8000 },
        { categoryId: "health", amountMinor: -7000 },
      ])).not.toThrow();
      expect(ledger.getTransactionById("tx-current-split")?.categoryAllocations).toEqual([
        { categoryId: "category-car-001", amountMinor: -8000 },
        { categoryId: "health", amountMinor: -7000 },
      ]);
    });
  });

  it("rejects saved undo baselines whose import operation is missing instead of dropping recovery evidence", async () => {
    await withIsolatedLedger({}, ({ ledger, dbPath }) => {
      ledger.appendImportJobAndTransactions({
        id: "orphan-history", householdId: "hh-isolated", sourceType: "csv",
        sourceName: "synthetic.csv", startedAtIso: "2026-05-01T00:00:00Z",
      }, [{
        id: "orphan-transaction", householdId: "hh-isolated", accountId: "acc-isolated",
        bookedAtIso: "2026-05-01", amountMinor: -1250, merchantRaw: "Synthetic Kiwi",
        currencyCode: "NOK", sourceType: "csv", importJobId: "orphan-history",
      }]);
      const original = ledger.getTransactionsForAccount("acc-isolated");
      const raw = new DatabaseSync(dbPath);
      try {
        raw.exec("DELETE FROM import_job_operations");
        expect(() => ledger.loadLedgerSnapshotData()).toThrow(/baseline.*operation/i);
        expect(ledger.getTransactionsForAccount("acc-isolated")).toEqual(original);
      } finally {
        raw.close();
      }
    });
  });

  it("conserves 10,000 synthetic transactions across rename, restart, and backup recovery", async () => {
    await withIsolatedLedger({ seed: {
      household: { id: "hh-isolated", name: "Synthetic household", createdAtIso: "2026-01-01T00:00:00Z" },
      accounts: [
        { id: "acc-isolated", householdId: "hh-isolated", name: "Brukskonto", currencyCode: "NOK" },
        { id: "acc-sek", householdId: "hh-isolated", name: "Sparekonto", currencyCode: "SEK" },
      ],
      transactions: [], importJobs: [], monthlyCategoryTargets: [],
    } }, ({ ledger, directory, dbPath }) => {
      ledger.createCategoryRecord(customCategory);
      const transactions: Transaction[] = Array.from({ length: 10_000 }, (_, index) => ({
        id: `tx-${String(index).padStart(5, "0")}`,
        householdId: "hh-isolated",
        accountId: index % 4 < 2 ? "acc-isolated" : "acc-sek",
        bookedAtIso: `2026-05-${String(index % 28 + 1).padStart(2, "0")}`,
        currencyCode: index % 4 < 2 ? "NOK" : "SEK",
        sourceType: "csv",
        importJobId: index % 4 < 2 ? "import-nok" : "import-sek",
        sourceReference: `synthetic-statement:row-${index}`,
        ...(index % 2 === 0 ? {
          merchantRaw: "Mekonomen Stavanger",
          amountMinor: index % 4 === 0 ? -10000 : -30000,
          ...(index % 4 === 0 ? { categoryAllocations: [
            { categoryId: "category-car-001", amountMinor: -8000 },
            { categoryId: "fees", amountMinor: -2000 },
          ] } : { categoryId: "category-car-001" }),
          categorization: {
            status: "categorized", confidence: 0.9, confidenceLevel: "high", requiresReview: false,
            selectedRule: {
              ruleId: "rule-car", merchantAlias: "MEKONOMEN STAVANGER", categoryId: "category-car-001", priority: 0,
            },
            matchingRules: [{
              ruleId: "rule-car", merchantAlias: "MEKONOMEN STAVANGER", categoryId: "category-car-001", priority: 0,
            }],
          },
        } : {
          merchantRaw: "Arbeidsgiver AS",
          amountMinor: index % 4 === 1 ? 20000 : 40000,
          categoryId: "salary",
        }),
      }));
      for (const [accountId, importJobId] of [["acc-isolated", "import-nok"], ["acc-sek", "import-sek"]] as const) {
        expect(ledger.appendImportJobAndTransactions({
          id: importJobId, householdId: "hh-isolated", sourceType: "csv", sourceName: `${importJobId}.csv`,
          startedAtIso: "2026-05-31T00:00:00Z", finishedAtIso: "2026-05-31T00:00:01Z",
          candidateCount: 5000, provenance: { sourceIdentity: importJobId, accountId },
        }, transactions.filter((transaction) => transaction.accountId === accountId))).toBe(5000);
      }
      ledger.upsertMonthlyCategoryTarget({
        yearMonth: "2026-05", categoryId: "category-car-001", targetMinor: 40_000_000,
      });
      ledger.upsertMerchantCategoryRule({ merchantAlias: "MEKONOMEN STAVANGER", categoryId: "category-car-001" });
      ledger.upsertMerchantCategoryRule({ merchantAlias: "ARBEIDSGIVER AS", categoryId: "salary" });
      const before = ledger.loadLedgerSnapshotData();
      const baselines = importBaselines(dbPath);
      const history = ledger.listImportJobHistory("hh-isolated");
      expect(baselines).toHaveLength(10_000);
      expect(before.transactions).toEqual(transactions);
      const archivePath = join(directory, "large-before-rename.json");
      createBackupSnapshot({ ...before, outputPath: archivePath, createdAtIso: "2026-05-31T00:00:00Z" });
      const archivedBytes = readFileSync(archivePath, "utf8");

      function assertConserved(database: LocalLedgerDatabase, databasePath: string): void {
        const { categories, ...data } = database.loadLedgerSnapshotData();
        const { categories: originalCategories, ...originalData } = before;
        expect(data).toEqual(originalData);
        expect(data.transactions).toHaveLength(10_000);
        expect(categories?.slice().sort((left, right) => left.id.localeCompare(right.id)))
          .toEqual(originalCategories?.map((category) => category.id === "category-car-001" ? {
            ...category, label: "Vehicle maintenance", updatedAtIso: "2026-06-01T00:00:00.000Z",
          } : category).sort((left, right) => left.id.localeCompare(right.id)));
        expect(categories).toHaveLength(15);
        for (const [accountId, currency] of [["acc-isolated", "NOK"], ["acc-sek", "SEK"]] as const) {
          const records = database.getTransactionsForAccount(accountId);
          expect(records).toHaveLength(5000);
          expect(new Set(records.map(({ currencyCode }) => currencyCode))).toEqual(new Set([currency]));
          expect(records.reduce((sum, { amountMinor }) => sum + amountMinor, 0)).toBe(25_000_000);
        }
        expect(database.queryTransactions("hh-isolated", { categoryId: "category-car-001" }).totalCount).toBe(5000);
        expect(database.listImportJobHistory("hh-isolated")).toEqual(history);
        expect(importBaselines(databasePath)).toEqual(baselines);
        expect(readFileSync(archivePath, "utf8")).toBe(archivedBytes);
      }
      ledger.updateCategoryRecordLabel(
        "hh-isolated", "category-car-001", "Vehicle maintenance", "2026-06-01T00:00:00.000Z",
      );
      assertConserved(ledger, dbPath);
      const reopened = createLocalLedgerDatabase({ dbPath });
      try {
        assertConserved(reopened, dbPath);
        const snapshot = reopened.loadLedgerSnapshotData();
        const snapshotPath = join(directory, "large-catalog.json");
        createBackupSnapshot({ ...snapshot, outputPath: snapshotPath, createdAtIso: "2026-06-02T00:00:00.000Z" });
        const recovered = createLocalLedgerDatabase({
          dbPath: join(directory, "large-recovered.sqlite"), seedData: restoreBackupSnapshot({ snapshotPath }),
        });
        try {
          assertConserved(recovered, join(directory, "large-recovered.sqlite"));
          const recoveredSnapshot = recovered.loadLedgerSnapshotData();
          expect(recoveredSnapshot.monthlyCategoryTargets).toEqual([{
            yearMonth: "2026-05", categoryId: "category-car-001", targetMinor: 40_000_000,
          }]);
          expect(recoveredSnapshot.merchantCategoryRules).toEqual(before.merchantCategoryRules);
          expect(recovered.listCategories("hh-isolated").find((category) => category.id === "category-car-001"))
            .toMatchObject({
              label: "Vehicle maintenance", createdAtIso: "2026-05-01T00:00:00.000Z",
              updatedAtIso: "2026-06-01T00:00:00.000Z",
            });
          expect(recovered.undoImportJob("import-nok")).toMatchObject({
            removedCount: 5000, retainedCount: 0, retainedTransactions: [],
          });
          expect(recovered.getTransactionsForAccount("acc-isolated")).toEqual([]);
          expect(recovered.loadLedgerSnapshotData().transactions)
            .toEqual(before.transactions.filter((transaction) => transaction.accountId === "acc-sek"));
        } finally {
          recovered.close();
        }
        const reopenedAgain = createLocalLedgerDatabase({ dbPath });
        try {
          assertConserved(reopenedAgain, dbPath);
        } finally {
          reopenedAgain.close();
        }
      } finally {
        reopened.close();
      }
    });
  });

  it("reopens the saved catalog without inspecting unrelated archived evidence", async () => {
    await withIsolatedLedger({}, ({ ledger, dbPath }) => {
      ledger.createCategoryRecord(customCategory);
      const categories = ledger.listCategories("hh-isolated");
      const raw = new DatabaseSync(dbPath);
      try {
        raw.prepare(`INSERT INTO merchant_correction_provenance (
          id, source_transaction_id, merchant_alias, category_id, corrected_at_iso, original_categorization_json
        ) VALUES (?, ?, ?, ?, ?, ?)`).run(
          "archived-correction", "deleted-source", "SYNTHETIC SHOP", "category-car-001",
          "2026-05-02T00:00:00Z", "not-json",
        );
      } finally {
        raw.close();
      }
      expect(() => {
        const reopened = createLocalLedgerDatabase({ dbPath });
        try {
          expect(reopened.listCategories("hh-isolated")).toEqual(categories);
        } finally {
          reopened.close();
        }
      }).not.toThrow();
    });
  });

});

describe("category management service", () => {
  it("creates and persists a normalized category using main-owned identity and time", async () => {
    await withIsolatedLedger({}, ({ ledger }) => {
      const service = createCategoryManagementService(ledger, {
        createId: () => "category-service-001",
        now: () => new Date("2026-05-01T00:00:00.000Z"),
      });
      let created: Category | undefined;
      expect(() => {
        created = service.create({ label: "  Car \t repairs  " });
      }).not.toThrow();
      expect(created).toEqual({
        id: "category-service-001",
        householdId: "hh-isolated",
        label: "Car repairs",
        createdAtIso: "2026-05-01T00:00:00.000Z",
        updatedAtIso: "2026-05-01T00:00:00.000Z",
      });
      expect(service.list()).toContainEqual(created);
    });
  });

  it("returns the persisted renamed record without changing its identity or creation time", async () => {
    await withIsolatedLedger({}, ({ ledger }) => {
      ledger.createCategoryRecord(customCategory);
      const service = createCategoryManagementService(ledger, {
        now: () => new Date("2026-06-01T00:00:00.000Z"),
      });
      let renamed: Category | undefined;
      expect(() => {
        renamed = service.rename({ categoryId: "category-car-001", label: " Vehicle \t maintenance " });
      }).not.toThrow();
      expect(renamed).toEqual({
        ...customCategory,
        label: "Vehicle maintenance",
        updatedAtIso: "2026-06-01T00:00:00.000Z",
      });
      expect(ledger.listCategories("hh-isolated")).toContainEqual(renamed);
    });
  });

  it("uses the current household after replacement rather than retaining startup state", async () => {
    await withIsolatedLedger({}, ({ ledger }) => {
      const service = createCategoryManagementService(ledger, {
        createId: () => "category-service-001",
        now: () => new Date("2026-05-01T00:00:00.000Z"),
      });
      expect(() => service.create({ label: "Original household category" })).not.toThrow();
      const snapshot = ledger.loadLedgerSnapshotData();
      ledger.replaceLedgerSnapshotData({
        ...snapshot,
        household: { ...snapshot.household, id: "hh-replaced" },
        accounts: snapshot.accounts.map((account) => ({ ...account, householdId: "hh-replaced" })),
        categories: [],
      });
      expect(service.list()).toContainEqual(expect.objectContaining({
        id: "groceries", householdId: "hh-replaced",
      }));
      expect(service.create({ label: "Replacement household category" })).toMatchObject({
        id: "category-service-001", householdId: "hh-replaced", label: "Replacement household category",
      });
      expect(ledger.listCategories("hh-replaced")).toContainEqual(expect.objectContaining({
        id: "category-service-001", label: "Replacement household category",
      }));
    });
  });

  it("explicitly rejects category operations before household setup", async () => {
    await withIsolatedLedger({}, ({ directory }) => {
      const emptyLedger = createLocalLedgerDatabase({ dbPath: join(directory, "no-household.sqlite") });
      try {
        const service = createCategoryManagementService(emptyLedger);
        expect(() => service.list()).toThrow(/household.*not available/i);
        expect(() => service.create({ label: "Car repairs" })).toThrow(/household.*not available/i);
        expect(() => service.rename({ categoryId: "groceries", label: "Food" }))
          .toThrow(/household.*not available/i);
      } finally {
        emptyLedger.close();
      }
    });
  });
});
