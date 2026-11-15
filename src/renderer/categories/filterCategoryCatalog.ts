import type { Category } from "../../domain/types.js";
import { normalizeCategoryName } from "../../domain/categorization/categoryCatalog.js";

export function filterCategoryCatalog(categories: readonly Category[], query: string): readonly Category[] {
  const normalizedQuery = query.trim() === "" ? "" : normalizeCategoryName(query).toLowerCase();
  return categories.filter((category) => category.label.toLowerCase().includes(normalizedQuery));
}
