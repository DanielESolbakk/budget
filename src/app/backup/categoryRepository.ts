import { DatabaseSync } from "node:sqlite";
import {
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
  seedCategories: (household: Household, categories?: readonly Category[]) => void;
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
  ): void {
    const categories = seedCategoryCatalog({
      householdId: household.id,
      categories: existingCategories,
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
