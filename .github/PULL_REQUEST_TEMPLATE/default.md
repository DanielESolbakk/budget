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

**Required:** Describe how this PR addresses the acceptance criteria from the linked planning issue.
This section is for human review. Mention each AC and how this PR helps satisfy it. Format is free-form prose.

Example:

- AC-1: Dashboard renders totals → Added aggregation view in src/app/dashboard.ts and integrated with forecastContract.test.ts.
- AC-2: Category breakdown shows correctly → Tested with integration suite in tests/integration/forecastContract.test.ts.
- AC-3: Monthly selection works → End-to-end workflow tested in workflow-smoke.test.ts.

(Replace with your actual AC mappings and evidence from the linked issue.)

## AC Exception Justification (Only when using `ac-exception` label)

Reason:

Follow-up issue: #

## High-Risk Judgment Checkpoint (required for high-blast-radius changes)

Risk level:

Blast radius summary:

Tradeoff rationale:

Rollback or containment plan:

Follow-up risk issue: #

## Test Evidence

Commands run and passing:

- [ ] npm run lint
- [ ] npm run typecheck
- [ ] npm run test:unit
- [ ] npm run test:integration
- [ ] npm run test:e2e:vitest
- [ ] npm run test:e2e:playwright

(Check at least one command above to confirm work was validated.)

## Bug Fix Regression Test (required for bug fixes)

Regression test file(s): (leave blank if not a bug fix)

What failed before this fix: (leave blank if not a bug fix)

Why this test prevents recurrence: (leave blank if not a bug fix)
