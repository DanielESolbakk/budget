---
name: reviewing-pr-delivery
description: Reviews a pull request against its source planning issue, repository plan documents, and related planning issues to detect missing scope, overlaps, regressions, and acceptance-criteria gaps. Use when the user asks for PR review, scope alignment checks, or issue-to-PR coverage validation.
compatibility: Requires GitHub issue/PR read tools, local repository file access, and diff inspection.
metadata:
  owner: budget-repo
  workflow: pr-review
  version: "1.1"
---

# Reviewing PR Delivery

Use this skill for findings-first review of one PR against the source planning issue, plan artifacts, and related planning issues.

## Scope

In scope:
- AC coverage and missing-scope checks
- Plan alignment checks against `plan.md` and planning docs
- Related-issue overlap and gap checks
- Validation-evidence and claim-discipline checks
- Mandatory issue-body checkbox sync based on review evidence

Out of scope:
- Implementing code fixes
- Broad issue-body rewrites or label changes
- Merge decisions

## Required Inputs

- PR URL or number
- Repository owner/name
- Source issue number if PR linkage is ambiguous

If the source issue cannot be determined, stop and ask for exactly one issue number.

## Workflow

1. Gather PR title/body, diff, changed test files, linked issues, and Copilot completion signal.
2. Resolve one primary source issue plus the related-issue set from the PR body and source issue.
3. Validate planning inputs before content review:
  - source and related planning issues are not labeled `planning-invalid`
  - `Blocked by` references are resolved or explicitly accepted in PR scope
  - required `Implementation Entry Points` exist in the repository or are reported as blockers
4. Read at least `plan.md` and `docs/ways-of-work/plan/budget-planner/implementation-plan.md`.
5. Build coverage and overlap analysis:
   - classify each AC as `satisfied`, `partially satisfied`, `unsatisfied`, or `unproven (validation blocked)`
   - use direct quotes for semantic mismatches
   - distinguish test issue verification from missing production/runtime behavior
   - compare PR claims with observed evidence and flag ambiguity on zero-file composition enablers
  - determine `User-interactable readiness` for the delivered scope (`yes|partial|no`) from renderer -> preload -> IPC -> service evidence
6. Run validation commands from the issue when possible; if blocked, record the blocker and classify baseline vs PR-introduced failure when applicable.
  - if a command fails before executing tests or assertions, classify the failure as `environment/setup` until one disconfirming rerun is attempted
  - on Windows PowerShell, prefer `npm.cmd` over `npm` for validation commands
  - when validating a temporary PR-head checkout, ensure dependencies resolve from the workspace install before treating runtime startup errors as product failures
7. Reconcile issue-body checkbox state to proved review outcome for allowed sections:
   - capture pre-sync checkbox state from the live issue body
   - set target state to `checked` only for proved complete items
   - set target state to `unchecked` for items that are unproven, unsatisfied, contradicted, or explicitly deferred in this review scope
   - write only the minimal checkbox edits needed to match target state
   - re-read the issue body and verify post-sync state matches the report
8. Deliver a findings-first review using the required output template.

## Review State And Post-Fix Gate

Record these values before validation:

```text
REVIEWED_PR_SHA: [PR head SHA read from GitHub]
WORKSPACE_SHA: [local HEAD SHA]
WORKTREE_STATE: [clean|dirty]
VALIDATION_PROVENANCE: [reviewed-PR-SHA|local-worktree|CI-reviewed-SHA|environment-setup]
```

Apply these rules throughout the review:

