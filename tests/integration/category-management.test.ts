import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { buildBackupSnapshot, createBackupSnapshot } from "../../src/app/backup/createBackupSnapshot.js";
import { restoreBackupSnapshot } from "../../src/app/backup/restoreBackupSnapshot.js";
import { describe, expect, it } from "vitest";
import { createLocalLedgerDatabase } from "../../src/app/backup/localLedgerSqlite.js";
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
    await withIsolatedLedger({}, ({ ledger, dbPath }) => {
      ledger.createCategoryRecord(customCategory);
      ledger.appendTransactions([{
        id: "tx-car", householdId: "hh-isolated", accountId: "acc-isolated",
        bookedAtIso: "2026-05-23", amountMinor: -24900, currencyCode: "NOK",
        merchantRaw: "Mekonomen Stavanger", categoryId: "category-car-001",
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
      }]);
      ledger.upsertMonthlyCategoryTarget({
        yearMonth: "2026-05", categoryId: "category-car-001", targetMinor: 50000,
      });
      ledger.upsertMerchantCategoryRule({
        merchantAlias: "MEKONOMEN STAVANGER", categoryId: "category-car-001",
      });
      const before = ledger.loadLedgerSnapshotData();
      ledger.updateCategoryRecordLabel(
        "hh-isolated", "category-car-001", "  Vehicle   repairs ", "2026-06-01T00:00:00.000Z",
      );
      const after = ledger.loadLedgerSnapshotData();
      expect(after.transactions).toEqual(before.transactions);
      expect(after.monthlyCategoryTargets).toEqual(before.monthlyCategoryTargets);
      expect(after.merchantCategoryRules).toEqual(before.merchantCategoryRules);
      const reopened = createLocalLedgerDatabase({ dbPath });
      try {
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

  it("conserves 10,000 synthetic transactions across rename, restart, and backup recovery", async () => {
    await withIsolatedLedger({}, ({ ledger, directory, dbPath }) => {
      ledger.createCategoryRecord(customCategory);
      const transactions: Transaction[] = Array.from({ length: 10_000 }, (_, index) => ({
        id: `tx-${String(index).padStart(5, "0")}`,
        householdId: "hh-isolated",
        accountId: "acc-isolated",
        bookedAtIso: `2026-05-${String(index % 28 + 1).padStart(2, "0")}`,
        currencyCode: "NOK",
        ...(index % 2 === 0 ? {
          merchantRaw: "Mekonomen Stavanger",
          amountMinor: -10000,
          categoryAllocations: [
            { categoryId: "category-car-001", amountMinor: -8000 },
            { categoryId: "fees", amountMinor: -2000 },
          ],
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
          amountMinor: 20000,
          categoryId: "salary",
        }),
      }));
      expect(ledger.appendTransactions(transactions)).toBe(10_000);
      ledger.upsertMonthlyCategoryTarget({
        yearMonth: "2026-05", categoryId: "category-car-001", targetMinor: 40_000_000,
      });
      ledger.upsertMerchantCategoryRule({ merchantAlias: "MEKONOMEN STAVANGER", categoryId: "category-car-001" });
      ledger.updateCategoryRecordLabel(
        "hh-isolated", "category-car-001", "Vehicle maintenance", "2026-06-01T00:00:00.000Z",
      );
      const reopened = createLocalLedgerDatabase({ dbPath });
      try {
        const snapshot = reopened.loadLedgerSnapshotData();
        expect(snapshot.transactions).toEqual(transactions);
        expect(reopened.queryTransactions("hh-isolated", { categoryId: "category-car-001" }).totalCount).toBe(5000);
        const snapshotPath = join(directory, "large-catalog.json");
        createBackupSnapshot({ ...snapshot, outputPath: snapshotPath, createdAtIso: "2026-06-02T00:00:00.000Z" });
        const recovered = createLocalLedgerDatabase({
          dbPath: join(directory, "large-recovered.sqlite"), seedData: restoreBackupSnapshot({ snapshotPath }),
        });
        try {
          const recoveredSnapshot = recovered.loadLedgerSnapshotData();
          expect(recoveredSnapshot.transactions).toEqual(transactions);
          expect(recovered.listMonthlyTotals("hh-isolated")).toEqual([{
            yearMonth: "2026-05", totalMinor: 50_000_000,
          }]);
          expect(recoveredSnapshot.monthlyCategoryTargets).toEqual([{
            yearMonth: "2026-05", categoryId: "category-car-001", targetMinor: 40_000_000,
          }]);
          expect(recoveredSnapshot.merchantCategoryRules).toEqual([{
            merchantAlias: "MEKONOMEN STAVANGER", categoryId: "category-car-001",
          }]);
          expect(recovered.listCategories("hh-isolated").find((category) => category.id === "category-car-001"))
            .toMatchObject({
              label: "Vehicle maintenance", createdAtIso: "2026-05-01T00:00:00.000Z",
              updatedAtIso: "2026-06-01T00:00:00.000Z",
            });
        } finally {
          recovered.close();
        }
      } finally {
        reopened.close();
      }
    });
  });

  it("backfills unregistered current and archived category IDs without rewriting their evidence", async () => {
    await withIsolatedLedger({}, ({ dbPath }) => {
      const originalEvidence = JSON.stringify({ categoryId: "legacy-evidence" });
      const correctionEvidence = JSON.stringify({ categoryId: "legacy-correction-evidence" });
      const baseline = JSON.stringify({ householdId: "hh-isolated", categoryId: "legacy-baseline" });
      const raw = new DatabaseSync(dbPath);
      try {
        raw.exec("DROP TABLE categories");
        raw.prepare(`INSERT INTO transactions (
          id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw,
          category_id, category_allocations_json, categorization_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          "legacy-tx", "hh-isolated", "acc-isolated", "2026-05-01", -10000, "Synthetic workshop",
          "legacy-current", JSON.stringify([
            { categoryId: "legacy-split", amountMinor: -7500 },
            { categoryId: "legacy-fees", amountMinor: -2500 },
          ]), originalEvidence,
        );
        raw.prepare("INSERT INTO monthly_category_targets VALUES (?, ?, ?)").run("2026-05", "legacy-target", 50000);
        raw.prepare("INSERT INTO merchant_category_rules VALUES (?, ?)").run("SYNTHETIC WORKSHOP", "legacy-rule-target");
        raw.prepare(`INSERT INTO merchant_correction_provenance (
          id, source_transaction_id, merchant_alias, category_id, corrected_at_iso, original_categorization_json
        ) VALUES (?, ?, ?, ?, ?, ?)`).run(
          "legacy-correction-record", "deleted-source", "SYNTHETIC SHOP", "legacy-correction",
          "2026-05-02T00:00:00Z", correctionEvidence,
        );
        raw.prepare(`INSERT INTO same_merchant_propagation_operations (
          id, source_transaction_id, merchant_alias, category_id, applied_at_iso, undone_at_iso
        ) VALUES (?, ?, ?, ?, ?, ?)`).run(
          "legacy-operation", "deleted-source", "SYNTHETIC SHOP", "legacy-operation-category",
          "2026-05-02T00:00:00Z", "2026-05-03T00:00:00Z",
        );
        raw.prepare(`INSERT INTO same_merchant_propagation_changes (
          operation_id, transaction_id, before_category_id, after_category_id,
          before_categorization_json, after_categorization_json
        ) VALUES (?, ?, ?, ?, ?, ?)`).run(
          "legacy-operation", "deleted-source", "legacy-before", "legacy-after",
          JSON.stringify({ categoryId: "legacy-before-evidence" }),
          JSON.stringify({ categoryId: "legacy-after-evidence" }),
        );
        raw.prepare("INSERT INTO import_job_transaction_baselines VALUES (?, ?, ?)")
          .run("deleted-import", "deleted-source", baseline);
        raw.prepare("INSERT INTO saved_ledger_views VALUES (?, ?, ?)")
          .run("legacy-view", "Synthetic legacy filter", JSON.stringify({ categoryId: "legacy-filter" }));
      } finally {
        raw.close();
      }
      const reopened = createLocalLedgerDatabase({ dbPath });
      try {
        expect(reopened.listCategories("hh-isolated").map((category) => category.id)).toEqual(expect.arrayContaining([
          "legacy-current", "legacy-split", "legacy-fees", "legacy-evidence", "legacy-target", "legacy-rule-target",
          "legacy-correction", "legacy-correction-evidence", "legacy-operation-category", "legacy-before",
          "legacy-after", "legacy-before-evidence", "legacy-after-evidence", "legacy-baseline", "legacy-filter",
        ]));
        expect(reopened.getTransactionById("legacy-tx")).toMatchObject({
          categoryId: "legacy-current", amountMinor: -10000,
          categoryAllocations: [
            { categoryId: "legacy-split", amountMinor: -7500 },
            { categoryId: "legacy-fees", amountMinor: -2500 },
          ],
        });
        const evidence = new DatabaseSync(dbPath);
        try {
          expect(evidence.prepare("SELECT categorization_json FROM transactions WHERE id = ?")
            .get("legacy-tx")?.categorization_json).toBe(originalEvidence);
          expect(evidence.prepare("SELECT original_categorization_json FROM merchant_correction_provenance WHERE id = ?")
            .get("legacy-correction-record")?.original_categorization_json).toBe(correctionEvidence);
          expect(evidence.prepare("SELECT baseline_json FROM import_job_transaction_baselines WHERE transaction_id = ?")
            .get("deleted-source")?.baseline_json).toBe(baseline);
        } finally {
          evidence.close();
        }
      } finally {
        reopened.close();
      }
    });
  });

  it("reports invalid stored category evidence without seeding a partial catalog", async () => {
    await withIsolatedLedger({}, ({ dbPath }) => {
      const raw = new DatabaseSync(dbPath);
      try {
        raw.exec("DROP TABLE categories");
        raw.prepare(`INSERT INTO transactions (
          id, household_id, account_id, booked_at_iso, amount_minor, merchant_raw, categorization_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
          "invalid-evidence", "hh-isolated", "acc-isolated", "2026-05-01", -1000, "Synthetic workshop", "not-json",
        );
      } finally {
        raw.close();
      }
      expect(() => {
        const reopened = createLocalLedgerDatabase({ dbPath });
        reopened.close();
      }).toThrow(/stored category evidence/i);
      const evidence = new DatabaseSync(dbPath);
      try {
        expect(evidence.prepare("SELECT COUNT(*) AS count FROM categories").get()?.count).toBe(0);
        expect(evidence.prepare("SELECT amount_minor FROM transactions WHERE id = ?")
          .get("invalid-evidence")?.amount_minor).toBe(-1000);
      } finally {
        evidence.close();
      }
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
