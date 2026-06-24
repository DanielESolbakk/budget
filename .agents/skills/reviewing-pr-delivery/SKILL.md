---
name: reviewing-pr-delivery
description: Reviews a pull request against its source planning issue, repository plan documents, and related planning issues to detect missing scope, overlaps, regressions, and acceptance-criteria gaps. Use when the user asks for PR review, scope alignment checks, or issue-to-PR coverage validation.
compatibility: Requires GitHub issue/PR read tools, local repository file access, and diff inspection.
metadata:
  owner: budget-repo
  workflow: pr-review
  version: "1.0"
---

# Reviewing PR Delivery

Use this skill to perform a findings-first review of a PR against:
- the source planning issue
- repository plan artifacts
- related planning issues linked from the source issue

## Scope

In scope:
- PR-to-issue acceptance criteria coverage checks
- PR-to-plan alignment checks (plan.md and planning docs)
- Related-issue overlap and missing-scope detection
- Test and validation evidence checks for changed behavior
- Risk-focused review findings with severity and evidence
- Optional checkbox sync for planning issues based on PR evidence

Out of scope:
- Broad issue-body rewrites, section restructuring, or label changes
- Implementing code fixes
- Merge decisions

## Mode Selection

Default mode: one PR at a time.

Execution modes:
- Review-only mode (default): produce findings and coverage only.
- Review-plus-checkbox-sync mode (opt-in): after review, update issue checkboxes using evidence.

If the user asks for multiple PRs, process sequentially and complete the full workflow per PR before moving on.

## Required Inputs

Minimum:
- PR URL or number
- Repository owner/name

Optional but preferred:
- Explicit source issue number if PR body linkage is ambiguous

If source issue cannot be determined, stop and ask for exactly one issue number.

For checkbox sync mode, also require:
- explicit list of issues to update (or explicit permission to update source issue and linked related planning issues)

## Workflow

Copy this checklist and update as you go:

```
PR Review Progress
- [ ] Step 1: Gather PR data and diff
- [ ] Step 2: Resolve source issue and related issues
- [ ] Step 3: Load plan artifacts
- [ ] Step 4: Build coverage and overlap analysis
- [ ] Step 5: Run validation commands (if runnable)
- [ ] Step 6: Deliver findings-first review
```

### Step 1: Gather PR Data And Diff

Collect:
- PR title/body
- changed files and key hunks
- test files changed
- linked issues from PR body text (for example, `Closes #36`)

Prefer local diff review for line-level evidence.

If local fetch fails because a PR branch already exists or is checked out, continue with existing local branch state and record that fallback in evidence.

### Step 2: Resolve Source Issue And Related Issues

Determine one primary source issue.

Build the related-issue set as the union of:
- issues linked in PR body sections (for example, Additional planning issues)
- source issue sections (Stories Enabled, Related Planning Issues, parent links)

From the source issue body, extract:
- Parent Epic Issue
- Parent Feature Issue
- Stories Enabled or Linked Story/Test/Enabler issues
- Related Planning Issues
- Technical Tasks, Validation Commands, Acceptance Criteria

Use bullet reference parsing assumptions from repository conventions (`- #NUMBER`).

Classify every requirement source as one of:
- Anchor issue requirement (primary source issue)
- Cross-issue requirement (related planning issue)
- Plan-level requirement (plan artifacts)

### Step 3: Load Plan Artifacts

Read at least:
- `plan.md`
- `docs/ways-of-work/plan/budget-planner/implementation-plan.md`

Load additional planning docs only when needed for a finding.

### Step 4: Build Coverage And Overlap Analysis

Perform three checks:

1. Issue coverage:
- Which ACs/technical tasks are satisfied by the PR?
- Which required items appear missing or unproven?
- For each AC, classify status as `satisfied`, `partially satisfied`, `unsatisfied`, or `unproven (validation blocked)`.
- For every semantic mismatch finding, include a direct quote from the issue text before asserting intent.
- Do not treat cross-issue intent as anchor AC failure unless anchor AC text explicitly requires it.
- If the source issue is a story or feature and the PR only adds tests, test scaffolding, or checkbox updates while implementation tasks remain open, classify the affected ACs as `partially satisfied` or `unproven` rather than `satisfied`, and call out the missing implementation scope explicitly.

2. Plan alignment:
- Does PR behavior align with local-first, deterministic, no-network, and layering constraints?
- Does the PR skip dependencies implied by plan sequencing?

3. Related-issue boundary:
- Detect overlap: work likely belonging to sibling/follow-up issues
- Detect gaps: required adjacent work not addressed and not explicitly deferred
- If the PR appears to complete only a linked Test issue while the source story or feature still has open technical tasks, report that as a cross-issue boundary gap instead of treating the story as complete.

4. Delivery hygiene:
- Compare PR body claims against execution evidence (commands run, outcomes, CI links, checklist state, draft/ready state).
- Flag inconsistencies between claimed status and observed evidence.

Use [references/checklists.md](references/checklists.md) for signals.

### Step 5: Run Validation Commands

Run validation commands from the source issue when possible.