- A command run with uncommitted changes or a workspace SHA different from `REVIEWED_PR_SHA` is `local-worktree` evidence. It may guide diagnosis, but it cannot prove PR-head acceptance criteria or test-issue pass criteria.
- If code or tests are edited after findings are produced, mark the review state `stale` immediately. Do not sync any additional acceptance-criteria or story checkboxes from those edits.
- A stale review requires a new review pass after the changed PR head is available: re-read the PR metadata and diff, capture the new SHA, rerun the issue validation commands, and rebuild the coverage and sync matrix.
- Never describe local post-fix results as fixes delivered by the PR until the changed files are present in the reviewed PR diff or equivalent reviewed-SHA CI artifact.
- A review is complete only after `REVIEWED_PR_SHA`, validation provenance, the per-issue sync matrix, and post-sync issue reads are recorded in the working notes and reflected in the final report.

## Core Rules

- Operate on one PR at a time.
- Keep the related-issue set to PR-linked planning issues plus source-issue linked sections.
- Treat test issues as verification-only unless the PR adds missing runtime behavior, which is a boundary gap.
- For additional planning issues, require explicit coverage mapping or explicit deferral.
- Use `passed` only for direct command output or CI evidence.
- Use `observed`, `inferred`, and `unverified` claim tiers.
- Do not call a test `Playwright` unless repository evidence shows Playwright tooling; if the suite uses Vitest e2e config, name it `Vitest e2e`.
- Do not say `fully implemented`, `all ACs covered`, or `ready for merge` unless all anchor ACs are satisfied and no open anchor task is deferred.

## Checkbox Sync

- Default policy is bidirectional reconciliation to evidence-based target state.
- Allowed sections: `Technical Requirements`, `Technical Tasks`, `Stories Enabled`, `User Stories In This Feature`, `Acceptance Criteria`.
- Feature user stories may be synced when the review has hard proof for the story text itself.
- Test issues may also sync `Playwright Implementation Standards`, `Acceptance Criteria Mapping`, `Test Scenarios`, `Pass Criteria`, and `Regression Guard`.
- Preserve all non-checkbox text exactly.
- Do not edit the PR body or post sync comments.

### Per-Issue Sync Matrix

Build one sync matrix covering the primary source issue and every directly related planning issue in scope:

```text
Issue | Section | Checkbox item | Pre-state | Target state | Proof artifact | Post-state
```

- Enumerate every allowed checkbox item considered, including unchanged checked items and unresolved unchecked items.
- Sync each issue whose target differs from its pre-state. Do not sync only the primary issue when a related issue has proved, contradicted, or deferred scope.
- Re-read every mutated issue body after writes. A mutation is not complete until the post-state matches the matrix; otherwise stop with the post-sync stop condition.
- Do not infer a related test issue's completion from a parent issue checkbox. Test issue evidence must match that test issue's own scope and assertions.

### PR Body Guard

- The PR body is read-only during this workflow. Never call a PR update tool to change checklist state, claims, summaries, or test evidence.
- Report PR-body mismatches as delivery-hygiene findings. Correcting them belongs to the PR author or a separate explicitly requested PR-edit workflow.

### Conditional Regression Guards

- Treat a `Regression Guard` checkbox as conditional, not as an unconditional delivery task.
- First determine whether the PR fixed a defect in that test issue's scope.
- If no defect in that scope was fixed, classify the guard as `not applicable`; leave it unchecked, do not report it as a gap or finding, and do not create a test solely to check it.
- If a defect in that scope was fixed, require a focused regression test and sync the guard only when direct test evidence proves it.

## Story-Line Handling

- If `User Stories In This Feature` uses narrative lines (not checkboxes), convert each line into an unchecked checkbox item before sync decisions.
- Conversion rule: preserve each original story sentence verbatim as the checkbox label; do not rewrite wording.
- After conversion, reconcile each story line to the proved target state.
- If conversion cannot be done one-to-one safely, do not mutate and report the blocker.

## Story-Reason Reporting

