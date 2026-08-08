# Candidate Scoring Rubric

Score each candidate from 0 to 100.

## 1) Assignability (0-35)

- 35: Open, unblocked, entry points exist, actionable now.
- 20: Open and mostly actionable, minor dependency uncertainty.
- 0: Blocked, missing critical entry-point path, or cannot verify prerequisites.

## 2) Slice Continuity (0-25)

- 25: Same active feature/epic slice as current in-flight work.
- 10: Related epic but different feature slice.
- 0: Unrelated slice with high context-switch cost.

## 3) Scope Size (0-20)

- 20: 2-4 ACs and 3-5 concrete tasks.
- 10: Slightly broader or narrower but still assignable.
- 0: Scope too vague or too large for a single assignment pass.

## 4) Evidence Quality (0-20)

- 20: Clear ACs, deterministic validation commands, concrete fixtures/examples.
- 10: Partial clarity with one ambiguous section.
- 0: Weak or missing acceptance/validation evidence.

## Governance Gate (Applied after scoring)

- `verified`: can be `assign-now`.
- `unclear` or `missing`: can only be `governance-check-required`.
- `planning-invalid` present: not assignable.

## Tie-Break Order

1. Governance evidence level (`verified` > `unclear` > `missing`).
2. Same active slice.
3. Fewer unresolved dependencies.
4. Newer `updated_at` timestamp.

## Output Requirements

Always include:

- Recommendation status (`assign-now` or `governance-check-required`).
- Governance evidence level.
- One concrete next action.
- Optional fallback issue.
