# Evaluation Checklist

Use this checklist to evaluate whether a skill run met repository planning governance expectations.

## Run Metadata

- Date recorded.
- Primary issue number.
- Issue type: feature, story, enabler, or test.
- Operation type: create, rewrite, close-with-rationale, or validate-only.

## Input Quality Checks

- Issue body, labels, and recent comments were reviewed before mutation.
- Required section headings for issue type were confirmed.
- Parent epic and parent feature alignment were confirmed.
- Blocker and linked issue context was reviewed.

## Mutation Quality Checks

- Changes stayed within one primary issue unless multi-issue mode was explicitly requested.
- Acceptance criteria are specific, testable, and bounded.
- Technical tasks are implementation-focused and non-duplicative.
- Implementation Entry Points are assignment-safe for current repository state.
- Out Of Scope is explicit and non-empty.
- Issue template section structure was preserved (no free-form eval narrative replaced the body).

## Traceability And Hierarchy Checks

- Issue references in structured sections use bullet format with `- #NUMBER`.
- Parent and linked issue chain is internally consistent.
- Enabler remains feature-scoped under current lint rules.
- Test issue references align with parent story or enabler.

## Validation Loop Checks

- `validate-planning` was applied after edits.
- Validation labels and comments were re-read.
- Any planning-invalid failure was repaired and re-validated.
- Final state has no unresolved planning-invalid label.

## Assignment-Readiness Checks

- Scope size is small enough for one Copilot assignment.
- Dominant ownership layer is clear.
- Validation commands are present and relevant.
- Remaining blockers are explicit and actionable.

## Output Quality Checks

- Final summary clearly states what changed.
- Final summary clearly states why it changed.
- Validation evidence is included.
- Remaining blockers and next recommended issue are included when applicable.
- Evaluation narrative and grading are stored in local eval artifacts, not pasted into live issue body.

## Scoring

- Pass: all checklist groups satisfied with no blocking failures.
- Conditional pass: minor gaps documented with follow-up issue links.
- Fail: missing validation loop, broken hierarchy, or assignment-unsafe issue body.

## Post-Run Notes

- Risks and assumptions captured.
- Follow-up issues referenced where work was deferred.
- Owner action checklist added once if permissions blocked edits.
