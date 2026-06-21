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
- Keep required template headings intact; do not replace body with evaluation narration.

## Step 3: Validate

- Apply validate-planning label.
- Re-read labels and validation comments.
- If planning-invalid appears, repair exactly what failed and re-run validation.

## Step 4: Finalize

- Publish a short summary:
  - what changed
  - why it changed
  - current validation state
  - remaining blockers and next issue
- Save evaluation notes in local eval artifacts, not in the issue body.

## Example Output Snippet

Updated issue #89 to match Story template, narrowed scope to renderer integration only, and moved file-creation paths into Technical Tasks while keeping existing module paths in Implementation Entry Points. Applied validate-planning and rechecked labels; no planning-invalid remains. Remaining blocker: #101.
