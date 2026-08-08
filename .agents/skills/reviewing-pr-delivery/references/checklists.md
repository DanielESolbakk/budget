# PR Review Checklist

## Source Issue Resolution

- Primary issue is unique and selected as the review anchor.
- Anchor issue has ACs and validation commands.
- Related-issue set combines PR-linked planning issues and source-issue links.
- Source and required related planning issues are not `planning-invalid`.
- `Blocked by` references are resolved or explicitly treated as scope blockers.
- Required `Implementation Entry Points` paths exist, or missing paths are reported as blockers.

## Issue Coverage Checks

- Every AC is classified as `satisfied`, `partially satisfied`, `unsatisfied`, or `unproven (validation blocked)`.
- Technical tasks are mapped to changed files or marked missing.
- Semantic mismatches include a direct quote from the issue text.
- Cross-issue intent is not treated as anchor AC failure unless the anchor text requires it.

## Plan Alignment Checks

- Local-first and no-network constraints remain intact.
- Deterministic behavior stays intact for finance logic.
- Validation and testing expectations from plan docs are reflected in the PR evidence.

## User Interactivity Check

- Classify `User-interactable readiness` as `yes`, `partial`, or `no` for the reviewed scope.
- `yes` requires renderer-triggerable path for the delivered capability, not only preload + IPC + service wiring.
- `partial` when backend/preload wiring exists but renderer trigger or UX flow is missing.
- `no` when capability lacks required runtime chain components.

## Related-Issue Boundary Checks

- Flag overlap when the PR adds work likely owned by a sibling issue.
- Flag gaps when companion work is implied but not addressed or deferred.
- If a Test issue PR needs missing runtime behavior, treat that as a boundary gap or semantic conflict.
- Require explicit coverage mapping or explicit deferral for each additional planning issue.

## Delivery Hygiene Checks

- PR checklist state matches observed command outcomes.
- PR body test claims match execution evidence.
- Draft/ready state and CI evidence are reported.
- Framework labels match repository evidence.
- Use `passed` only for command output or CI artifacts.
- Use `fully implemented` or `ready for merge` only when all anchor ACs are satisfied and no undeferred anchor task remains.

## Validation Evidence Checks

- Validation commands were executed or the blocker was documented.
- On Windows PowerShell policy blocks, npm commands were rerun via npm.cmd.
- Failures were classified as baseline vs PR-introduced.
- If a command fails before tests/assertions execute, attempt one cheap rerun to rule out environment/setup causes before treating it as product validation failure.
- Dependency-resolution failures, shell-policy failures, and test-runner startup errors are environment/setup blockers unless a rerun confirms the same failure under a valid repository install.
- Positive PR claims require PR-head or CI evidence tied to the reviewed SHA; local-main output is baseline evidence only.
- High-risk summary claims are labeled as `observed`, `inferred`, or `unverified`.
- If PR-head validation status is `unproven`, AC status cannot be `satisfied`.

## Finding Rules

- Allowed classes: `anchor-issue violation`, `cross-issue semantic conflict`, `plan alignment gap`, `delivery hygiene gap`.
- Delivery hygiene findings default to Low severity.
- Semantic findings need at least one direct issue quote.
- Final output must use all required sections from `references/output-template.md`.
- Coverage Summary AC labels must be logically consistent with Evidence Provenance.
- Coverage Summary includes `User-interactable readiness` with one-line reason.
- Repeated evidence prose across findings is disallowed when evidence refers to the same artifact.
- Shared artifacts must be defined once in `Evidence Index` and referenced by `E#` in each finding.
- Final output includes `Checkbox Gap Closure` with one compact next-step line for every unresolved unchecked or failed-to-reconcile checkbox item.

## Checkbox Sync Readiness

- Only allowed sections are targeted.
- Bidirectional reconciliation to evidence-based target state is the default policy.
- `User Stories In This Feature` is an allowed sync section when story evidence is sufficient.
- `Technical Tasks` may be checked from direct code diff evidence alone.
- Feature `Acceptance Criteria` stay unchecked without PR-head or reviewed-SHA validation evidence.
- Feature `User Stories In This Feature` stay unchecked without CODE_PROOF + VALIDATION_PROOF + MUTATION_PROOF.
- Test-issue `Test Scenarios` may be checked from direct test-file evidence alone.
- Test-issue `Pass Criteria` stay unchecked without passing PR-head or reviewed-SHA validation evidence.
- Do not uncheck proof-gated items based solely on an unresolved environment/setup blocker; report them as blocked until the rerun or CI evidence resolves the validator state.
- Feature user stories are syncable when the evidence map directly supports the story text, even if the issue body is narrative.
- If `User Stories In This Feature` is prose, convert each story line into an unchecked checkbox item using the exact same sentence text.
- If a feature user story is not checked, the final report must explain why.
- Narrative story text is only left untouched when conversion is unsafe or evidence maps elsewhere.
- Every untouched feature user story must have an explicit reason in the final report.
- Final report includes a per-story decision log: story text -> target checked|unchecked -> pre-state -> post-state -> reason.
- Every synced item records pre-state, target state, and post-state.
- If any story is reported `checked`, output must show it either under `Updated checkboxes` or `Already matched target state`, consistent with pre/post state.
- If an item target state is `unchecked` and pre-state was `checked`, the sync must attempt to uncheck it.
- `Target issues updated: none` cannot coexist with any item whose pre-state differs from post-state.
- If any story is reported `checked`, output must include a story proof bundle with CODE_PROOF, VALIDATION_PROOF, and MUTATION_PROOF.
- If CODE_PROOF and VALIDATION_PROOF are present for a story, the review must attempt sync to obtain MUTATION_PROOF before leaving it unchecked.
- Missing artifacts after sync attempt forces `unchecked` with reason `insufficient hard proof`.
- An item reported `left unchecked` must be `unchecked` in the post-sync issue body.
- Non-checkbox text is preserved exactly.
- No PR body edits, PR comments, or issue comments are used for sync.
- Test-issue-only sync requires hard proof per line; `Regression Guard` stays unchecked without explicit regression evidence.
- Unresolved unchecked items must be mirrored in `Checkbox Gap Closure` with the missing proof or blocker and one next action.

## Reproducibility Context

- Capture branch, commit SHA, working tree state, and evidence source.
