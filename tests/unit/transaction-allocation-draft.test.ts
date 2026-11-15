import { describe, expect, it } from "vitest";
import { parseAllocationDraft } from "../../src/renderer/dashboard/transactionAllocationDraft.js";

describe("allocation draft validation", () => {
  it("preserves the entered sequence and exact signed amounts for the save request", () => {
    expect(parseAllocationDraft(-7200, [
      { categoryId: "housing", amountText: "-32.00" },
      { categoryId: "groceries", amountText: "-40.00" },
    ], ["groceries", "housing"])).toEqual({
      ok: true,
      allocations: [
        { categoryId: "housing", amountMinor: -3200 },
        { categoryId: "groceries", amountMinor: -4000 },
      ],
    });
  });

  it.each([
    { categoryId: "", amountText: "-32", field: "category" },
    { categoryId: "missing", amountText: "-32", field: "category" },
    { categoryId: "housing", amountText: "", field: "amount" },
    { categoryId: "housing", amountText: "-32.001", field: "amount" },
    { categoryId: "housing", amountText: "0", field: "amount" },
    { categoryId: "housing", amountText: "32", field: "amount" },
  ] as const)("identifies the offending $field for '$categoryId' / '$amountText'", ({
    categoryId, amountText, field,
  }) => {
    expect(parseAllocationDraft(-7200, [
      { categoryId: "groceries", amountText: "-40" },
      { categoryId, amountText },
    ], ["groceries", "housing"])).toMatchObject({
      ok: false,
      error: { field: { index: 1, name: field }, message: expect.any(String) },
    });
  });

  it("rejects a complete but unbalanced draft without blaming a specific field", () => {
    expect(parseAllocationDraft(-7200, [
      { categoryId: "groceries", amountText: "-40" },
      { categoryId: "housing", amountText: "-20" },
    ], ["groceries", "housing"])).toEqual({
      ok: false,
      error: { message: "Category allocations must sum exactly to the source transaction amount." },
    });
  });
});
