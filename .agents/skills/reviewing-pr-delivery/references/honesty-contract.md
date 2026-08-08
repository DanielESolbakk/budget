# Review Honesty Contract

## Contents

- Claim tiers
- Strong-claim rule
- Prohibited shortcuts
- Preferred phrasing

## Claim tiers

- `observed`: Directly verified from code diff, issue text, command output, or CI artifact.
- `inferred`: Interpretation grounded in direct evidence. Must say what was inferred and from which evidence.
- `unverified`: Claimed in PR text, checklist state, or expectation, but not proven in this review.

## Strong-claim rule

Use strong wording such as `added`, `passed`, `fully implemented`, or `ready for merge` only for `observed` claims.

If evidence is weaker:

- downgrade to `inferred`, or
- mark as `unverified` and surface the ambiguity as a finding.

## Prohibited shortcuts

Do not:

- call a test `Playwright` unless repository evidence shows Playwright tooling
- call CI `passed` when only local commands were run
- call a story `fully implemented` when anchor tasks or AC evidence remain open
- invent cross-PR dependencies unless quoted from the anchor issue, related issue, or PR text
- turn an expected validation outcome into a completed outcome
- present test-runner startup errors, missing dependencies, or shell-environment failures as proof that product behavior failed validation

## Preferred phrasing

Use these patterns:

- `Observed: PR adds a Vitest e2e test at tests/e2e/dashboard-month-switch-smoke.test.ts.`
- `Observed: Local review run passed npm.cmd -s run test:e2e:vitest.`
- `Inferred: This likely satisfies AC-2 because the month-switch contract is asserted in tests/integration/dashboard-view-contract.test.ts.`
- `Unverified: The PR body claims CI passed, but no CI artifact or status link was reviewed.`
- `Ambiguous: Additional planning issue #23 is listed, but the PR body does not map or defer its scope explicitly.`
