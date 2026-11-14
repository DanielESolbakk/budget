import { DatabaseSync } from "node:sqlite";
import {
  collectCategoryReferenceIds,
  normalizeCategoryName,
  seedCategoryCatalog,
  validateCategoryName,
  validateCategoryRecord,
} from "../../domain/categorization/categoryCatalog.js";
import type { Category, Household } from "../../domain/types.js";
import type { LocalLedgerDatabase } from "./localLedgerContracts.js";

type CategoryRepository = Pick<LocalLedgerDatabase,
  "listCategories" | "createCategoryRecord" | "updateCategoryRecordLabel"
> & {
  seedCategories: (household: Household, categories?: readonly Category[], referencedCategoryIds?: readonly string[]) => void;
};

export function createCategoryRepository(db: DatabaseSync): CategoryRepository {
  function listCategories(householdId: string): Category[] {
    if (householdId.trim().length === 0) {
      throw new Error("Household ID is required.");
    }
    if (db.prepare("SELECT id FROM households WHERE id = ?").get(householdId) === undefined) {
      throw new Error(`Household not found: ${householdId}`);
    }
    const rows = db.prepare(`
      SELECT id, household_id, label, created_at_iso, updated_at_iso
      FROM categories
      WHERE household_id = ?
      ORDER BY normalized_label, id
    `).all(householdId);
    return rows.map((row) => {
      if (typeof row.id !== "string" || typeof row.household_id !== "string" ||
        typeof row.label !== "string" || typeof row.created_at_iso !== "string" ||
        typeof row.updated_at_iso !== "string") {
        throw new Error("Stored category record is invalid.");
      }
      return validateCategoryRecord({
        id: row.id,
        householdId: row.household_id,
        label: row.label,
        createdAtIso: row.created_at_iso,
        updatedAtIso: row.updated_at_iso,
      });
    });
  }

  function seedCategories(
    household: Household,
    existingCategories: readonly Category[] = listCategories(household.id),
    referencedCategoryIds: readonly string[] = [],
  ): void {
    const categories = seedCategoryCatalog({
      householdId: household.id,
      categories: existingCategories,
      referencedCategoryIds: [...storedCategoryReferenceIds(household.id), ...referencedCategoryIds],
      createdAtIso: new Date().toISOString(),
    });
    const insertCategory = db.prepare(`
      INSERT INTO categories (id, household_id, label, normalized_label, created_at_iso, updated_at_iso)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(household_id, id) DO NOTHING
    `);
    for (const category of categories) {
      insertCategory.run(
        category.id, category.householdId, category.label,
        normalizeCategoryName(category.label).toLowerCase(), category.createdAtIso, category.updatedAtIso,
      );
    }
  }

  function storedCategoryReferenceIds(householdId: string): string[] {
    // Targets, rules, and archived evidence belong to the single local household.
    const scalarReferences = db.prepare(`
      SELECT category_id AS categoryId FROM transactions WHERE household_id = ?
      UNION SELECT category_id FROM monthly_category_targets
      UNION SELECT category_id FROM merchant_category_rules
      UNION SELECT category_id FROM merchant_correction_provenance
      UNION SELECT category_id FROM same_merchant_propagation_operations
      UNION SELECT before_category_id FROM same_merchant_propagation_changes
      UNION SELECT after_category_id FROM same_merchant_propagation_changes
    `).all(householdId);
    const ids = new Set(collectCategoryReferenceIds(scalarReferences));
    const evidence = db.prepare(`
      SELECT categorization_json AS payload, 'transactions.categorization_json' AS source
        FROM transactions WHERE household_id = ? AND categorization_json IS NOT NULL
      UNION ALL SELECT category_allocations_json, 'transactions.category_allocations_json'
        FROM transactions WHERE household_id = ? AND category_allocations_json IS NOT NULL
      UNION ALL SELECT original_categorization_json, 'merchant_correction_provenance.original_categorization_json'
        FROM merchant_correction_provenance WHERE original_categorization_json IS NOT NULL
      UNION ALL SELECT before_categorization_json, 'same_merchant_propagation_changes.before_categorization_json'
        FROM same_merchant_propagation_changes WHERE before_categorization_json IS NOT NULL
      UNION ALL SELECT after_categorization_json, 'same_merchant_propagation_changes.after_categorization_json'
        FROM same_merchant_propagation_changes WHERE after_categorization_json IS NOT NULL
      UNION ALL SELECT baseline_json, 'import_job_transaction_baselines.baseline_json'
        FROM import_job_transaction_baselines
      UNION ALL SELECT correction_json, 'import_review_items.correction_json'
        FROM import_review_items WHERE household_id = ? AND correction_json IS NOT NULL
      UNION ALL SELECT filters_json, 'saved_ledger_views.filters_json' FROM saved_ledger_views
    `).all(householdId, householdId, householdId);
    for (const row of evidence) {
      if (typeof row.payload !== "string" || typeof row.source !== "string") {
        throw new Error("Stored category evidence is invalid.");
      }
      try {
        for (const id of collectCategoryReferenceIds(JSON.parse(row.payload))) ids.add(id);
      } catch (error) {
        throw new Error(`Stored category evidence is invalid: ${row.source}.`, { cause: error });
      }
    }
    return [...ids].sort();
  }

  function createCategoryRecord(input: Category): void {
    const category = validateCategoryRecord(input);
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = listCategories(category.householdId);
      validateCategoryName(category.label, existing);
      if (existing.some((candidate) => candidate.id === category.id)) {
        throw new Error("Category ID already exists.");
      }
      db.prepare(`
        INSERT INTO categories (id, household_id, label, normalized_label, created_at_iso, updated_at_iso)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        category.id, category.householdId, category.label, category.label.toLowerCase(),
        category.createdAtIso, category.updatedAtIso,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function updateCategoryRecordLabel(
    householdId: string, categoryId: string, label: string, updatedAtIso: string,
  ): void {
    db.exec("BEGIN IMMEDIATE");
    try {
      const categories = listCategories(householdId);
      const existing = categories.find((category) => category.id === categoryId);
      if (existing === undefined) {
        throw new Error("Category not found.");
      }
      const category = validateCategoryRecord({
        ...existing, label: validateCategoryName(label, categories, categoryId), updatedAtIso,
      });
      const result = db.prepare(`
        UPDATE categories SET label = ?, normalized_label = ?, updated_at_iso = ?
        WHERE household_id = ? AND id = ?
      `).run(category.label, category.label.toLowerCase(), category.updatedAtIso, householdId, categoryId);
      if (Number(result.changes) !== 1) {
        throw new Error("Category not found.");
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return { listCategories, seedCategories, createCategoryRecord, updateCategoryRecordLabel };
}

export function createCategoryIdReader(db: DatabaseSync): (householdId: string) => readonly string[] {
  const { listCategories } = createCategoryRepository(db);
  const idsByHousehold = new Map<string, readonly string[]>();
  return (householdId) => {
    let ids = idsByHousehold.get(householdId);
    if (ids === undefined) {
      ids = listCategories(householdId).map((category) => category.id);
      idsByHousehold.set(householdId, ids);
    }
    return ids;
  };
}
