---
name: repairing-pr-delivery
description: Use when an open pull request has review findings, unmet issue acceptance criteria, code or test defects, failed or stalled CI, merge conflicts, or the user asks to finish the PR.
---

# Repairing PR Delivery

## Overview

Repair the PR, do not stop at diagnosing it. Center progress on the primary GitHub issue when available, inspect the exact PR diff and tests, make safe authorized fixes, and tell the user what was already delivered, what this run changed, and what remains. Never merge.

## When to Use

Use when asked to fix PR findings, close issue acceptance-criteria gaps, repair code or tests, diagnose failed or stalled checks, resolve a branch conflict, or finish delivery.

Do not use to make a merge decision or to repair unrelated repository debt.

## Required Skills

- Use `reviewing-pr-delivery` for the mandatory final review and evidence-based issue checkbox sync when issue evidence is available.
- Use `systematic-debugging` and `test-driven-development` for behavior defects and regression tests.
- Use `issue-planning-governor` for planning-invalid or issue-readiness work, and `playwright-skill` for Playwright changes.
- Use `verification-before-completion` before completion claims.

## Operating Rules

- Use GitHub MCP for GitHub issue and PR operations. Never use GitHub CLI (`gh`).
- Never merge, force-push, overwrite user changes, stage everything, or claim a check passed without current-head evidence.
- Do not stop all repair because one item is blocked. Record the blocker and continue every independent safe repair and validation task.
- Do not invent a planning issue. If no source issue can be established, mark AC coverage unverified and continue PR-only review and independent repairs. Request the issue number once in owner actions after safe independent work.
- Do not change issue checkboxes during repair. The final review may sync allowed checkboxes only when evidence requirements are met; verify every mutation.
- Keep unrelated baseline failures out of the patch, but determine their impact on PR gates and report the exact next action.

## Progress Updates

At the start, report the PR, head SHA, primary issue or `none linked`, work already evidenced in the PR, open findings, check/conflict state, and next action. After major phases and every 3-5 tool actions during longer work, report what is complete, what remains, any blocker, and the next action.

## Procedure
1. **Snapshot live state.** Read the PR title/body, branch, base and head SHAs, changed files and full diff, reviews, comments, check runs, mergeability, and local branch/worktree. Confirm whether any review matches the current head. Re-read GitHub state before publishing; never infer push success from a silent terminal.
2. **Lead with the primary issue.** Read its current title, body, acceptance criteria, labels, comments, parent/child links, and blockers. Quote each in-scope acceptance criterion exactly. Create a ledger with one row per criterion and one row per other material PR finding. Record status as `satisfied`, `partially satisfied`, `unsatisfied`, or `unproven`, plus evidence and next action. Distinguish work already present before this run from fixes made during this run. If no source issue is available, mark AC mapping unproven and proceed immediately with diff review, check/conflict diagnosis, and independent repairs; do not wait for the user to supply the issue number.
3. **Review the actual PR content.** Inspect every changed file and relevant surrounding code. Map each issue criterion to the exact implementation lines and test assertions that exercise them; do not infer delivery from PR prose, file names, or checkbox state. Review the full diff for correctness, regressions, edge cases, security/privacy, maintainability, consistency with repository architecture, and test quality. Check that tests assert meaningful outcomes through the path required by the criterion and were not weakened. Separate required fixes from optional recommendations.
4. **Diagnose every check and conflict.** For each failed, skipped, queued, or in-progress check, inspect the job steps, logs, annotations, and latest available activity. Classify it as PR-introduced, baseline, setup/environment, conflict-related, or pending, with evidence. `in_progress` alone does not mean stalled. If mergeability is `dirty` or the user reports a conflict, make the next action retrieving the exact conflict and job-step evidence, not asking for a missing issue number or waiting on analysis jobs. If the base advanced and the branch can be safely updated, try GitHub MCP `update_pull_request_branch` with the expected current head SHA, then inspect the resulting diff and checks. If it reports conflicts, inspect and resolve the specific conflicts when safe; never force-push. Continue other repairs even when conflict resolution is blocked.
5. **Fix findings one by one.** For each actionable finding, identify its root cause, state the intended observable result, and make the smallest safe fix. For behavior changes, add or update a regression test first and verify the failure before implementation. For documentation or metadata defects, make the minimal edit and run a targeted check. Preserve existing tests and user changes. Do not substitute recommendations for fixes when the issue is actionable and within scope.
6. **Validate exact work.** Run focused commands for touched code/tests, then required issue/PR commands when feasible. Record the exact command, result, local SHA, and provenance. Local or dirty-worktree output is diagnostic only; it is not PR-head proof. For CI setup failures, make one cheap disconfirming rerun. For baseline failures, verify against the base or unchanged files and do not broaden the patch to unrelated debt.
7. **Publish safely.** Stage only intended files/hunks and inspect the staged diff. Confirm the branch and live remote head match the expected parent, then commit and push to the existing PR branch using repository-approved tooling. If GitHub MCP cannot apply a patch, use the checked-out PR branch and normal Git workflow if available. Never use `gh`, force-push, overwrite an intervening commit, or claim a push succeeded until GitHub reports the new SHA. If authentication or permissions block publishing, finish all safe local analysis and repairs, then give one precise owner action.
8. **Run mandatory final review.** After actionable repair work is complete or explicitly blocked, invoke `reviewing-pr-delivery` on the exact current PR URL/head SHA before reporting. Do this even when the issue is unavailable; the reviewer must use PR-only mode and leave AC coverage unverified. Prefer fresh context; otherwise perform a distinct same-context review and disclose it. If review finds a material gap, return to step 5 and repeat. Sync issue checkboxes only when source and proof requirements are met.
## Required User-Facing Report
Always report these sections, even when blocked:

