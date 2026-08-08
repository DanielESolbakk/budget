# Repair Playbooks

Autonomous repair loop usage

- Read the newest marker comment (`<!-- planning-validation-marker -->`) and copy each bullet failure verbatim.
- Map each failure to exactly one playbook below.
- Apply minimal body edits and re-run validate-planning.
- Repeat with a maximum of 2 attempts per issue run.

## Playbook 1: planning-invalid with section format failures

Symptoms

- bot comment references missing headings or bad section extraction.

Fix

- Ensure required headings for issue type are present.
- Ensure each issue reference in structured sections is bullet format: `- #NUMBER`.
- Remove inline/comma-separated refs from structured section bodies.
- Re-apply validate-planning.

## Playbook 2: Parent mismatch or cross-feature contamination

Symptoms

- story/enabler/test references parent feature from another slice.

Fix

- Verify Parent Feature Issue and Parent Epic Issue chain.
- Re-anchor linked enablers/tests to same feature slice unless policy explicitly allows otherwise.
- Update Related Planning Issues to reflect real ownership.
- Re-apply validate-planning.

## Playbook 3: Enabler feature-scope violations

Symptoms

- one enabler tries to enable stories from multiple feature parents.

Fix

- Keep enabler scoped to one parent feature issue.
- Move cross-feature concerns into separate enabler issues.
- Update dependent stories/tests blockers accordingly.
- Re-apply validate-planning.

## Playbook 4: Assignment unsafe due to non-existent entry points

Symptoms

- issue is intended for assignment now but Implementation Entry Points include paths that do not exist.

Fix

- Move non-existing file paths to Technical Tasks as create actions.
- Keep Implementation Entry Points at existing path level.
- If strict path-exists policy must hold for assignment, verify all listed entry points exist.
- Re-apply validate-planning if body changed.

## Playbook 5: Over-sized issue for Copilot assignment

Symptoms

- too many ACs/tasks, mixed ownership layers, broad/unbounded scope.

Fix

- Split issue by ownership layer or artifact boundary.
- Reduce to concise AC set and commands.
- Add explicit blockers and follow-up links.
- Preserve traceability from parent feature.

## Playbook 6: Permission mismatch on issue writes

Symptoms

- can comment but cannot edit body/labels.

Fix

- Post one concise owner action checklist.
- Stop retries unless permissions change.
- Continue only after explicit user direction.

Owner escalation message template

- Blocked reason: [concise reason]
- Evidence: [label/comment/error or missing capability]
- Requested owner action: [exact change needed]
- Next step after owner action: [planned continuation]

## Playbook 7: Linked Enabler Issues missing for Story validation

Symptoms

- bot comment reports: `Linked Enabler Issues must include at least one issue reference.`

Fix

- Confirm issue type is Story and parent feature is valid.
- Find an existing enabler in the same feature slice.
- Add the enabler under `### Linked Enabler Issues` as `- #NUMBER`.
- If no feature-scoped enabler exists, add a `Blocked by` issue entry that tracks creating the missing enabler and escalate.
- Re-apply validate-planning.
