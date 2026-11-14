import { randomUUID } from "node:crypto";
import type { LocalLedgerDatabase } from "./backup/localLedgerContracts.js";
import { normalizeCategoryName } from "../domain/categorization/categoryCatalog.js";
import type { Category } from "../domain/types.js";
import type { CategoryCreateInput, CategoryRenameInput } from "../shared/categoryManagement.js";

export interface CategoryManagementServiceOptions {
  createId?: () => string;
  now?: () => Date;
}

export interface CategoryManagementService {
  list: () => Category[];
  create: (input: CategoryCreateInput) => Category;
  rename: (input: CategoryRenameInput) => Category;
}

export function createCategoryManagementService(
  database: Pick<LocalLedgerDatabase,
    "loadRuntimeMetadata" | "listCategories" | "createCategoryRecord" | "updateCategoryRecordLabel"
  >,
  options: CategoryManagementServiceOptions = {},
): CategoryManagementService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());

  function currentHouseholdId(): string {
    const metadata = database.loadRuntimeMetadata();
    if (metadata === null) {
      throw new Error("Local household is not available for category management.");
    }
    return metadata.household.id;
  }

  function list(): Category[] {
    return database.listCategories(currentHouseholdId());
  }

  function create(input: CategoryCreateInput): Category {
    const householdId = currentHouseholdId();
    const label = normalizeCategoryName(input.label);
    const timestamp = now().toISOString();
    const category: Category = {
      id: createId(), householdId, label, createdAtIso: timestamp, updatedAtIso: timestamp,
    };
    database.createCategoryRecord(category);
    return category;
  }

  function rename(input: CategoryRenameInput): Category {
    const householdId = currentHouseholdId();
    const existing = database.listCategories(householdId).find((category) => category.id === input.categoryId);
    if (existing === undefined) {
      throw new Error("Category not found.");
    }
    const category: Category = {
      ...existing, label: normalizeCategoryName(input.label), updatedAtIso: now().toISOString(),
    };
    database.updateCategoryRecordLabel(householdId, category.id, category.label, category.updatedAtIso);
    return category;
  }
  return { list, create, rename };
}
