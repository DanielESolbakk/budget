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
- Never infer local worktree state from the remote branch; report `unknown` if the local check is unavailable.
- Do not stop all repair because one item is blocked. Record the blocker and continue every independent safe repair and validation task.
- Do not invent a planning issue. If no source issue can be established, mark AC coverage unverified and continue PR-only review and independent repairs. Request the issue number once in owner actions after safe independent work.
- Do not change issue checkboxes during repair. The final review may sync allowed checkboxes only when evidence requirements are met; verify every mutation.
- Keep unrelated baseline failures out of the patch, but determine their impact on PR gates and report the exact next action.
- Keep repair scope tied to the PR's source issue. Do not pull in another issue's failing tests or open a separate PR without explicit authorization; record the blocker and its owner instead.
- A linked additional issue is not blanket scope authorization. Follow the PR's explicit coverage/deferral; if it defers that issue, report its failure and stop changes for that issue.
- If that deferred issue has no open PR or assigned owner, its scope is unscheduled, not merely blocked. Report the resulting required-check failure as a blocking fact for this PR; never phrase it as an action item to go implement the other issue.
- A failing check with no owning issue at all is not blocked scope. When its fix touches only non-production text (docs, skill/instruction files, comments, assertion wording) and is mechanically defined by the failing assertion itself (a size/word limit, a lint rule, a required substring), fix it directly in step 5 without asking, validate it, and report it under `Repairs And Validation` as work done this run. Keep asking/recording a blocker for any failure whose cause is explicitly owned by another linked issue, or whose fix would touch production code, security, privacy, or architecture boundaries.
- Track each failure by head SHA, check/step, and exact assertion or error. After one targeted fix, rerun that check. If the same failure fingerprint remains, stop editing that path; report the evidence and one next action. Retry only when new evidence supports a different hypothesis, with at most two repair attempts per fingerprint.
- Keep independent fixes independent: do not revert a focused fix that passes merely because another assertion in the same file fails.
- Prefer patch-based edits for remote files. If only a whole-file write is available, read the exact current content, write once, then reread and inspect the diff. If it differs beyond intent, stop; do not retry the whole-file upload. Request a patch-capable route or owner action.

### Repair Before Final Review

- A required final review is a gate, not a substitute for repair. Finish every safe, authorized, in-scope repair before invoking `reviewing-pr-delivery`; a blocked check or deferred issue does not stop independent fixes.
- Scope the review skill's PR Body Guard to the review pass. When the user asks to repair or finish a PR, make minimal factual body corrections that are supported by current evidence, including stale check states and validation results, before final review. Do not edit the body during the review pass. A review-only request does not authorize body edits, and broader claim or scope changes still require explicit authorization.
- After a body correction, reread the live PR and verify the updated body and current head before invoking the reviewer. If the final review finds another actionable in-scope gap, return to step 5, repair it, then rerun the final review against the resulting state.

## Progress Updates

At the start, report the PR, head SHA, primary issue or `none linked`, work already evidenced in the PR, open findings, check/conflict state, and next action. After major phases and every 3-5 tool actions during longer work, report what is complete, what remains, any blocker, and the next action.

## Procedure
1. **Snapshot live state.** Read the PR title/body, branch, base and head SHAs, changed files and full diff, reviews, comments, check runs, mergeability, and local branch/worktree. Confirm whether any review matches the current head. Re-read GitHub state before publishing; never infer push success from a silent terminal.
2. **Lead with the primary issue.** Read its current title, body, acceptance criteria, labels, comments, parent/child links, and blockers. Quote each in-scope acceptance criterion exactly. Create a ledger with one row per criterion and one row per other material PR finding. Record status as `satisfied`, `partially satisfied`, `unsatisfied`, or `unproven`, plus evidence and next action. Distinguish work already present before this run from fixes made during this run. If no source issue is available, mark AC mapping unproven and proceed immediately with diff review, check/conflict diagnosis, and independent repairs; do not wait for the user to supply the issue number.
3. **Review the actual PR content.** Inspect every changed file and relevant surrounding code. Map each issue criterion to the exact implementation lines and test assertions that exercise them; do not infer delivery from PR prose, file names, or checkbox state. Review the full diff for correctness, regressions, edge cases, security/privacy, maintainability, consistency with repository architecture, and test quality. Check that tests assert meaningful outcomes through the path required by the criterion and were not weakened. Also assess the PR's deliverable shape against its source issue: whenever the diff touches a file owned by an `Additional planning issues` entry for a reason other than fully resolving that issue, report it as a scope-bundling finding (Low severity unless it creates AC ambiguity) rather than neutral background, even when the touch is small; separately flag commit-hygiene smells (committed conflict markers, debug code, commented-out blocks) with a concrete root-cause fix, not just a description. Separate required fixes from optional recommendations.
4. **Diagnose every check and conflict.** For each failed, skipped, queued, or in-progress check, inspect ordered job steps, logs, annotations, and latest activity. Classify it as PR-introduced, baseline, setup/environment, conflict-related, or pending, with evidence. Once an earlier step passes on the current head, don't rerun it or ask the owner to verify it; focus on the first failing step. `in_progress` alone does not mean stalled. If mergeability is `dirty` or the user reports a conflict, retrieve exact conflict and job evidence before asking for issue input. If the base advanced, try GitHub MCP `update_pull_request_branch` with the expected head SHA; inspect the resulting diff/checks, and resolve reported conflicts only when safe. Never force-push.
5. **Fix findings one by one.** Identify the root cause and intended result, then make the smallest in-scope fix. For behavior changes, add a regression test first. Apply the failure-fingerprint retry rule above; do not keep changing adjacent files to clear an unrelated gate. Preserve existing tests and user changes.
6. **Validate exact work.** Run focused commands for touched code/tests, then required issue/PR commands when feasible. Record the exact command, result, local SHA, and provenance. Local or dirty-worktree output is diagnostic only; it is not PR-head proof. For CI setup failures, make one cheap disconfirming rerun. For baseline failures, verify against the base or unchanged files and do not broaden the patch to unrelated debt.
7. **Publish safely.** Stage only intended files/hunks and inspect the staged diff. Confirm the branch and live remote head match the expected parent, then commit and push to the existing PR branch using repository-approved tooling. If GitHub MCP cannot apply a patch, use the checked-out PR branch and normal Git workflow if available. Never use `gh`, force-push, overwrite an intervening commit, or claim a push succeeded until GitHub reports the new SHA. If authentication or permissions block publishing, finish all safe local analysis and repairs, then give one precise owner action.
8. **Run mandatory final review.** After actionable repair work is complete or explicitly blocked, invoke `reviewing-pr-delivery` on the exact current PR URL/head SHA before reporting. Do this even when the issue is unavailable; the reviewer must use PR-only mode and leave AC coverage unverified. Prefer fresh context; otherwise perform a distinct same-context review and disclose it. If review finds a material gap, return to step 5 and repeat. Sync issue checkboxes only when source and proof requirements are met. Treat the reviewer's full output as internal evidence only, never as user-facing text: pull material findings, the review-state line, and any checkbox mutations into the six sections below, then discard the rest.

