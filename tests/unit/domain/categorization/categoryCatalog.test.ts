import { describe, expect, it } from "vitest";
import type { Category } from "../../../../src/domain/types.js";
import {
  collectCategoryReferenceIds,
  normalizeCategoryName,
  seedCategoryCatalog,
  validateCategoryName,
} from "../../../../src/domain/categorization/categoryCatalog.js";

describe("category catalog names", () => {
  it("normalizes whitespace without changing the category name's meaning", () => {
    expect(normalizeCategoryName("  Car \t repairs  ")).toBe("Car repairs");
  });

  describe("category catalog duplicate names", () => {
    const categories = [
      { id: "custom-health", label: "Health" },
      { id: "custom-car", label: "Car repairs" },
    ];

    it.each(["  HEALTH  ", "health"])("rejects creating the equivalent active name %j", (name) => {
      expect(() => validateCategoryName(name, categories)).toThrow(/already exists/i);
    });

    it("rejects a duplicate with equivalent internal whitespace", () => {
      expect(() => validateCategoryName("Car \t repairs", categories)).toThrow(/already exists/i);
    });

    it("allows renaming a category to its own normalized name", () => {
      expect(validateCategoryName("  Health  ", categories, "custom-health")).toBe("Health");
    });

    it("does not let a rename reuse another category's name", () => {
      expect(() => validateCategoryName(" HEALTH ", categories, "custom-car")).toThrow(/already exists/i);
    });

    it("rejects renaming a missing category instead of using the exclusion to bypass validation", () => {
      expect(() => validateCategoryName("Fuel", categories, "missing")).toThrow(/category.*not found/i);
    });

    it("returns the normalized replacement without changing saved categories", () => {
      expect(validateCategoryName("  Vehicle   repairs ", categories, "custom-car")).toBe("Vehicle repairs");
      expect(categories).toEqual([
        { id: "custom-health", label: "Health" },
        { id: "custom-car", label: "Car repairs" },
      ]);
    });
  });

  it.each(["", " \t\r\n ", "\u00a0"])("rejects an empty category name %j", (name) => {
    expect(() => normalizeCategoryName(name)).toThrow(/non-empty string/i);
  });

  it.each([
    { value: undefined },
    { value: null },
    { value: 42 },
    { value: {} },
    { value: ["Health"] },
  ])(
    "rejects a non-string category name %j with an actionable validation error",
    ({ value }) => {
      expect(() => normalizeCategoryName(value)).toThrow(/non-empty string/i);
    },
  );
});

