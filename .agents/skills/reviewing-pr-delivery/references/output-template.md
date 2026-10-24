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

List each unresolved checkbox item exactly once. Separate delivery evidence from issue checkbox state:
- For a genuine delivery gap, name what is missing, the evidence/path gap, one implementation or validation fix, and a `Next Issue` reference or minimal new-issue plan for every unchecked feature story.
- For code/tests proved complete but an unchecked issue box, label it `stale tracking checkbox`; give the live pre-state, target state, and sync result. If the update form is awaiting owner submission, say `sync pending (no mutation or post-read)` and give the concrete `Next Action` to submit the edit and re-read the issue. Do not describe this as missing product work or claim it is left unchecked without a confirming read. For a sync-only story, use `Next Issue: none (tracking-only; no new implementation issue needed)`.
- Use one row per checkbox item and issue. Map each Test issue criterion to that issue's own assertions and reviewed-SHA validation; do not group criteria or infer child-test completion from parent evidence.
- Preserve each checkbox's complete wording and assess all clauses in a conjunctive item together. Do not split one checkbox into invented sub-items; report the item's weakest unmet clause/path as `partially satisfied` or `unproven`.

- [G1] #ISSUE § Section — Item | Delivery: [satisfied|partial|unproven] | Checkbox: [pre-state → target; synced|stale tracking checkbox|sync pending] | Post-read: [state or not available] | Reason: [specific evidence or blocker] | Action: [one action] | Next Issue/Action: [issue reference or tracking-only owner action]

If no unchecked gaps remain: `None.` In PR-only mode use `None (no issue checkbox items are in scope).`

## Per-Story Decision Log

List each feature story considered with its exact text, target state, pre-state, post-state, and reason. For every checked story, include `CODE_PROOF`, `VALIDATION_PROOF`, and `MUTATION_PROOF`. If no feature stories are in scope: `None.`

In PR-only mode use `None (no source issue resolved).`

| Story  | Target  | Pre     | Post    | Decision   |
| ------ | ------- | ------- | ------- | ---------- |
| [text] | [state] | [state] | [state] | [decision] |

## Checkbox Sync Matrix

Include every allowed checkbox item considered on the primary and related issues, including unchanged items. Record the delivery status independently from checkbox pre/target/post state. Record post-read state for every completed mutation; if an update awaits submission, use `sync pending (no mutation or post-read)`.

| Issue | Section | Item | Delivery | Pre | Target | Evidence | Post / sync result |
| ----- | ------- | ---- | -------- | --- | ------ | -------- | ------------------ |
| #NUM | [section] | [item] | [status] | [pre] | [target] | [E#] | [post-read or sync pending] |

## Checkbox Gap Closure

Give one compact next-step reference for each unresolved gap ID from `Not Checked — How To Fix`; do not restate the checkbox item.

- G1: [next action]

If no gaps remain: `None.` In PR-only mode use `None (no issue checkbox sync attempted).`

## Other Issues

List residual risks or hygiene notes not already captured in Findings. If none: omit this section.
