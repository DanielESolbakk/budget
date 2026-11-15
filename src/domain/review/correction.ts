import { CATEGORY_OPTIONS } from "../categorization/categoryOptions.js";
import type { MerchantCorrectionProvenance } from "../types.js";

export function validateCorrectionCategoryId(
  categoryId: string,
  allowedCategoryIds: readonly string[] = CATEGORY_OPTIONS.map((category) => category.id),
): void {
  if (!allowedCategoryIds.includes(categoryId)) {
    throw new Error(`Invalid correction category: ${categoryId}`);
  }
}

export function createCorrectionProvenance(
  provenance: MerchantCorrectionProvenance,
  allowedCategoryIds?: readonly string[],
): MerchantCorrectionProvenance {
  validateCorrectionCategoryId(provenance.categoryId, allowedCategoryIds);

  return { ...provenance };
}