# Checklists

## Scope And Hard Stops

- Mutate Feature, Story, Enabler, and Test issues only. Read Epic issues only to verify hierarchy.
- Never delete issues. Close only after acceptance criteria are complete or a superseding issue is linked.
- `planning-invalid` blocks readiness. A stale label does not prove a fresh validation failure.
- Keep financial content local by default; do not introduce cloud processing, telemetry, or analytics for transaction content.
- Keep product implementation out of Test issues. Test issues verify existing behavior.
- Use `- #NUMBER` for structured issue references. Avoid uncertainty terms in Technical Tasks, Acceptance Criteria, and Validation Commands.

## Preflight Checklist

Run before editing any issue.

- Read issue body, labels, and recent comments.
- Identify type: feature, story, enabler, test.
- Confirm required headings exist for type.
- Confirm parent epic and parent feature alignment.
- Confirm linked enablers/tests are same-slice unless explicitly justified by policy.
- For an issue batch, inspect the full requested set and search the same-feature Story inventory before concluding that an Enabler has no real Story to enable.
- Confirm issue references are bullet format in structured sections.
- Confirm once per batch that an authorized human can trigger fresh validation and verify its result through GitHub UI after the issue edits; MCP issue access does not imply Actions access.
- Run Test Necessity Decision and capture one outcome: no test issue needed now, or test issue required.
- If the issue is an Epic, stop before mutation; Epic lifecycle work is out of scope.
- Treat a scope or hierarchy conflict as local to that issue and its dependents. Continue unrelated issues the user authorized in the same batch unless a global blocker applies.

## Assignment-Readiness Checklist

Issue is assignable when all are true.

- Scope size: 2-4 acceptance criteria preferred.
- Scope size: 3-5 technical tasks preferred.
- Scope size: 1-2 primary validation commands preferred.
- Clarity: clear outcome in one sentence.
- Clarity: explicit out-of-scope items.
- Clarity: explicit blockers and dependencies.
- Ownership: dominant test layer per issue (unit, integration, or e2e).
- Ownership: avoid overlapping ownership across sibling issues.
- Blockers: no circular blockers.
- Blockers: blocker issues are open and relevant.
- Implementation Entry Points: if issue is immediately assignable, entry points point to existing paths.
- Implementation Entry Points: if new files are needed, list file creation under Technical Tasks.
- Technical Tasks wording: no uncertainty terms (for example "if needed", "as needed", "where applicable", "or equivalent").
- Test Necessity decision: recorded with rationale and consistent with issue body.
- If test issue required: linked open test issue exists and matches the correct pyramid layer for changed functionality.
- If test issue not required: no placeholder test tasks or stray test references remain.
- Validation: no planning-invalid label.
- Validation: validate-planning has been applied after edits and output checked.

## Validation Loop Checklist

- Update issue body and labels.
- Never use GitHub CLI (`gh`) in this repository. Use GitHub MCP for issue operations; its issue-write access does not dispatch or report GitHub Actions runs.
- Complete the authorized issue batch in dependency order, then record labels, recent comments, and time for each affected issue before the validation trigger.
- Require a fresh human-originated trigger. Prefer an authorized human applying `validate-planning` through GitHub UI; if that label is already present, have the human dispatch `planning-validation` through GitHub Actions UI with the target issue number. Bot-triggered label events may be skipped.
- The `planning-validation` `workflow_dispatch.issue_numbers` input accepts the affected issue numbers as one comma-separated value. Return the complete value once per batch instead of stopping after each issue for a separate validation run.
- Include only issue records actually edited or explicitly repaired in the validation input; do not include untouched deferred issues merely because they are related.
- Do not treat an MCP issue write or label update as proof that validation ran. Verify the fresh result from issue labels/comments and, when needed, the Actions run in GitHub UI.
- If no authorized human trigger and result-verification route is available, stop before mutation. If the route becomes unavailable after mutation, report affected issues as unvalidated; do not claim readiness.
- Count only post-trigger status changes or new validation comments. A pre-existing `planning-invalid` label is not a result.
- If no fresh signal appears within 180 seconds, stop and escalate without repair.
- On a fresh failure, fetch the newest marker comment. If it is missing, inspect workflow logs; apply a targeted repair and revalidate, with at most two attempts.
- A failed issue blocks its own readiness and dependent issues only. Continue unrelated authorized batch items; no user override can waive hierarchy, materialization, privacy, or readiness gates.

## Gate Evidence Format

Use one block after Steps 2, 3, and 4. For each PASS, include specific evidence. G9 is `N/A` only when the issue has no renderer-visible work.

```text
STEP N GATE EVIDENCE
Issue: #[number]
Gate: [step]
Timestamp: [ISO 8601]
Gate Status: [PASS|FAIL]
Decision: [continue|stop]
Labels Current: [list]
planning-invalid: [PRESENT|ABSENT]
Last 3 Comments:
1. [author | timestamp]: [snippet or none]
2. [author | timestamp]: [snippet or none]
3. [author | timestamp]: [snippet or none]
Step 3: Poll count [N]; total wait [seconds]; fresh processing signal [yes/no + detail]
Step 4: G1 [PASS/FAIL]; G2 [PASS/FAIL]; G3 [PASS/FAIL]; G4 [PASS/FAIL]; G5 [PASS/FAIL]; G6 [PASS/FAIL]; G6a [PASS/FAIL]; G7 [PASS/FAIL]; G8 [PASS/FAIL]; G9 [PASS/FAIL/N/A]
Step 4: Quoted proof for each passed deep-dive check [required]
NEXT ACTION: [Step N+1 | STOP Escalate]
```

For a batch, provide one validation input containing every edited issue that needs structural validation, for example `34,54,296`. Record the result for each issue separately.

## Escalation And Final Summary

- Escalate for timeout, permission failure, unverified hierarchy/blockers, readiness failure, or planning-invalid after two repairs.
- State blocked reason, evidence, exact owner action, and next step after owner action.
- Final summary includes changes and rationale, fresh validation evidence, Test Necessity, unit/integration/Playwright status, blockers, and follow-up links.
- Do not proceed to another issue after escalation.

## Close-With-Rationale Checklist

- Confirm closure is explicitly requested or policy-justified.
- Confirm acceptance criteria are completed or superseded.
- Add concise rationale in issue comment/body.
- Add follow-up issue references for deferred work.
- Do not delete issues.
