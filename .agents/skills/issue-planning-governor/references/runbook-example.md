# Compact Runbook Example

This runbook demonstrates one complete issue rewrite cycle for a single planning issue.

## Scenario

- Goal: Rewrite one Story issue to be assignable and planning-valid.
- Inputs: issue body, labels, recent validation comments, linked parent issues.
- Constraint: keep scope to one dominant ownership layer.

## Step 1: Preflight

- Read issue body, labels, and latest bot comments.
- Identify issue type and required headings.
- Verify parent epic and feature alignment.
- Check implementation entry points for assignment safety.

## Step 2: Rewrite

- Apply the Story template from references/templates.md.
- Keep acceptance criteria concise and testable.
- Move non-existent file paths from Implementation Entry Points into Technical Tasks.
- Confirm blockers are explicit and non-circular.

## Step 3: Validate

- Record current labels/comments and trigger time, then require a fresh user-originated `validate-planning` event.
- Treat only post-trigger status changes or new validation comments as results. A pre-existing `planning-invalid` label is stale state.
- If no fresh signal appears within 180 seconds, stop and escalate. Do not enter repair.
- After a fresh failure, inspect the marker, repair only reported failures, and revalidate; stop after two attempts.

## Step 4: Readiness

- Run G1-G9 and the assignment-readiness deep dive; include quoted proof for each pass.
- Mark G9 not applicable only when there is no renderer-visible work.

## Step 5: Finalize

- Publish a short summary:
  - what changed
  - why it changed
  - current validation state
  - remaining blockers and next issue
- Save evaluation notes in local eval artifacts, not in the issue body.

## Example Output Snippet

Updated issue #89 to match the Story template, narrowed scope to renderer integration, and moved file-creation paths into Technical Tasks. A fresh validation event completed with no planning-invalid label; G1-G9 evidence is recorded. Remaining blocker: #101.
