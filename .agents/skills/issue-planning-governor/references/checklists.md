# Checklists

## Preflight Checklist

Run before editing any issue.

- Read issue body, labels, and recent comments.
- Identify type: feature, story, enabler, test.
- Confirm required headings exist for type.
- Confirm parent epic and parent feature alignment.
- Confirm linked enablers/tests are same-slice unless explicitly justified by policy.
- Confirm issue references are bullet format in structured sections.

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
- Validation: no planning-invalid label.
- Validation: validate-planning has been applied after edits and output checked.

## Validation Loop Checklist

- Update issue body and labels.
- Apply validate-planning label.
- Re-read labels and recent comments.
- If planning-invalid appears, diagnose failure category.
- If planning-invalid appears, repair body/links/sections.
- If planning-invalid appears, re-apply validate-planning.
- Stop only after clean validation or explicit user override.

## Close-With-Rationale Checklist

- Confirm closure is explicitly requested or policy-justified.
- Confirm acceptance criteria are completed or superseded.
- Add concise rationale in issue comment/body.
- Add follow-up issue references for deferred work.
- Do not delete issues.
