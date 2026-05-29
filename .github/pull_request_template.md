# Pull Request

## Summary

Describe what changed and why.

## Change Type

- [ ] Feature
- [ ] Bug fix
- [ ] Refactor
- [ ] Chore or docs

## Linked Planning Issue

- Primary planning issue: #123
- Additional planning issues: #456, #789

## Acceptance Criteria to Test Mapping

|Acceptance criterion|Test level|Test file or suite|Status|
|---|---|---|---|
|TBD|Unit, Integration, or E2E|TBD|[ ]|

## Test Evidence

List the commands you ran and summarize outcomes.

- Commands run:
  - [ ] npm run lint
  - [ ] npm run typecheck
  - [ ] npm run test:unit
  - [ ] npm run test:integration
  - [ ] npm run test:e2e
- Results summary:
- CI run link or artifact:

## Bug Fix Regression Test (required for bug fixes)

- Regression test file(s):
- What failed before this fix:
- Why this test prevents recurrence:

## Checklist

- [ ] I mapped acceptance criteria to automated tests.
- [ ] I added or updated tests for changed behavior.
- [ ] If this is a bug fix, I added a regression test that failed before the fix and now passes.
- [ ] I did not disable, remove, or weaken unrelated tests.
- [ ] I updated planning artifacts if architecture, privacy, or schema changed.
- [ ] If fixtures changed, I attached verification artifacts (e.g., `verification-report.json`) or linked the verification report in the PR
