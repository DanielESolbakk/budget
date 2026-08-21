---
name: "Planning issue"
about: "Template for Epics, Features, Enablers, Tests, and Stories. Fill headings exactly — the planning lint parses these."
title: ""
labels: ""
assignees: ""
---

Catalog key:
Type: (Epic | Feature | Enabler | Test | Story)
Source: docs/ways-of-work/plan/budget-planner/issue-catalog.json

Description:

- One-sentence summary of intent and acceptance criteria.
- If validation work is needed, keep it in a linked Test issue unless this issue is explicitly test-only.

Acceptance Criteria (use AC IDs):

- [ ] AC-1: ...
- [ ] AC-2: ...

Acceptance Criteria To Test Mapping:

- Format: `- AC-<n> | <test-level> | <test-id> | <test-file-path>`
- AC IDs are local to this issue. Test issues must qualify each parent AC as `(from #PARENT_STORY_OR_ENABLER)`.
- Do not infer a feature AC from a child story or enabler AC with the same number; explicitly state when child-test evidence covers the feature AC.
- Allowed test levels: `unit`, `integration`, `vitest-e2e-smoke`, `playwright-runtime-e2e`, `performance`, `privacy`, `no-network`
- AC-1 | integration | import ledger totals remain stable | tests/integration/importLedger.test.ts
- AC-2 | vitest-e2e-smoke | low confidence review queue is visible | tests/e2e/workflow-smoke.test.ts

Parent keys: E

## Planning Fields

### Parent Epic Issue

Example: `#26`

### Parent Feature Issue

Example: `#27`

### Parent Story Or Enabler Issue

Example: `#40` or `_None_`

### Related Planning Issues

- #123 — short scope note (link related features/enablers/tests)

### Implementation Entry Points

- Likely files to change: ...
- Files that should usually not change: ...

### Validation Commands

- npm run ...

### Fixture Or Example Inputs

- tests/fixtures/... or _None_

### Test Automation Triangle Coverage

- Unit: ...
- Integration: ...
- Vitest E2E Smoke: ...
- Playwright Runtime E2E: ...

### Out Of Scope

- Name adjacent work that should not be pulled into this issue.

### Test Scope Type

(Integration / Vitest E2E Smoke / Playwright Runtime E2E / Unit / Other)

### Test Level

(Integration / Unit / Vitest E2E Smoke / Playwright Runtime E2E)

Notes:

- Any additional details, fixtures, or references.

Please do not remove or rename the headings above — our automation requires them to be present and to include issue-number references where indicated.

### Definition of Ready Checklist

Paste or leave this checklist in the issue body if you want automation and reviewers to verify readiness:

- [ ] Parent Epic Issue: # (e.g. #26)
- [ ] Parent Epic Issue: # (e.g. #26) or _None_ for top-level Epics
- [ ] Acceptance Criteria: present, testable, and labeled with AC IDs (for example `AC-1`)
- [ ] Fixtures listed: tests/fixtures/... or _None_
- [ ] Related Planning Issues: list issue numbers (e.g. `#123`)
- [ ] Estimate: (e.g. `2 days` / `small`)
- [ ] Assignee: @owner or _Unassigned_

Note: This checklist is also maintained in `docs/ways-of-work/plan/budget-planner/definition-of-ready-and-done.md` as a canonical reference.