### Report Discipline

- The six `Required User-Facing Report` sections below are the entire user-facing deliverable. Never append the reviewing-pr-delivery output template, an Evidence Index, a Coverage Summary, a Per-Story Decision Log, or a Checkbox Sync Matrix alongside them.
- Open `Still Open` with one sentence naming whether the required/blocking check passes on the current head SHA, and the exact reason if it does not, before any other item.
- `Owner Action` states a decision or authorization about *this* PR. Never phrase it as an instruction to implement, repair, or complete a different issue's scope, especially one with no open PR or assigned owner; put that scope gap in `Still Open` as a blocking fact, and phrase `Owner Action` as the decision the owner actually faces for this PR (keep the check required and wait, change the check's required status, or explicitly authorize pulling that fix into this PR).
- When a failing check's cause is unowned by any linked issue and the fix is small, safe, and non-behavioral (see Operating Rules), fix it in this run and report it under `Repairs And Validation`; do not raise it as an `Owner Action` question. Reserve `Owner Action` for decisions that genuinely require another party's authorization: cross-issue scope explicitly owned elsewhere, production-behavior changes, or missing credentials/permissions.
- A scope-bundling or commit-hygiene design finding is not closed just because this PR already fixed the immediate symptom (for example, removed committed conflict markers). If the root-cause prevention — a guard, a lint rule, or a norm against bundling unrelated issues in one PR — is still missing, report it in `Still Open` with a concrete root-cause fix, even when nothing else in that area is currently failing.

## Required User-Facing Report
Always include these sections, even when blocked, and nothing else. Keep narrative under 100 words, excluding exact AC quotes and required evidence tables. State each fact once, reference shared proof by evidence ID, and omit tool narration and background that does not change a decision.

### Status

PR URL, current head SHA, branch, review state, and whether the worktree/PR branch is clean or has local changes.

### Primary Issue Progress

List each in-scope AC once with exact quote or ID, disposition, implementation/test evidence, and remaining gap. Distinguish prior PR work from this run. If no source issue exists, state that coverage is unverified and name the missing input; still report the technical review.

### Repairs And Validation

State prior PR work separately from this run. Include useful passed checks as well as failures, with SHA and provenance. Never say `None` when a repair was delivered.

### Still Open

Open with one sentence stating whether the required/blocking check passes on the current head SHA, and the exact reason if not. List only unresolved material findings, failed/pending checks, missing evidence, conflicts, scope-bundling or commit-hygiene design findings, and PR-body defects. Give one next action and whether it was attempted; reference the ledger ID instead of repeating evidence.

### Owner Action

State a decision or authorization about this PR; never an instruction to go complete a different, unstarted issue's scope (see Report Discipline). Include only decisions, permissions, or repairs requiring the user or an authorized maintainer. Do not ask them to repeat evidence or work already completed. Otherwise write `None`.

## Repair Ledger

| Item | Evidence | Action / state |
|---|---|---|
| R1 | [issue AC/finding; path, assertion, job, or SHA] | [attempted action; open/fixed/blocked] |

Keep one row per material AC or finding. Use its ID in other sections rather than restating it. Record prior PR work, this-run changes, attempted actions, and outcomes here. Local-only passes and checkbox state do not prove completion.

## Stop Conditions

Stop only the affected action when it would require unsafe/destructive work, an unauthorized decision, unavailable credentials, or a genuinely irreconcilable conflict. First attempt safe alternatives and continue independent repairs. Do not stop merely because an issue link is absent, CI is pending, a tool call failed, or one check is blocked. Never ask for secrets in chat. When a hard blocker remains, report the evidence, attempts, completed work, remaining work, and one exact owner action.

## Completion Gate

Do not say the PR is fixed or complete until required checks on the current pushed SHA are conclusive, primary issue criteria have evidence-based dispositions or are marked unverified because no issue is linked, material findings are resolved or precisely blocked, and the mandatory final `reviewing-pr-delivery` pass finds no material gaps. Never merge. If any gate remains open, say `not complete` and make the remaining work unmistakable.
