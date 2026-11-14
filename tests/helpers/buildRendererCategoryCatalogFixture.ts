import { seedCategoryCatalog } from "../../src/domain/categorization/categoryCatalog.js";
import type { useCategoryCatalog } from "../../src/renderer/categories/CategoryCatalogContext.js";

export function buildRendererCategoryCatalogFixture(): ReturnType<typeof useCategoryCatalog> {
  return {
    categories: seedCategoryCatalog({
      householdId: "hh-1",
      categories: [],
      referencedCategoryIds: [],
      createdAtIso: "2026-05-01T00:00:00.000Z",
    }),
    loading: false,
    error: null,
    refresh: async () => true,
  };
}
