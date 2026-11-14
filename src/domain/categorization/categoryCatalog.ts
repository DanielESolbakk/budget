import type { Category } from "../types.js";
import { CATEGORY_OPTIONS } from "./categoryOptions.js";

export function collectCategoryReferenceIds(input: unknown): string[] {
  const ids = new Set<string>();
  function visit(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      if (key === "categoryId" || key === "beforeCategoryId" || key === "afterCategoryId") {
        if (nested === null || nested === undefined) continue;
        if (typeof nested !== "string" || nested.trim().length === 0) {
          throw new Error(`Invalid category reference: ${key}.`);
        }
        ids.add(nested);
      } else {
        visit(nested);
      }
    }
  }
  visit(input);
  return [...ids].sort();
}

const DEFAULT_CATEGORY_OPTIONS = [
  ...CATEGORY_OPTIONS,
  { id: "dining", label: "Dining" },
  { id: "health", label: "Health" },
  { id: "insurance", label: "Insurance" },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "shopping", label: "Shopping" },
  { id: "fuel", label: "Fuel" },
  { id: "public-transit", label: "Public transit" },
  { id: "fees", label: "Fees" },
] as const;

export function normalizeCategoryName(input: unknown): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error("Category name must be a non-empty string.");
  }

  return input.trim().replace(/\s+/g, " ");
}

export function validateCategoryName(
  input: unknown,
  categories: readonly Pick<Category, "id" | "label">[],
  categoryId?: string,
): string {
  const label = normalizeCategoryName(input);
  if (categoryId !== undefined && !categories.some((category) => category.id === categoryId)) {
    throw new Error("Category not found.");
  }
  const normalizedName = label.toLowerCase();
  if (categories.some((category) =>
    category.id !== categoryId && normalizeCategoryName(category.label).toLowerCase() === normalizedName
  )) {
    throw new Error("A category with this name already exists.");
  }
  return label;
}

interface CategoryCatalogSeedInput {
  householdId: string;
  categories: readonly Category[];
  referencedCategoryIds: readonly string[];
  createdAtIso: string;
}

export function validateCategoryRecord(category: Category): Category {
  if (typeof category.id !== "string" || category.id.trim().length === 0) {
    throw new Error("Category ID is required.");
  }
  if (typeof category.householdId !== "string" || category.householdId.trim().length === 0) {
    throw new Error("Category household ID is required.");
  }
  for (const timestamp of [category.createdAtIso, category.updatedAtIso]) {
    if (typeof timestamp !== "string" || !timestamp.includes("T") || Number.isNaN(Date.parse(timestamp))) {
      throw new Error("Category timestamp must be a valid ISO timestamp.");
    }
  }
  return { ...category, label: normalizeCategoryName(category.label) };
}

export function seedCategoryCatalog(input: CategoryCatalogSeedInput): Category[] {
  if (input.householdId.trim().length === 0) {
    throw new Error("Household ID must be a non-empty string.");
  }
  const categories = new Map<string, Category>();
  for (const category of input.categories) {
    validateCategoryRecord(category);
    if (category.householdId !== input.householdId) {
      throw new Error("Category belongs to a different household.");
    }
    if (categories.has(category.id)) {
      throw new Error("Duplicate stored category ID.");
    }
    categories.set(category.id, { ...category });
  }
  for (const option of DEFAULT_CATEGORY_OPTIONS) {
    if (!categories.has(option.id)) {
      categories.set(option.id, {
        id: option.id,
        householdId: input.householdId,
        label: option.label,
        createdAtIso: input.createdAtIso,
        updatedAtIso: input.createdAtIso,
      });
    }
  }
  for (const id of input.referencedCategoryIds) {
    if (id.trim().length === 0) {
      throw new Error("Referenced category ID must be a non-empty string.");
    }
    if (!categories.has(id)) {
      categories.set(id, {
        id,
        householdId: input.householdId,
        label: normalizeCategoryName(id),
        createdAtIso: input.createdAtIso,
        updatedAtIso: input.createdAtIso,
      });
    }
  }
  return [...categories.values()];
}