describe("category catalog seeding", () => {
  const createdAtIso = "2026-11-14T12:00:00.000Z";
  const groceries: Category = {
    id: "groceries",
    householdId: "household-1",
    label: "Food",
    createdAtIso: "2026-01-01T00:00:00.000Z",
    updatedAtIso: "2026-02-01T00:00:00.000Z",
  };
  const custom: Category = {
    id: "custom-car",
    householdId: "household-1",
    label: "Vehicle repairs",
    createdAtIso: "2026-03-01T00:00:00.000Z",
    updatedAtIso: "2026-03-01T00:00:00.000Z",
  };

  it("adds missing defaults while retaining renamed defaults and custom identities", () => {
    const seeded = seedCategoryCatalog({
      householdId: "household-1",
      categories: [groceries, custom],
      referencedCategoryIds: ["groceries", "custom-car"],
      createdAtIso,
    });

    expect(seeded).toEqual(expect.arrayContaining([
      groceries,
      custom,
      expect.objectContaining({ id: "salary", label: "Salary / wages" }),
      expect.objectContaining({ id: "housing", label: "Housing" }),
      expect.objectContaining({ id: "transport", label: "Transport" }),
      expect.objectContaining({ id: "utilities", label: "Utilities" }),
      expect.objectContaining({ id: "other", label: "Other" }),
      expect.objectContaining({ id: "dining", label: "Dining" }),
      expect.objectContaining({ id: "health", label: "Health" }),
      expect.objectContaining({ id: "insurance", label: "Insurance" }),
      expect.objectContaining({ id: "subscriptions", label: "Subscriptions" }),
      expect.objectContaining({ id: "shopping", label: "Shopping" }),
      expect.objectContaining({ id: "fuel", label: "Fuel" }),
      expect.objectContaining({ id: "public-transit", label: "Public transit" }),
      expect.objectContaining({ id: "fees", label: "Fees" }),
    ]));
    expect(seeded).toHaveLength(15);
    expect(groceries.label).toBe("Food");
  });

  it("backfills unknown referenced IDs exactly once without rewriting their identity", () => {
    const seeded = seedCategoryCatalog({
      householdId: "household-1",
      categories: [groceries],
      referencedCategoryIds: [" car-repairs ", " car-repairs ", "groceries"],
      createdAtIso,
    });

    expect(seeded.filter((category) => category.id === " car-repairs ")).toEqual([{
      id: " car-repairs ",
      householdId: "household-1",
      label: "car-repairs",
      createdAtIso,
      updatedAtIso: createdAtIso,
    }]);
    expect(seeded.find((category) => category.id === "groceries")).toEqual(groceries);
  });

  it("does not reset labels or creation metadata when seeded again", () => {
    const seeded = seedCategoryCatalog({
      householdId: "household-1",
      categories: [groceries, custom],
      referencedCategoryIds: ["car-repairs"],
      createdAtIso,
    });
    const reseeded = seedCategoryCatalog({
      householdId: "household-1",
      categories: seeded,
      referencedCategoryIds: ["car-repairs", "groceries"],
      createdAtIso: "2026-12-01T00:00:00.000Z",
    });

    expect(reseeded).toEqual(seeded);
    expect(reseeded.find((category) => category.id === "dining")?.createdAtIso).toBe(createdAtIso);
    expect(reseeded.find((category) => category.id === "groceries")).toEqual(groceries);
  });

  it("rejects category records from another household", () => {
    expect(() => seedCategoryCatalog({
      householdId: "household-2",
      categories: [groceries],
      referencedCategoryIds: [],
      createdAtIso,
    })).toThrow(/household/i);
  });

  it.each([
    { override: { id: "" }, error: /category.*id/i },
    { override: { label: " \t " }, error: /non-empty string/i },
    { override: { createdAtIso: "not-a-date" }, error: /timestamp/i },
  ])("rejects malformed stored metadata during seeding: $override", ({ override, error }) => {
    expect(() => seedCategoryCatalog({
      householdId: "household-1",
      categories: [{ ...custom, ...override }],
      referencedCategoryIds: [],
      createdAtIso,
    })).toThrow(error);
  });

  it("rejects duplicate stored identities instead of silently choosing a label", () => {
    expect(() => seedCategoryCatalog({
      householdId: "household-1",
      categories: [groceries, { ...groceries, label: "Groceries & food" }],
      referencedCategoryIds: [],
      createdAtIso,
    })).toThrow(/duplicate.*category/i);
  });

  it.each(["", " \t "])("rejects an empty referenced category ID %j", (id) => {
    expect(() => seedCategoryCatalog({
      householdId: "household-1",
      categories: [],
      referencedCategoryIds: [id],
      createdAtIso,
    })).toThrow(/category.*id/i);
  });

  it("requires a household identity before seeding categories", () => {
    expect(() => seedCategoryCatalog({
      householdId: " ",
      categories: [],
      referencedCategoryIds: [],
      createdAtIso,
    })).toThrow(/household.*id/i);
  });
});

describe("category references in ledger state and immutable evidence", () => {
  it("collects current, allocation, rule, target, and historical IDs without reading raw transaction text", () => {
    expect(collectCategoryReferenceIds({
      transactions: [{
        categoryId: "current",
        merchantRaw: '{"categoryId":"not-a-category"}',
        categoryAllocations: [{ categoryId: "allocation" }, { categoryId: "current" }],
        categorization: {
          categoryId: "historical",
          selectedRule: { categoryId: "selected" },
          matchingRules: [{ categoryId: "matching" }],
        },
      }],
      monthlyCategoryTargets: [{ categoryId: "target" }],
      merchantCategoryRules: [{ categoryId: "rule" }],
      propagationChanges: [{ beforeCategoryId: "before", afterCategoryId: "after" }],
    })).toEqual(["after", "allocation", "before", "current", "historical", "matching", "rule", "selected", "target"]);
  });

  it("retains raw legacy identities and ignores explicit uncategorized references", () => {
    expect(collectCategoryReferenceIds([
      { categoryId: " legacy-id " },
      { categoryId: " legacy-id " },
      { beforeCategoryId: null },
      { categoryId: undefined },
    ])).toEqual([" legacy-id "]);
  });

  it.each([{ categoryId: "" }, { categoryId: 42 }, { afterCategoryId: [] }])(
    "rejects malformed reference fields instead of silently dropping them: %j",
    (value) => {
      expect(() => collectCategoryReferenceIds(value)).toThrow(/category.*reference/i);
    },
  );
});
