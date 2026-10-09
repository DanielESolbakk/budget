# Candidate Scoring Rubric

Score each candidate from 0 to 100.

## Project-Value Tier (Rank Before Score)

Set the tier from explicit evidence in the user's stated goal, roadmap, issue priority, release criteria, or dependency graph:

- P0/critical: release blocker, critical user workflow, privacy/data-integrity risk, or explicit top priority.
- P1/high: explicit near-term roadmap priority or prerequisite to a critical workflow.
- Planned: approved user outcome with no stated priority.
- Optional/unknown: deferred polish, unscheduled idea, or no direct value evidence.

Compare value tiers before the 0-100 score. A higher-value issue remains primary when it needs repairable planning work; do not let readiness or governance evidence promote a lower-value issue. Do not infer a tier from recency, topic similarity, code symbols, or a missing test deliverable.

## 1) Assignability (0-35)

This score describes the eligibility precheck and candidate ranking; it does not authorize direct assignment. Only status `assign-now` permits assigning Copilot.

- 35: Open, unblocked, entry points exist, and a per-criterion evidence matrix proves work remains on the current base SHA.
- 20: Open and mostly actionable with minor dependency uncertainty; `work-remains` is still proven against the current base SHA.
- 0: Blocked, missing a critical entry-point path, already satisfied on the current base, or the base SHA/criterion evidence is unclear.

## 2) Slice Continuity (0-25)

- 25: Same active feature/epic slice as current in-flight work.
- 10: Related epic but different feature slice.
- 0: Unrelated slice with high context-switch cost.

Slice continuity affects ranking only; it is never an eligibility gate or a reason to stop. Award same-slice points only when issue hierarchy or current in-flight evidence supports the connection; similar themes alone do not establish continuity. If no `work-remains` candidate exists in the active slice, continue scoring candidates from the rest of the open backlog.

## 3) Scope Size (0-20)

- 20: 2-4 ACs and 3-5 concrete tasks.
- 10: Slightly broader or narrower but still assignable.
- 0: Scope too vague or too large for a single assignment pass.

## 4) Evidence Quality (0-20)

- 20: Clear ACs, deterministic validation commands, concrete fixtures/examples, and behavior-discriminating test assertions.
- 10: Partial clarity with one ambiguous section.
- 0: Weak or missing acceptance/validation evidence.

## Governance Gate (Applied after scoring)

- Score only candidates classified `work-remains`; exclude `satisfied-on-main` and do not treat `unclear` as assignable now.
- Score a Test only when its parent behavior is delivered at `BASE_SHA`, or its immediate Story/Enabler is actively assigned, implementation-ready, and unblocked. Otherwise rank the implementation owner or its planning repair, not the Test.
- `verified`: permits `assign-now` only for a candidate with confirmed `work-remains` that passes all other gates.
- `unclear` or `missing`: use `governance-check-required` only when `work-remains` is confirmed.
- `preparation-only`: completion is `unclear`; state the evidence or planning action, and do not assign or score the candidate.
- `planning-invalid` present: not assignable.

For confirmed `work-remains` candidates, governance evidence selects the assignment status; it does not erase project value. `governance-check-required` means no assignment until the issue-planning governor returns `verified`.

## Tie-Break Order Within A Project-Value Tier

1. Correct implementation sequence: prerequisite/implementation owner before dependent Test.
2. Fewer real dependencies.
3. Same evidenced active slice.
4. Newer `updated_at` timestamp.

Governance evidence determines whether assignment may proceed, not which value tier ranks first.

## Output Requirements

Always include:

- Project-value tier and its direct evidence source.
- Whether the issue is implementation or verification; for a Test, state parent behavior/readiness.
- Recommendation status (`assign-now`, `governance-check-required`, or `preparation-only`).
- Governance evidence level.
- One concrete next action.
- Optional fallback issue.
