# Pull Request

## Change Type

Select exactly one:

- [ ] feature
- [ ] bug fix
- [ ] refactor
- [ ] chore or docs

## Linked Planning Issue

Primary planning issue: #
Additional planning issues: (list or leave blank)

## Summary

<!--
Describe the changes and why they are needed.
-->

## Definition of Done Checklist

- [ ] Unit tests: added and passing
- [ ] Integration tests: added and passing (or documented exception)
- [ ] CI: all relevant checks passed
- [ ] Docs: usage and examples updated (or linked)
- [ ] Local audit files (e.g. `local/sanitization-map.json`) are `.gitignored` and documented
- [ ] PR: links planning issue (e.g. `#123`) and includes verification artifacts when applicable
- [ ] Acceptance criteria in linked planning issue use AC IDs (for example `AC-1`, `AC-2`)
- [ ] Every linked AC ID is mapped to automated test evidence in the PR body
- [ ] If fixtures changed, attach verification artifacts (e.g., `verification-report.json`) or link the verification report in the PR

## Acceptance Criteria to Test Mapping

- Format required: `- AC-<n> | <test-level> | <test-id> | <test-file-path>`
- `test-level` must be one of: unit, integration, e2e, end-to-end, performance, privacy, no-network
- Workflow or job names (for example `check-dor-dod`, `CI Fast`) are not valid AC evidence

Examples:

- AC-1 | integration | dashboard forecast renders months | tests/integration/forecastContract.test.ts
- AC-2 | e2e | dashboard forecast fallback is labeled | tests/e2e/workflow-smoke.test.ts

## AC Exception Justification (Only when using `ac-exception` label)

Reason:

Follow-up issue: #

## Test Evidence

Commands run and passing:

- [ ] npm run lint
- [ ] npm run typecheck
- [ ] npm run test:unit
- [ ] npm run test:integration
- [ ] npm run test:e2e

CI run link or artifact: (paste link here)

## Bug Fix Regression Test (required for bug fixes)

Regression test file(s): (leave blank if not a bug fix)

What failed before this fix: (leave blank if not a bug fix)

Why this test prevents recurrence: (leave blank if not a bug fix)
