---
name: repairing-pr-delivery
description: Use when an open pull request has review findings, unresolved acceptance-criteria checkboxes, missing tests, validation gaps, or delivery-hygiene defects and the user expects the work completed on that PR.
---

# Repairing PR Delivery

## Overview

Own the repair cycle between delivery reviews: fix every actionable PR finding, validate and push to its existing branch, wait for CI on the new head, then request a fresh review. Finish only when current-head checks pass and no material findings remain. Never merge.

## When to Use

Use after a delivery review when asked to fix findings, close evidence gaps, or finish the PR, including unchecked items caused by missing implementation or validation.

Do not use to make a merge decision or to repair unrelated repository debt.

## Required Skills

- **REQUIRED:** `reviewing-pr-delivery` for both reviews and issue-checkbox sync; `verification-before-completion` before completion claims.
- **BUGS:** Use `systematic-debugging` and `test-driven-development` for behavior changes/regression tests.
- **WHEN APPLICABLE:** Use `issue-planning-governor` for invalid planning/readiness and `playwright-skill` for Playwright work.

## Operating Contract

Fix every actionable review finding and material defect in the PR's full diff, tests, validation claims, or metadata, even outside the anchor issue. Keep unrelated baseline debt and speculative work out of scope.

Do not substitute checkboxes for fixes, local output for PR-head proof, or queued CI for a pass. Never change issue checkboxes during repair; the final review skill syncs them from evidence. Correct author-owned PR-body claims and mappings between reviews, using observed results only.

## Repair Loop

1. **Establish state.** Read the review, PR, linked issues, head SHA, branch, checks, and worktree. If review is missing or its SHA is stale, run `reviewing-pr-delivery` on the current head before editing.
2. **Track full scope.** Put every finding, unchecked item, and applicable PR-body mismatch in a ledger with required outcome, fix, validation, and status. Inspect the whole diff and touched behavior for material regressions, privacy/security risks, broken tests, and inaccurate claims. Do not stop at the anchor issue or invent unrelated work.
3. **Fix and prove.** Trace each gap, use debugging/TDD, preserve tests, and correct author-owned PR mappings or claims between reviews. Run required commands for the exact revision. Leave issue checkboxes to the final review.
4. **Commit and push safely.** Use `npm.cmd` on Windows; record outputs and SHA. Inspect full/staged diffs; stage only repair hunks. Confirm branch and remote head, safely reconcile advances, then commit verified changes to the existing PR using repo-approved tools (GitHub MCP where required). Never stage all, overwrite, force-push, or create a duplicate. On permission/conflict blockers, give one owner-action checklist and stop.
5. **Wait, then re-review.** Require conclusive CI on the pushed SHA; diagnose failures and repeat. Pending/timed-out jobs are not passes. After success, request fresh-context `reviewing-pr-delivery`, preferably via `reviewer` or a new session, with only PR URL/current SHA. Let it rebuild evidence and sync/verify permitted checkboxes. Disclose same-context fallback if necessary.
6. **Repeat or finish.** New findings, sync mismatches, or code/test edits restart the loop and stale prior review. Finish only after current-SHA CI passes and fresh review finds no material gaps. Never merge.

## Repair Record

Keep a compact ledger while working:

| Finding | Required outcome | Change or evidence | Validation SHA/result | Status |
|---|---|---|---|---|
| R1 | Exact observable behavior or hygiene outcome | Files/PR metadata changed | Command or CI result | Open/verified |

Record a fix or reasoned deferral for each item. A deferral is unresolved work, not completion.

## Rationalizations And Red Flags

| Tempting rationale | Required response |
|---|---|
| "Only the owning issue matters." | Fix all actionable material PR findings, including linked-scope and hygiene gaps. |
| "The feature #24 mapping is a separate outstanding PR concern and is out of this test-issue scope." | Resolve every material finding within the authorized PR repair, even when it is outside the anchor issue. |
| "The local test passed, so the box can be checked." | Require evidence for the current PR SHA/path; let the review skill sync checkboxes. |
| "CI is taking too long; call it done." | Pending is unresolved; wait for current-head checks. |
| "Stage everything so no work is lost." | Keep unrelated edits unstaged; stop if changes cannot be isolated. |
| "A second review in this chat is independent enough." | Prefer a fresh reviewer given only current PR URL/SHA; disclose fallback. |
| "The PR is fixed; no need to re-review." | A pushed change invalidates prior review evidence; request a fresh pass. |

**Red flags - stop:** checkbox-only fixes; local/base-SHA proof claims; skipped related findings; unrelated files staged; wrong-branch or force push; pending CI called green; no fresh current-SHA review.

## Quick Reference

| State | Next action |
|---|---|
| No review or current SHA mismatch | Review current head first |
| Findings remain | Fix, prove, and update ledger |
| Local pass/CI pending | Wait for current-head CI |
| CI fails | Diagnose, fix, and repeat |
| CI passes | Request fresh review |
| Fresh review clean; sync verified | Report completion; do not merge |

## Common Mistakes

- Anchor-only fixes: inspect the full PR diff and ledger.
- Local output as proof: record the tested SHA.
- Early checkbox edits: defer to the review skill.
- Unrelated changes staged: isolate the staged diff.
- Same-context final review: prefer fresh context.
- Pending CI called complete: keep repair open.
