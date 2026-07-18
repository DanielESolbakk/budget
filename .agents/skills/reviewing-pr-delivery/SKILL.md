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
- Mandatory issue-body checkbox sync for planning issues based on PR evidence

Out of scope:
- Broad issue-body rewrites, section restructuring, or label changes
- Implementing code fixes
- Merge decisions

## Mode Selection

Default mode: one PR at a time.

Execution modes:
- Review-and-checkbox-sync mode (default): review the PR, then sync planning-issue body checkboxes using evidence.

If the user asks for multiple PRs, process sequentially and complete the full workflow per PR before moving on.

## Required Inputs

Minimum:
- PR URL or number
- Repository owner/name

Optional but preferred:
- Explicit source issue number if PR body linkage is ambiguous

If source issue cannot be determined, stop and ask for exactly one issue number.

Checkbox sync target set:
- the primary source issue
- additional planning issues listed in the PR body
- related planning issues from the resolved related-issue set when they contain allowed checkbox sections and the PR evidence maps to those items

Checkbox sync mutation limits:
- update issue description body checkboxes only
- do not edit the PR body
- do not add PR comments as part of checkbox sync
- do not add issue comments as part of checkbox sync

## Workflow

Copy this checklist and update as you go:

```
PR Review Progress
- [ ] Step 1: Gather PR data and diff
- [ ] Step 2: Resolve source issue and related issues
- [ ] Step 3: Load plan artifacts
- [ ] Step 4: Build coverage and overlap analysis
- [ ] Step 5: Run validation commands (if runnable)
- [ ] Step 6: Sync issue-body checkboxes
- [ ] Step 7: Deliver findings-first review
```

### Step 1: Gather PR Data And Diff

Collect:
- PR title/body
- changed files and key hunks
- test files changed
- linked issues from PR body text (for example, `Closes #36`)
- **Copilot completion signal**: if PR shows "Copilot finished work on behalf of...", record completion timestamp; do not escalate asking if agent is stalled

Prefer local diff review for line-level evidence.

If local fetch fails because a PR branch already exists or is checked out, continue with existing local branch state and record that fallback in evidence.

**Zero-file composition enablers**: If `changed_files: 0` and PR summary references merged blocker PRs (for example, "All three blockers were resolved and merged to main before this branch"), do not immediately escalate. Instead, parse the blocker references and proceed to Step 2 to verify they were actually merged; zero new files may be intentional if the enabler's ACs are satisfied by composition of existing work.

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
- If the anchor issue is a Test issue and the PR adds missing product/runtime behavior under `src/`, `electron/`, `preload`, IPC handlers, or renderer wiring that did not already exist, report that as a cross-issue semantic conflict rather than treating the test issue as cleanly delivered.
- For Test issues, distinguish verification artifacts from missing product implementation: test files, test-only helpers, and test harness overrides belong to the Test issue; new user-facing runtime behavior or production IPC/preload contracts do not.

4. Delivery hygiene:
- Compare PR body claims against execution evidence (commands run, outcomes, CI links, checklist state, draft/ready state).
- Flag inconsistencies between claimed status and observed evidence.
- **Composition-enabler hygiene**: If `changed_files: 0` and PR summary names merged blockers, verify each referenced blocker PR was actually merged to main. If all blockers are merged and the enabler ACs map to existing test evidence in those blockers, classify as `intentional zero-file composition` and report it as delivered (not incomplete). If any blocker is still open or the mapping is unclear, report as `ambiguous delivery scope`.

### Step 4.5: Claim Evidence Guardrails (Mandatory)

Before writing any positive completion claim, enforce all rules below.

1. Toolchain truthfulness:
- Detect the active test framework from repository evidence before naming it (for example, package.json scripts, config files, lockfile deps).
- Do not call a test "Playwright" unless Playwright tooling is present in repository evidence.
- If tests are executed via Vitest e2e config, name them as Vitest e2e tests.

2. Pass/fail claim requirements:
- Use "passed" only when backed by direct command output from this review session or CI status evidence linked in artifacts.
- If the only source is PR narrative text, label it "claimed in PR body, unverified in review".

3. Completion claim requirements:
- Do not state "fully implemented", "all ACs covered", or "ready for merge" unless anchor AC statuses are all `satisfied` and no open anchor technical task is left without explicit deferral.
- If implementation and validation are split across dependent PRs, report as `partially satisfied` or `unproven` with dependency note.
- If a Test issue PR had to add missing production/runtime behavior so the test path could exist, do not describe that boundary as cleanly planned; call out the planning drift even if the tests pass.
- **Composition enablers**: For PRs that document composition of already-merged prerequisites (zero new files, ACs satisfied via blocker evidence), this counts as `satisfied` provided: (a) all blocker PRs were merged, (b) ACs map cleanly to existing test evidence in blockers, and (c) the enabler's own composition work is accurately described and trivial/glue-only.

