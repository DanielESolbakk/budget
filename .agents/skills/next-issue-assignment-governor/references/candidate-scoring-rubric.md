# Candidate Scoring Rubric

Score each candidate from 0 to 100.

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
- `verified`: can be `assign-now`.
- `unclear` or `missing`: can only be `governance-check-required`.
- `planning-invalid` present: not assignable.

Governance evidence selects the recommendation status; it does not erase a confirmed work-remains candidate. `governance-check-required` means no assignment until the issue-planning governor returns `verified`.

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
