import { describe, expect, it } from "vitest";
import type { Category } from "../../src/domain/types.js";
import { filterCategoryCatalog } from "../../src/renderer/categories/filterCategoryCatalog.js";

const categories: Category[] = [
  { id: "repairs", label: "Car repairs", householdId: "hh-1",
    createdAtIso: "2026-05-01T00:00:00Z", updatedAtIso: "2026-05-01T00:00:00Z" },
  { id: "insurance", label: "Car insurance", householdId: "hh-1",
    createdAtIso: "2026-05-01T00:00:00Z", updatedAtIso: "2026-05-01T00:00:00Z" },
  { id: "economy", label: "Økonomi", householdId: "hh-1",
    createdAtIso: "2026-05-01T00:00:00Z", updatedAtIso: "2026-05-01T00:00:00Z" },
];

describe("category catalog search", () => {
  it.each([
    { query: "  CAR   REPAIRS  ", ids: ["repairs"] },
    { query: "økONOMI", ids: ["economy"] },
    { query: "unregistered", ids: [] },
    { query: "   ", ids: ["repairs", "insurance", "economy"] },
  ])("finds the intended names for '$query' without changing the catalog", ({ query, ids }) => {
    expect(filterCategoryCatalog(categories, query).map((category) => category.id)).toEqual(ids);
    expect(categories.map((category) => category.label)).toEqual(["Car repairs", "Car insurance", "Økonomi"]);
  });
});