- If any feature user story ends unchecked after reconciliation, state why in the `Not Checked — How To Fix` section.
- Use one of these reasons: insufficient hard proof, evidence maps to a different issue section, narrative story text could not be matched to the PR evidence, or renderer UI trigger missing.
- Do not leave unchecked user stories without a Fix action.
- For every unchecked user story, add a **Next Issue** line: search the related-issue set and open issues for an existing issue that covers the missing scope. If one exists, reference it (`Next Issue: #NUMBER — title`). If none exists, outline a minimal new issue plan: title, parent feature, one-line scope, and the single implementation entry point needed.

## Hard-Proof Contract (Story Sync)

- A feature story may be marked `checked` only when all three proof artifacts exist:
  1. `CODE_PROOF`: direct PR diff evidence mapped to the story text. For stories expressed as "As a [user role], I want to [do something]…", CODE_PROOF requires a renderer-triggerable path (a UI component or screen the user can interact with), not only backend/IPC/preload wiring. If `User-interactable readiness` is `partial` or `no`, CODE_PROOF is absent for any story whose text implies a user action.
  2. `VALIDATION_PROOF`: passing command output or CI artifact tied to the reviewed PR-head SHA.
  3. `MUTATION_PROOF`: issue-update evidence showing the story checkbox state changed and post-update re-read confirmed it.
- `MUTATION_PROOF` is produced by a normal sync flow: write checkbox update, then re-read issue body and record the changed line.
- If CODE_PROOF and VALIDATION_PROOF exist, sync must be attempted to obtain MUTATION_PROOF.
- If any artifact remains missing after attempt, keep `unchecked` with reason `insufficient hard proof`.
- If a story's target state is `unchecked` and the pre-sync state is `checked`, sync must attempt to uncheck it and verify the post-sync state.
- Do not report an item as `left unchecked` unless the post-sync issue body actually shows it unchecked.

## Checkbox Evidence Thresholds

- `Technical Tasks` and equivalent implementation-task checkboxes may be `checked` from `CODE_PROOF` alone when the PR diff directly shows the task is completed.
- Feature `Acceptance Criteria` may be `checked` only with `VALIDATION_PROOF` tied to the reviewed PR-head SHA or equivalent reviewed-SHA CI artifact.
- `User Stories In This Feature` may be `checked` only with `CODE_PROOF` + `VALIDATION_PROOF` + `MUTATION_PROOF`.
- Test-issue `Test Scenarios` may be `checked` from `CODE_PROOF` alone when the scenario is directly represented by added test cases.
- Test-issue `Pass Criteria` may be `checked` only when the referenced assertions actually passed with PR-head or reviewed-SHA evidence.
- When only baseline evidence exists, keep `Acceptance Criteria`, feature `User Stories`, and test `Pass Criteria` unchecked.

## Output

Use [references/output-template.md](references/output-template.md) for the final report.

Before finalizing output, enforce these gates:

1. Finding integrity gate:
- Delivery hygiene defaults to Low; High only for anchor AC violation, direct incorrect behavior, or blocking validation failure.
- Semantic findings require direct issue quotes.

2. Evidence gate:
- If PR-head validation is `unproven`, AC cannot be `satisfied`.
- Framework naming must match repo evidence; otherwise use `end-to-end test`.

3. Story sync gate:
- `checked` story requires CODE_PROOF + VALIDATION_PROOF + MUTATION_PROOF.
- User-facing stories ("As a [role]…") require a renderer-triggerable path as part of CODE_PROOF; backend-only delivery does not satisfy them.
- Every story remaining unchecked must appear in `Not Checked — How To Fix` with a fix action and a Next Issue reference or new-issue plan.
- Conditional `Regression Guard` items with no defect fixed in their issue scope are `not applicable` and are excluded from checkbox-gap reporting.

4. Output completeness gate:
- All three required sections must be present: `Findings`, `Checked Off`, `Not Checked — How To Fix`.
- Every applicable unchecked or failed-to-reconcile item must appear in `Not Checked — How To Fix` exactly once.
- `Not applicable` conditional regression guards must not be listed as unchecked gaps; they may be summarized once as an applicability note when useful.