Execution guidance:
- On Windows PowerShell environments where script policy blocks `npm`, run `npm.cmd`.
- If validation fails, run the same commands on `main` to classify baseline vs PR-introduced failures.

If a command cannot run:
- record exact blocker (for example, environment/tooling limitation)
- distinguish repository baseline failures from PR-introduced failures

Do not claim AC validation passed without execution evidence.

### Step 6: Deliver Findings-First Review

Output must:
- list findings first, ordered by severity
- include precise evidence (file paths, issue/PR evidence, command outcomes)
- explicitly state if no findings were found
- include residual risks/testing gaps
- include coverage summary for ACs and related-issue overlap/gap conclusions
- tag each finding with confidence (`high`, `medium`, `low`) based on evidence strength
- include reproducibility context (branch, commit SHA, working tree state, local vs CI evidence)

Use [references/output-template.md](references/output-template.md).

### Step 7: Pre-Final Validation Gate (Mandatory)

Before finalizing output, enforce all checks below.

1. Finding class validation:
- Every finding class must be exactly one of: `anchor-issue violation`, `cross-issue semantic conflict`, `plan alignment gap`, `delivery hygiene gap`.
- If any finding uses a different class label, revise or drop the finding.

2. Quote-proof validation:
- Every semantic-intent finding must include at least one direct quote from the cited issue text.
- If quote evidence is missing, downgrade confidence and severity or remove the finding.

3. Severity calibration:
- Delivery hygiene findings default to Low.
- Upgrade delivery hygiene to Medium only when acceptance interpretation or merge-readiness is materially ambiguous.
- High is allowed only for explicit anchor AC violation, direct incorrect behavior with evidence, or blocking validation failure.

4. Output-shape validation:
- Final output must include all required template sections from [references/output-template.md](references/output-template.md).
- Include explicit additional planning issue status: `complete` or `ambiguous`.

5. Confidence rationale:
- Each finding must include a one-line confidence basis tied to available evidence quality.

If any check fails, do not finalize. Revise findings first.

### Step 8: Checkbox Sync (Optional, Opt-In Only)

Run this step only when user explicitly requests updates.

Allowed mutations:
- Checkbox state only (`- [ ]` to `- [x]`) in existing issue body lines
- Only in these sections:
  - `### Technical Requirements`
  - `### Technical Tasks`
  - `### Stories Enabled`
  - `### Acceptance Criteria`

Disallowed mutations:
- Adding/removing/rewording headings or list items
- Reordering sections
- Editing labels, dependencies, estimates, or narrative text

Decision rules:
- Check a box only when there is direct evidence from PR diff and/or command output.
- If evidence is partial or blocked, leave unchecked and include a note in output.
- Default policy is check-only (do not uncheck existing checked boxes).
- Only allow uncheck when user explicitly requests bidirectional reconciliation.

Update workflow:
1. Read issue body and extract current checkbox lines in allowed sections.
2. Build an evidence map item-by-item from review artifacts.
3. Produce a dry-run patch summary in output first.
4. Apply body update with checkbox-only edits.
5. Re-read updated issue and verify only expected checkbox deltas changed.
6. Report updated items, unchanged items, and ambiguous items.

## Severity Model

- High: anchor-issue acceptance criteria clearly violated, incorrect behavior with direct evidence, or blocking validation failure
- Medium: cross-issue semantic conflict, contract ambiguity, missing guardrails/tests, or likely future defect
- Low: clarity, maintainability, or minor scope hygiene concerns

Do not assign High severity to cross-issue conflicts unless anchor AC text is explicitly violated.

Delivery hygiene findings should be Low by default unless they create material AC or readiness ambiguity.

## Finding Classes

Classify each finding as one of:
- Anchor-issue violation
- Cross-issue semantic conflict
- Plan alignment gap
- Delivery hygiene gap

## Additional Planning Issue Policy

If PR body lists additional planning issues, require one of:
- explicit coverage mapping for each additional issue, or
- explicit deferral statement for each additional issue

If neither exists, report a traceability ambiguity finding.

## Stop Conditions

Stop and escalate when any apply:
1. Source issue cannot be resolved from PR context
2. PR diff cannot be retrieved
3. Required repository plan files are missing
4. Access/permission errors prevent issue or PR reads
5. Checkbox sync requested but issue body format is not safely parseable for checkbox-only edits

Escalation message format:
- Blocked reason: [short reason]
- Evidence: [exact missing data/tool error]
- Requested user input/action: [one concrete action]
- Next step after action: [what will be reviewed]

## Quality Rules

- Keep review evidence-based; avoid speculative findings without artifacts.
- Prefer behavior/regression risks over style commentary.
- Separate repository baseline failures from PR regressions.
- Keep terminology consistent with repository domain language.
- Use forward slashes in all skill file paths.
- For semantic-intent findings, include quote-level evidence from the cited issue.
- For checkbox sync, preserve all non-checkbox text exactly.

## References

- Review signals and checks: [references/checklists.md](references/checklists.md)
- Findings output format: [references/output-template.md](references/output-template.md)
