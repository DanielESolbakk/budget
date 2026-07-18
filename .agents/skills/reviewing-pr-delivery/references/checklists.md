# PR Review Checklist

## Contents

- Source issue resolution
- Issue coverage checks
- Plan alignment checks
- Related-issue boundary checks
- Validation evidence checks

## Source Issue Resolution

- Primary issue linked from PR body exists and is unique.
- If multiple issues are linked, one issue is selected as the review anchor and called out explicitly.
- Anchor issue contains Acceptance Criteria and Validation Commands.
- Related-issue set is built from both PR-linked planning issues and source-issue linked sections.

## Issue Coverage Checks

- Every AC is marked as: satisfied, partially satisfied, unsatisfied, or unproven (validation blocked).
- Technical Tasks are mapped to changed files or explicitly missing.
- Out-of-scope items are not implemented accidentally.
- Semantic intent mismatches include direct quote evidence from issue text.
- Cross-issue intent is not treated as anchor AC failure unless anchor AC text explicitly matches.

## Plan Alignment Checks

- Local-first and no-network constraints remain intact.
- Business logic stays outside UI-focused layers where applicable.
- Deterministic behavior expectations are preserved for core finance logic.
- Validation and testing expectations from planning docs are reflected in PR evidence.

## Related-Issue Boundary Checks

Flag overlap when PR adds behavior that appears assigned to sibling issues.

Common overlap signals:

- Adds endpoints/contracts owned by another story/enabler
- Adds UI behavior while source issue is enabler-only
- Includes unrelated schema/persistence changes without linkage
- Adds missing production/runtime behavior under `src/`, `electron/`, `preload`, IPC handlers, or renderer wiring while the anchor issue is test-only

Flag missing adjacency when PR omits required companion work implied by source issue and related issues, and no deferral is documented.

- If a Test issue PR must create missing production/runtime behavior before the test can run, treat that as a planning-boundary gap or cross-issue semantic conflict rather than normal Test issue delivery.

- For each additional planning issue in PR body, verify explicit coverage mapping or explicit deferral.
- If neither mapping nor deferral exists, record a traceability ambiguity finding.

## Delivery Hygiene Checks

- PR checklist state is consistent with observed command outcomes.
- PR body test claims are consistent with execution evidence.
- Draft/ready state and CI artifact/link fields are reported.
- Test framework labels match repository evidence (for example, Vitest e2e smoke vs Playwright runtime e2e).
- "Passed" wording is used only when command output or CI artifacts are present in review evidence.
- "Fully implemented" or "ready for merge" wording is used only when all anchor ACs are satisfied and no undeferred anchor tasks remain.

## Validation Evidence Checks

- Validation commands from issue were executed, or blocker was documented.
- On Windows PowerShell policy blocks, npm commands were rerun via npm.cmd.
- Failures were classified as baseline vs PR-introduced.
- When failures occurred, equivalent commands were rerun on main for baseline comparison.
- Test evidence references changed behavior, not unrelated passing tests.
- High-risk summary claims are labeled as observed, inferred, or unverified.

## Finding Classification And Confidence

- Each finding is classified as anchor-issue violation, cross-issue semantic conflict, plan alignment gap, or delivery hygiene gap.
- Each finding has confidence tag: high, medium, or low.
- Confidence is based on evidence quality:
  - High: direct code evidence plus direct issue quote and command evidence
  - Medium: direct code evidence plus inferred intent from related issue
  - Low: policy interpretation without direct behavior evidence
- Each finding includes a one-line confidence basis.

## Severity Calibration

- Delivery hygiene findings default to Low.
- Upgrade delivery hygiene to Medium only when acceptance interpretation or readiness is materially ambiguous.
- High is reserved for explicit anchor AC violation, direct incorrect behavior with evidence, or blocking validation failure.

## Output Shape Validation

- Final response uses all required sections from references/output-template.md.
- All finding class labels are in the allowed class set.
- Semantic findings include at least one direct issue quote.
- Additional planning issue status is explicit: complete or ambiguous.
- If any output-shape check fails, findings are revised before finalizing.

## Checkbox Sync Readiness

- Target issues for update are explicit from the review workflow.
- Only allowed sections are targeted: Technical Requirements, Technical Tasks, Stories Enabled, Acceptance Criteria.
- For Test issues only, additional allowed sections are: Playwright Implementation Standards, Acceptance Criteria Mapping, Test Scenarios, Pass Criteria, Regression Guard.
- Evidence map exists for each checkbox changed.
- Check-only policy is used unless user explicitly requested uncheck behavior.
- Non-checkbox text is preserved exactly.
- No PR body edits are attempted.
- No PR comments or issue comments are used for checkbox sync reporting.
- Test-issue-only checkbox sync uses hard proof per line, not section-level inference.
- Regression Guard remains unchecked unless explicit regression/fault-path evidence exists.

## Checkbox Sync Verification

- Issue body was re-read after update.
- Only expected checkbox deltas changed.
- Updated, unchanged, and ambiguous items were reported.
- No PR mutation occurred during checkbox sync.

## Reproducibility Context

- Branch name captured.
- Commit SHA captured.
- Working tree state captured (clean/dirty and notable untracked files).
- Evidence source captured (local run, CI run, or both).
