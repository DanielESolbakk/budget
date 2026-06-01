# Definition of Ready (DoR) and Definition of Done (DoD)

Minimal, machine-friendly checklists for planning items (single source of truth).

## Definition of Ready (DoR)

An issue is ready when all of the following are present:

- [ ] No `planning-invalid` label present (planning-lint passed)
- [ ] Acceptance Criteria: present, testable, and labeled with AC IDs (for example `AC-1`, `AC-2`)
- [ ] Short user story / description
- [ ] Assignee or named owner
- [ ] Fixtures listed (tests/fixtures/... or *None*)
- [ ] Related planning issues listed (e.g., `#123`)
- [ ] Estimate provided (e.g., `2 days`, `small`)
- [ ] Fixtures cover required edge cases (non‑NOK currency row, FX rows, KID/invoice rows, transfer/hold/reserved rows)

## Definition of Done (DoD)

An item is done when all of the following are completed and documented in the PR/issue:

- [ ] Unit tests: added and passing
- [ ] Integration tests: added and passing (or documented exception)
- [ ] CI: all relevant checks passed
- [ ] Docs: usage and examples updated (or linked)
- [ ] Local audit files (e.g., `local/sanitization-map.json`) are `.gitignored` and documented
- [ ] PR links back to planning issue and includes verification artifacts when applicable
- [ ] Every linked AC ID is mapped to automated test evidence in the PR (AC ID → tests)
- [ ] When fixtures change, attach verification artifacts (e.g., `verification-report.json`) or link the verification report in the PR

## AC ID Convention

- Format: `AC-<number>` (for example `AC-1`, `AC-2`, `AC-3`)
- Use AC IDs in planning issue acceptance criteria.
- In each PR, add an AC-to-test mapping section that references the same AC IDs.

## AC Exception Policy

- Default rule: AC IDs and AC-to-test mapping are required for all work types, including `test` issues.
- Exception path: apply the `ac-exception` label only when AC mapping is genuinely not applicable.
- Required PR content when `ac-exception` is used:
  - section heading: `AC Exception Justification`
  - clear reason
  - follow-up issue reference (for example `#123`)