5. Review-state gate:
- The final report names `REVIEWED_PR_SHA` and validation provenance for every positive acceptance-criteria claim.
- If the workspace is dirty or differs from the reviewed PR SHA, local results are labeled `observed local-worktree evidence` and cannot produce `satisfied` for proof-gated items.
- If the review became stale after an edit, the final report must say so and must not claim that the edit resolved the PR findings.
- Every issue mutation appears in the per-issue sync matrix with matching post-read evidence.
- No PR body mutation occurred during the review.

If any gate fails, revise before final output.

## Severity Model

- High: anchor-issue acceptance criteria clearly violated, incorrect behavior with direct evidence, or blocking validation failure
- Medium: cross-issue semantic conflict, contract ambiguity, missing guardrails/tests, or likely future defect
- Low: clarity, maintainability, or minor scope hygiene concerns

Do not assign High severity to cross-issue conflicts unless anchor AC text is explicitly violated.

Delivery hygiene findings should be Low by default unless they create material AC or readiness ambiguity.

## Additional Planning Issue Policy

If PR body lists additional planning issues, require one of:
- explicit coverage mapping for each additional issue, or
- explicit deferral statement for each additional issue

If neither exists, report a traceability ambiguity finding.

## Evidence Provenance

- Prefer PR-head command output or CI evidence tied to the reviewed SHA for positive claims.
- If validation ran only on local main, treat it as baseline evidence; do not use it to prove PR-head behavior.
- Do not treat dependency-resolution failures, shell-policy failures, or test-runner startup failures as product validation failures until a cheap rerun rules out environment/setup causes.

## Stop Conditions
2
Stop and escalate when any apply:
1. Source issue cannot be resolved from PR context
2. PR diff cannot be retrieved (excluding empty diff when changed_files is 0 for composition enablers)
3. Required repository plan files are missing
4. Access/permission errors prevent issue or PR reads
5. Any target issue body format is not safely parseable for checkbox-only edits
6. Blocker references in composition-enabler summary cannot be verified (for example, referenced PR does not exist or is not merged)
7. Story sync attempted with CODE_PROOF + VALIDATION_PROOF present, but mutation failed due permission or write error
8. Source or required related planning issue is `planning-invalid` and not fixed in this review cycle
9. Required implementation entry-point path from the anchor issue does not exist and no documented exception applies
10. Post-sync issue body state does not match the reported checkbox outcome
11. Validation is blocked by unresolved local environment/setup failure and no reviewed-SHA CI artifact is available
12. Review state is stale because code or tests changed after findings and no new reviewed PR SHA is available
13. Any issue mutation was not verified by a matching post-sync issue read

Escalation message format:
- Blocked reason: [short reason]
- Evidence: [exact missing data/tool error]
- Requested user input/action: [one concrete action]
- Next step after action: [what will be reviewed]

## Quality Rules

- Keep review evidence-based; avoid speculative findings without artifacts.
- Prefer behavior/regression risks over style commentary.
- Separate repository baseline failures from PR regressions.
- Keep terminology consistent with repository domain language.
- Use forward slashes in all skill file paths.
- For semantic-intent findings, include quote-level evidence from the cited issue.
- For checkbox sync, preserve all non-checkbox text exactly.
- Never mutate the PR body or post PR comments as part of checkbox sync.
- Never post issue comments just to summarize checkbox sync results.
- Keep output compact: one evidence line and one fix per finding/gap; do not repeat narrative across sections.
- Never hide findings. Report all material findings across all severities.
- Expand detail only when stop conditions trigger, evidence is contradictory, or user explicitly asks for a deep dive.
- Before downgrading checkbox state from prior checked to unchecked based on failed validation, rule out obvious environment/setup causes with one cheap rerun or classify the result as blocked rather than failed.

## References

- Review signals and checks: [references/checklists.md](references/checklists.md)
- Findings output format: [references/output-template.md](references/output-template.md)
