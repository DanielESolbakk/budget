# Definition of Ready (DoR) and Definition of Done (DoD)

Minimal, machine-friendly checklists for planning items (single source of truth).

## Definition of Ready (DoR)

An issue is ready when all of the following are present:

- [ ] No `planning-invalid` label present (planning-lint passed)
- [ ] Acceptance Criteria: present and testable
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
- [ ] Acceptance criteria are mapped to tests (AC → tests) and documented in the PR
- [ ] When fixtures change, attach verification artifacts (e.g., `verification-report.json`) or link the verification report in the PR