### Honesty Contract (Mandatory)

Constrain only high-risk review claims. Keep the rest of the review flexible and evidence-driven.

- Separate statements into `observed`, `inferred`, or `unverified` claim tiers.
- Use strong completion wording only for `observed` claims backed by code, issue text, command output, or CI artifacts.
- If a claim depends on interpretation, label it as `inferred` and cite the evidence source.
- If a claim comes only from PR narrative or expectation, label it `unverified` rather than resolving it.
- Do not infer framework, CI state, merge readiness, or cross-PR dependency from filenames, checklist intent, or repository habit alone.

Use [references/honesty-contract.md](references/honesty-contract.md) for allowed phrasing and prohibited shortcuts.

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

### Step 6: Sync Issue-Body Checkboxes (Mandatory)

After review evidence is assembled, update issue body checkboxes for the target planning issues.

Allowed mutations:
- Checkbox state only (`- [ ]` to `- [x]`) in existing issue body lines
- Only in these sections:
  - `### Technical Requirements`
  - `### Technical Tasks`
  - `### Stories Enabled`
  - `### Acceptance Criteria`
  - For Test issues only, also allow:
    - `### Playwright Implementation Standards`
    - `### Acceptance Criteria Mapping`
    - `### Test Scenarios`
    - `### Pass Criteria`
    - `### Regression Guard`

Disallowed mutations:
- Adding/removing/rewording headings or list items
- Reordering sections
- Editing labels, dependencies, estimates, or narrative text
- Editing the PR body
- Posting PR comments for sync status
- Posting issue comments for sync status

Decision rules:
- Check a box only when there is direct evidence from PR diff and/or command output.
- If evidence is partial or blocked, leave unchecked and report the ambiguity in the review output.
- Default policy is check-only.
- Only allow uncheck when the user explicitly requests bidirectional reconciliation.
- For Test-issue-only sections, require section-specific hard proof:
  - `Playwright Implementation Standards`: direct evidence from changed test code, config, or command output for each exact standard line.
  - `Acceptance Criteria Mapping`: direct evidence that the shipped tests and assertions match the mapped AC definition, scenario, and validation assertion.
  - `Test Scenarios`: direct evidence that the scenario exists in shipped tests and executed validation covers it.
  - `Pass Criteria`: direct evidence from executed commands and assertions, not PR narrative alone.
  - `Regression Guard`: explicit negative-path, fault-injection, or regression-oriented assertion evidence; do not infer this from happy-path smoke coverage.

Update workflow:
1. Read each target issue body and extract current checkbox lines in allowed sections.
2. Build an evidence map item-by-item from review artifacts.
3. Apply issue-body updates with checkbox-only edits.
4. Re-read each updated issue and verify only expected checkbox deltas changed.
5. Report updated items, unchanged items, and ambiguous items in the final review output.

If any target issue body format is not safely parseable for checkbox-only edits, stop and escalate.

### Step 7: Deliver Findings-First Review

Output must:
- list findings first, ordered by severity
- include precise evidence (file paths, issue/PR evidence, command outcomes)
- explicitly state if no findings were found
- include residual risks/testing gaps
- include coverage summary for ACs and related-issue overlap/gap conclusions
- tag each finding with confidence (`high`, `medium`, `low`) based on evidence strength
- include reproducibility context (branch, commit SHA, working tree state, local vs CI evidence)
- use framework-accurate terminology in every test claim (for example, Vitest vs Playwright)

Use [references/output-template.md](references/output-template.md).

### Step 8: Pre-Final Validation Gate (Mandatory)

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

6. Terminology validation:
- Test framework names in findings and summaries must match detected repository toolchain evidence.
- If framework cannot be determined confidently, use neutral wording: "end-to-end test".

If any check fails, do not finalize. Revise findings first.

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
2. PR diff cannot be retrieved (excluding empty diff when changed_files is 0 for composition enablers)
3. Required repository plan files are missing
4. Access/permission errors prevent issue or PR reads
5. Any target issue body format is not safely parseable for checkbox-only edits
6. Blocker references in composition-enabler summary cannot be verified (for example, referenced PR does not exist or is not merged)

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
- Never mutate the PR body or post PR comments as part of checkbox sync.
- Never post issue comments just to summarize checkbox sync results.

## References

- Review signals and checks: [references/checklists.md](references/checklists.md)
- Findings output format: [references/output-template.md](references/output-template.md)
