import { UNCATEGORIZED_LABEL } from "../../domain/aggregation/computeCategoryBreakdown.js";
import { CATEGORY_OPTIONS } from "../../domain/categorization/categoryOptions.js";

export function categoryDisplayName(
  categoryId: string | null,
  fallbackLabel?: string,
  categories: readonly { id: string; label: string }[] = CATEGORY_OPTIONS,
): string {
  if (categoryId === null) return fallbackLabel ?? UNCATEGORIZED_LABEL;

  const knownCategory = categories.find((category) => category.id === categoryId);
  if (knownCategory !== undefined) return knownCategory.label;

  return categoryId
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