### Status

PR URL, current head SHA, branch, review state, and whether the worktree/PR branch is clean or has local changes.

### Primary Issue Progress

For each in-scope acceptance criterion: its exact quote or ID, status, implementation path/line evidence, test path/line evidence, and what remains. Summarize work already in the PR separately from work completed during this repair. If no source issue is available, say acceptance-criteria coverage is unverified and identify the exact missing input; do not hide the independent PR review.

### Repairs And Validation

List each finding fixed, files changed, commit and pushed SHA when applicable, and validation results tied to their actual provenance. Distinguish current-head CI from local diagnostics.

### Still Open

List every unresolved material finding, failed or pending check, missing criterion/evidence, conflict, and PR-body issue. For each, give the concrete next action and say whether it was attempted. Keep optional code/test quality recommendations separate from required delivery gaps.

### Owner Action

Include only actions that genuinely require the user or an authorized maintainer. Make them specific (for example, resolve a named permission or provide the primary issue number). A blocked item does not erase completed work or prevent reporting other remaining findings.

## Repair Ledger

| Item | Source (issue AC or PR finding) | Required result | Exact code/test or CI evidence | Action attempted | State |
|---|---|---|---|---|---|
| R1 | [quote or finding] | [observable result] | [path:line, assertion, job, or SHA] | [change/check attempted] | [open/fixed/blocked] |

Keep the ledger current throughout the run. No item is complete based on intent, a local-only pass, or a checkbox.

## Stop Conditions

Stop only the affected action when it would require unsafe/destructive work, an unauthorized decision, unavailable credentials, or a genuinely irreconcilable conflict. First attempt safe alternatives and continue independent repairs. Do not stop merely because an issue link is absent, CI is pending, a tool call failed, or one check is blocked. Never ask for secrets in chat. When a hard blocker remains, report the evidence, attempts, completed work, remaining work, and one exact owner action.

## Completion Gate

Do not say the PR is fixed or complete until required checks on the current pushed SHA are conclusive, primary issue criteria have evidence-based dispositions or are marked unverified because no issue is linked, material findings are resolved or precisely blocked, and the mandatory final `reviewing-pr-delivery` pass finds no material gaps. Never merge. If any gate remains open, say `not complete` and make the remaining work unmistakable.
