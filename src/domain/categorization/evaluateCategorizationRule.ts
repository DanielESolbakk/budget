import type {
  CategorizationDecision,
  CategorizationRule,
  CategorizationRuleProvenance,
} from "../types.js";
import { scoreCategorizationConfidence } from "./scoreCategorizationConfidence.js";

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareRules(
  left: CategorizationRuleProvenance,
  right: CategorizationRuleProvenance
): number {
  return right.priority - left.priority ||
    compareText(left.ruleId, right.ruleId) ||
    compareText(left.categoryId, right.categoryId);
}

export function evaluateCategorizationRule(
  merchantAlias: string,
  rules: readonly CategorizationRule[]
): CategorizationDecision {
  const matchingRules = rules
    .filter((rule) => rule.merchantAlias === merchantAlias)
    .map((rule) => ({ ...rule }))
    .sort(compareRules);
  const selectedRule = matchingRules[0];

  if (selectedRule === undefined) {
    const confidence = scoreCategorizationConfidence({
      matchingRuleCount: 0,
      hasConflictingCategories: false,
    });
    return {
      status: "unmatched",
      confidence: confidence.score,
      confidenceLevel: confidence.level,
      requiresReview: confidence.requiresReview,
      matchingRules,
    };
  }

  const topPriorityRules = matchingRules.filter((rule) => rule.priority === selectedRule.priority);
  const hasConflictingCategories = new Set(topPriorityRules.map((rule) => rule.categoryId)).size > 1;
  const confidence = scoreCategorizationConfidence({
    matchingRuleCount: topPriorityRules.length,
    hasConflictingCategories,
  });

  return {
    status: hasConflictingCategories ? "ambiguous" : "categorized",
    categoryId: selectedRule.categoryId,
    confidence: confidence.score,
    confidenceLevel: confidence.level,
    requiresReview: confidence.requiresReview,
    selectedRule,
    matchingRules,
  };
}
