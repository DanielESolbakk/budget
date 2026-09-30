# Findings-First Output Template

## Findings

List each material finding first and reference supporting artifacts by evidence ID. If no findings: `No material findings.`

1. [High|Medium|Low] Short title
   - Why: one-line AC impact or regression risk
   - Evidence: [E#]
   - Fix: one specific action

## Evidence Index

- E1: [artifact and evidence]

## Review State

```text
REVIEW_MODE: [issue-bound|PR-only]
PRIMARY_ISSUE: [#number|unresolved]
REVIEWED_PR_SHA: [sha]
WORKSPACE_SHA: [sha]
WORKTREE_STATE: [clean|dirty]
VALIDATION_PROVENANCE: [reviewed-PR-SHA|local-worktree|CI-reviewed-SHA|environment-setup]
```

## Coverage Summary

| Issue | AC   | Status   | Evidence | Path/gap  |
| ----- | ---- | -------- | -------- | --------- |
| #NUM  | AC-1 | [status] | E#       | [path]    |

In PR-only mode, replace the table with: `Issue/AC alignment: unverified (no primary source issue resolved). No issue checkbox sync was attempted.` Do not invent AC rows.

User-interactable readiness: [yes/partial/no] — [one-line reason for the reviewed scope].

## Checked Off

List every checkbox item set to checked or confirmed already checked during this review.

- #ISSUE § Section — Item (proof: code diff | CI pass | test output)

If nothing was checked: `None.` In PR-only mode use `None (PR-only review; no issue checkbox sync).`

## Not Checked — How To Fix

List each unresolved checkbox item exactly once. Give it a stable gap ID and include pre-state, post-state, blocking reason, one fix, and a `Next Issue` reference or minimal new-issue plan for every unchecked feature story.

- [G1] #ISSUE § Section — Item | Pre: [state] | Post: [state] | Blocked by: [reason] | Fix: [one action] | Next Issue: [#NUMBER — title or new-issue plan, if feature story]

If no unchecked gaps remain: `None.` In PR-only mode use `None (no issue checkbox items are in scope).`

## Per-Story Decision Log

List each feature story considered with its exact text, target state, pre-state, post-state, and reason. For every checked story, include `CODE_PROOF`, `VALIDATION_PROOF`, and `MUTATION_PROOF`. If no feature stories are in scope: `None.`

In PR-only mode use `None (no source issue resolved).`

| Story  | Target  | Pre     | Post    | Decision   |
| ------ | ------- | ------- | ------- | ---------- |
| [text] | [state] | [state] | [state] | [decision] |

## Checkbox Sync Matrix

Include every allowed checkbox item considered on the primary and related issues, including unchanged items. Record post-read state for every mutation.

| Issue | Section   | Item   | Pre   | Target   | Evidence | Post   |
| ----- | --------- | ------ | ----- | -------- | -------- | ------ |
| #NUM  | [section] | [item] | [pre] | [target] | [E#]     | [post] |

## Checkbox Gap Closure

Give one compact next-step reference for each unresolved gap ID from `Not Checked — How To Fix`; do not restate the checkbox item.

- G1: [next action]

If no gaps remain: `None.` In PR-only mode use `None (no issue checkbox sync attempted).`

## Other Issues

List residual risks or hygiene notes not already captured in Findings. If none: omit this section.
