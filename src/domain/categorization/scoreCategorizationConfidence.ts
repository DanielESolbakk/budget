import type { CategorizationConfidenceLevel } from "../types.js";

export interface CategorizationConfidenceInput {
  matchingRuleCount: number;
  hasConflictingCategories: boolean;
}

export interface CategorizationConfidence {
  score: number;
  level: CategorizationConfidenceLevel;
  requiresReview: boolean;
}

const REVIEW_THRESHOLD = 0.75;

export function scoreCategorizationConfidence(
  input: CategorizationConfidenceInput
): CategorizationConfidence {
  const score = input.matchingRuleCount === 0
    ? 0
    : input.hasConflictingCategories
      ? 0.35
      : 0.95;

  return {
    score,
    level: score >= REVIEW_THRESHOLD ? "high" : "low",
    requiresReview: score < REVIEW_THRESHOLD,
  };
}
