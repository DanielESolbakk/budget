import { CATEGORY_OPTIONS } from "../categorization/categoryOptions.js";
import type { MerchantCorrectionProvenance } from "../types.js";

export function validateCorrectionCategoryId(categoryId: string): void {
  if (!CATEGORY_OPTIONS.some((category) => category.id === categoryId)) {
    throw new Error(`Invalid correction category: ${categoryId}`);
  }
}

export function createCorrectionProvenance(
  provenance: MerchantCorrectionProvenance
): MerchantCorrectionProvenance {
  validateCorrectionCategoryId(provenance.categoryId);

  return { ...provenance };
}