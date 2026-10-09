# Evaluation Checklist

Use this checklist to evaluate whether a skill run met repository planning governance expectations.

## Run Metadata

- Date recorded.
- Primary issue number.
- Issue type: feature, story, enabler, or test.
- Operation type: create, rewrite, close-with-rationale, or validate-only.
- Epic issues may be inspected for hierarchy but are not mutated by this skill.

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

## Materialization Checks

- Unscheduled or deferred ideas remained roadmap-only.
- Each Enabler enables a real same-Feature Story; no Story exists only to satisfy validation.
- Each Test has an immediate Story/Enabler owning delivered or active implementation, one dominant layer, executable scenarios, and a runnable command.
- No coverage anchors, reserved scenarios, placeholder commands, or validator-only Tests were created.

## Validation Loop Checks

- `validate-planning` was applied after edits.
- Baseline labels/comments and trigger time were recorded; only a fresh post-trigger signal was accepted.
- Validation labels and comments were re-read after the fresh signal.
- Any planning-invalid failure was repaired and re-validated.
- No repair was attempted from a pre-existing label or after a validation timeout.
- Final state has no unresolved planning-invalid label.

## Assignment-Readiness Checks

- Scope size is small enough for one Copilot assignment.
- Dominant ownership layer is clear.
- Validation commands are present and relevant.
- Structural workflow success was not treated as readiness; `needs-grooming` remains until G1-G9 pass.
- G1-G9 passed, with quoted evidence; G9 is not applicable only when there is no renderer-visible work.
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
