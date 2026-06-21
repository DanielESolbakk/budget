# Repair Playbooks

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
