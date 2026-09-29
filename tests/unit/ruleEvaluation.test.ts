import { describe, expect, it } from "vitest";
import { evaluateCategorizationRule } from "../../src/domain/categorization/evaluateCategorizationRule.js";
import { scoreCategorizationConfidence } from "../../src/domain/categorization/scoreCategorizationConfidence.js";
import type { CategorizationRule } from "../../src/domain/types.js";

const conflictingRules: CategorizationRule[] = [
  { ruleId: "rule-b", merchantAlias: "FJORD KAFE", categoryId: "restaurants", priority: 10 },
  { ruleId: "rule-a", merchantAlias: "FJORD KAFE", categoryId: "groceries", priority: 10 },
  { ruleId: "fallback", merchantAlias: "FJORD KAFE", categoryId: "other", priority: 1 },
];

describe("categorization rule evaluation", () => {
  it("returns the same deterministic low-confidence decision regardless of rule order", () => {
    const forward = evaluateCategorizationRule("FJORD KAFE", conflictingRules);
    const reverse = evaluateCategorizationRule("FJORD KAFE", [...conflictingRules].reverse());

    expect(forward).toEqual(reverse);
    expect(forward).toEqual({
      status: "ambiguous",
      categoryId: "groceries",
      confidence: 0.35,
      confidenceLevel: "low",
      requiresReview: true,
      selectedRule: {
        ruleId: "rule-a",
        merchantAlias: "FJORD KAFE",
        categoryId: "groceries",
        priority: 10,
      },
      matchingRules: [
        {
          ruleId: "rule-a",
          merchantAlias: "FJORD KAFE",
          categoryId: "groceries",
          priority: 10,
        },
        {
          ruleId: "rule-b",
          merchantAlias: "FJORD KAFE",
          categoryId: "restaurants",
          priority: 10,
        },
        {
          ruleId: "fallback",
          merchantAlias: "FJORD KAFE",
          categoryId: "other",
          priority: 1,
        },
      ],
    });
  });

  it("chooses the highest-priority category even when lower-priority rules disagree", () => {
    expect(
      evaluateCategorizationRule("FJORD KAFE", [
        { ruleId: "builtin", merchantAlias: "FJORD KAFE", categoryId: "groceries", priority: 0 },
        { ruleId: "learned", merchantAlias: "FJORD KAFE", categoryId: "restaurants", priority: 100 },
      ])
    ).toMatchObject({
      status: "categorized",
      categoryId: "restaurants",
      confidence: 0.95,
      confidenceLevel: "high",
      requiresReview: false,
      selectedRule: { ruleId: "learned" },
    });
  });

  it("returns an explicit unmatched result with zero confidence", () => {
    expect(evaluateCategorizationRule("UNKNOWN MERCHANT", conflictingRules)).toEqual({
      status: "unmatched",
      confidence: 0,
      confidenceLevel: "low",
      requiresReview: true,
      matchingRules: [],
    });
  });

  it("keeps every score within the inclusive confidence range", () => {
    for (const input of [
      { matchingRuleCount: 0, hasConflictingCategories: false },
      { matchingRuleCount: 1, hasConflictingCategories: false },
      { matchingRuleCount: 2, hasConflictingCategories: true },
    ]) {
      const { score } = scoreCategorizationConfidence(input);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});
