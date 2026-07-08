---
name: issue-planning-governor
description: Use this skill when the user asks to plan, create, edit, link, validate, or close GitHub planning issues in the budget repository, including planning-invalid fixes, validate-planning loops, issue-template rewrites, and epic-feature-story-enabler-test relationship alignment. Do not use this skill for code implementation, test execution, UI work, migrations, or general documentation edits unless the primary task is issue-governance planning.
compatibility: Requires GitHub MCP issue read/write/search tools and repository planning rules in .github/copilot-instructions.md.
metadata:
  owner: budget-repo
  workflow: issue-planning
  version: "1.0"
---

# Issue Planning Governor

Use this skill for issue lifecycle planning work in this repository.

## Scope

In scope:
- Issue planning updates: create, update, comment, link, close-with-rationale.
- Planning quality checks: template compliance, parent/child alignment, test linkage, blocker validity.
- Assignment-readiness checks for Copilot.

Out of scope:
- Code implementation.
- PR implementation details beyond issue planning references.
- Issue deletion operations.

## Mode Selection

Default behavior:
1. Operate on one primary issue at a time.
2. If the user explicitly asks for multi-issue work, process issues sequentially, still applying full checks per issue.

## Required Operating Rules

1. Never delete issues.
2. Close issues only with explicit rationale tied to completed acceptance criteria or superseding issue links.
3. Treat planning-invalid as blocking.
4. Keep repository privacy and data-handling constraints in planning outputs:
- no cloud/network processing proposals for transaction content by default
- no telemetry/analytics/network-by-default language in issue scope
- no references that encourage committing raw bank data, backups, or PII
5. Keep issue wording aligned with local-first and public-repository constraints from repository instructions.
6. If blocked by permissions or missing prerequisites, stop with one concise owner escalation message and avoid repeated retries.
7. Always run validation loop after issue body/label changes:
- apply validate-planning label
- wait for validation processing and poll resulting labels/comments
- repair and re-run if needed
8. Keep implementation scope and test scope separate in issue bodies and rewrites:
- if the issue is a story or feature, do not fold test execution work into the story body unless the issue is explicitly a test issue
- if validation work is needed, link or create a dedicated test issue instead of treating test additions as completion of the story or feature
- when rewriting a story issue, preserve the distinction between product behavior, implementation tasks, and test coverage
9. Enforce bullet issue references in section bodies:
- use - #NUMBER
- never inline comma-separated refs in structured sections
10. Enforce deterministic task language:
- fail readiness if Technical Tasks contain uncertainty words such as "if needed", "as needed", "where applicable", "or equivalent", "as appropriate", or "if required"
- tasks must be explicit, executable, and tied to clear file/module targets

## Test Necessity Decision Gate (Mandatory)

The skill must decide whether test planning is required for the issue. Do not ask the user to make this call by default.

Decision workflow:
1. Identify whether the issue changes behavior, contracts, data flow, boundaries, or runtime wiring (not just planning text).
2. Determine verification risk and choose the lowest-cost sufficient test layer per pyramid:
- unit for pure logic and deterministic calculations
- integration for cross-module contracts, persistence, IPC/service boundaries
- e2e/playwright for user-critical flow wiring and renderer/runtime interactions
3. Decide one of two outcomes:
- **No test issue needed now:** only when issue scope is planning-only or non-behavioral and existing verification already covers risk. In this case, do not add test tasks or test issue references.
- **Test issue required:** when issue introduces or changes executable behavior/contract/runtime wiring. In this case, create or link a dedicated test issue and wire it into the parent issue sections.

Mandatory behavior when test issue is required:
- If no suitable open test issue exists, create one using the Test template.
- Link it in the issue body under the appropriate section (for example, `### Linked Test Issues` or `### Test Issues In This Feature`).
- Ensure the test objective verifies the specific functionality created by the issue; avoid tests for test's sake.
- **Map acceptance criteria to that test issue with inline detail:** Use `### Acceptance Criteria Mapping` section in test issues assigned to cloud agents. Each AC must include: (1) AC definition, (2) which test scenario(s) verify it, (3) specific validation assertion. This eliminates round-trips to parent issues and ensures cloud agents have complete context without leaving the issue.
- Include concrete validation commands.

## Preflight Checklist

Run this before any mutation:
1. Read issue body, labels, and recent comments.
2. Identify issue type: feature, story, enabler, test.
3. Verify required headings for type (see references/templates.md).
4. Verify hierarchy consistency:
- parent epic/feature alignment
- enabler feature-scope rule
- story/test linkage consistency
5. Verify assignment readiness (see references/checklists.md and references/assignment-readiness-deep-dive.md):
- size constraints
- clear ownership layer
- no circular blockers
- implementation entry points policy
- **NEW:** Run deep-dive checklist for issue type to identify pre-mutation gaps (missing Technical Tasks, vague ACs, unclear integration boundaries)

## Implementation Entry Points Policy

For assignment-safe planning:
1. Implementation Entry Points should reference existing paths when issue is meant to be directly assignable now.
2. If files must be created, list creation under Technical Tasks, and keep entry points at existing directory/module level.

## Mutation Workflow: Sequential Checkpoint Gates
3. If policy or user intent requires path existence strictness, avoid listing non-existent paths as direct entry points.

## Required: Pre-Execution Compliance Checklist

**Before starting work on any issue, copy this entire checklist and fill it out. Do not proceed until all items are checked. This is not optional.**

```
SKILL COMPLIANCE CHECKLIST — Copy and fill before starting

Issue number: [#___]
Issue type: [feature/story/enabler/test]
Date started: [YYYY-MM-DD]

PRE-EXECUTION ACKNOWLEDGMENT (Must check all):
- [ ] I have read the complete Mutation Workflow (Steps 1–5 below)
- [ ] I understand that this is a fragile, critical workflow
- [ ] I will execute Steps in exact order: 1 → 2 → 3 → 4 → 5
- [ ] I will NOT skip validation (Step 3) under any circumstances
- [ ] I will NOT branch or make judgment calls to deviate from the sequence
- [ ] I will provide exact validation evidence (labels, comments) after each step
- [ ] I will not finalize (Step 5) until ALL readiness gate items (Step 4) are checked
- [ ] I will not begin the next issue until this issue is COMPLETE (all 5 steps done)
- [ ] I understand that violating this sequence is a skill execution failure

Acknowledgment: I will follow Steps 1–5 exactly as written, in order, with no deviations.
```

**You cannot begin Step 1 until this checklist is complete.**

## Mutation Workflow: Sequential Checkpoint Gates

Each step is a gate. Do not proceed to the next step until the current step is complete and verified.

### Step 1: PREFLIGHT (Cannot skip)
- Read issue body, labels, and recent comments.
- Identify issue type: feature, story, enabler, test.
- Verify required headings exist for type (see references/templates.md).
- Verify hierarchy: parent epic/feature alignment, enabler feature-scope, story/test linkage.
- Verify assignment readiness: size, ownership layer, no circular blockers, entry points policy.
- Run Test Necessity Decision Gate and record evidence for one outcome:
  - no test issue needed now, or
  - test issue required and create/link action needed.
- **GATE CHECK:** Are all preflight items confirmed? If no, stop and escalate. If yes, proceed to Step 2.

### Step 2: REWRITE/UPDATE (Cannot skip)
- Use strict issue-type template from references/templates.md.
- Keep issue concise, specific, testable.
- Include explicit blocker and enabler logic.
- Include validation commands aligned to scope.
- Apply Test Necessity outcome deterministically:
  - if test issue required, create/link dedicated test issue and **inline AC mapping** (see guidance below)
  - if no test issue needed, keep issue free of placeholder or conditional test language
- **For test issues assigned to cloud agents:** Include `### Acceptance Criteria Mapping` section where each AC includes: definition, test scenario(s), and validation assertion. This provides complete context without requiring the agent to reference parent issues.
- Record what will change and why (map to repository policy).
- **GATE CHECK:** Does rewritten body match template headings? Are all structured refs in - #NUMBER format? For test issues: Does AC mapping section exist with concrete assertions? If no, do not save. If yes, save issue and proceed to Step 3.

### Step 3: VALIDATE (MANDATORY - Cannot skip or defer)
- Apply validate-planning label to the issue.
- **WAIT WINDOW (required):** Do not proceed until bot/system has processed label, using a timed polling loop.
- Poll issue state every 15-20 seconds for up to 180 seconds.
- On each poll, fetch current labels and last 5 comments.
- Treat validation as processed when at least one of these is true:
  - `validate-planning` label is removed, or
  - `planning-invalid` label changes presence, or
  - a new planning-lint/system comment appears after the label-apply timestamp.
- If none of the processed signals appear within 180 seconds, perform one final fetch of labels + last 5 comments, then escalate as `validation-timeout` with collected evidence.
- **GATE CHECK:** Is planning-invalid present? If yes, go to Step 3a (Repair). If no, proceed to Step 4.

#### Step 3a: REPAIR (If validation failed)

### Step 4: READINESS GATE CHECK (MANDATORY - Cannot skip)
- [ ] Validation checkpoint passed: no planning-invalid label present.
- [ ] Issue body includes all required template headings for issue type.
- [ ] All structured issue references use - #NUMBER format (no inline refs).
- [ ] Remaining blockers are explicit and linked.
- [ ] Implementation Entry Points policy verified (existing paths only if assignable now).
- [ ] Assignment-readiness checks passed per references/checklists.md.
- [ ] Technical Tasks contain no uncertainty words ("if needed", "as needed", "where applicable", "or equivalent", etc.).
- [ ] Test Necessity Decision Gate evidence captured and consistent with issue body.
- [ ] If test issue is required, linked test issue exists and is scoped to verify created functionality at the correct pyramid layer.
- [ ] **NEW:** Deep-dive assignment-readiness checklist passed (references/assignment-readiness-deep-dive.md):
  - [ ] All ACs are operationalized (testable, not vague).
  - [ ] **For test issues:** AC mapping is inline and explicit (test scenario(s) + validation assertion for each AC, not just list of AC IDs).
  - [ ] Test file paths exist or are explicitly listed in Technical Tasks.
  - [ ] Integration boundary is clear (where does output go? what format is expected?).
  - [ ] Blockers are current and non-circular.
  - [ ] Validation commands are sufficient to prove all ACs.
  - [ ] Technical Tasks exist and are concrete (for enablers/stories).
  - [ ] **Evidence proof is explicit:** include quoted snippets from issue body for each deep-dive pass item (heading + exact phrase used as evidence).
- **GATE CHECK:** All items checked? If no, return to Step 2 or 3a. If yes, proceed to Step 5.

### Step 5: FINALIZE (Cannot skip)
- Summarize what changed and why.
- Include validation evidence: exact label state and comment text from validation.
- Include Test Necessity decision and evidence (why test issue was or was not required).
- Include remaining blockers and next recommended issue.
- Include residual risks and explicit follow-up issue links.
- **GATE CHECK:** Is evidence complete and summary specific? If yes, this issue is DONE. If no, return to Step 4 for verification.

**CRITICAL:** Do not begin work on the next issue until Step 5 is complete for the current issue.

## Checkpoint Compliance (Non-Negotiable)

The mutation workflow gates (Steps 1–5) are **not optional guidelines**. They are sequential checkpoints:
- You must complete Step N before proceeding to Step N+1.
- If a gate fails, you must repair it, re-test, and prove the gate passes before moving on.
- You cannot defer validation or skip the readiness gate to move to the next issue.
- In multi-issue mode, you **must** complete all steps for issue N before beginning issue N+1.


## Stop Conditions And Escalation
Violating checkpoint sequencing is a skill execution failure. If you cannot complete a checkpoint (permission blocked, infrastructure missing), report the failure immediately and stop.

### Linear Execution Path (Fixed Sequence, No Branching)

```
Step 1 (PREFLIGHT)
  ↓
Step 2 (REWRITE/UPDATE)
  ↓ Gate: Body matches template? Refs in - #NUMBER format?
    ✗ NO → STOP. Escalate. End workflow.
    ✓ YES → Step 3
  ↓
Step 3 (VALIDATE)
  ↓ Action: Apply validate-planning label
  ↓ Gate: planning-invalid label present?
    ✗ YES → STOP. Post escalation comment. End workflow.
              (Do NOT enter repair loop automatically.)
    ✓ NO → Step 4
  ↓
Step 4 (READINESS GATE CHECK)
  ↓ Gate: All readiness + deep-dive checklist items verified with explicit quoted evidence?
    ✗ NO → STOP. Escalate with reason. End workflow.
    ✓ YES → Step 5
  ↓
Step 5 (FINALIZE)
  ↓ Action: Summarize changes and post evidence
  ↓ Issue COMPLETE. Ready for next issue.
```

**FAILURE BEHAVIOR:**
- When any gate fails (✗), you **STOP the entire workflow for that issue.**
- You **do NOT loop back automatically.** Automatic repair loops hide failures.
- You **POST an escalation comment** explaining the failure.
- You **REPORT the failure to the user** with exact evidence.
- You **WAIT for user direction** before attempting any repairs or moving forward.
- This prevents silent retry loops and ensures all failures are visible.

**Evidence retrieval rule (non-optional):**
- Do not ask the owner/user to paste planning-lint comment text if it is retrievable from issue comments.
- First, fetch it directly from issue comments after the Step 3 wait window.
- Only request owner action for missing lint detail when there is a real access limitation (permission/API/workflow visibility) or explicit validation-timeout after required polling.

**EXCEPTION — Step 3a Repair (Only if user explicitly asks):**
- Step 3a repair is available ONLY if the user explicitly asks you to repair a planning-invalid failure.
- It is NOT automatic and NOT default behavior.
- If user asks for repair: Read planning-invalid comment → fix issue body → re-apply validate-planning → return to Step 3 validation.
- After repair, if planning-invalid is STILL present, go back to STOP and escalate.

## Stop Conditions And Escalation

Stop and escalate (do not proceed) when any apply:
1. Checkpoint gate fails and cannot be repaired (e.g., planning-invalid after repair attempt).
2. Required edits are blocked by permission mismatch.
3. A mandatory dependency or required entry-point infrastructure is missing.
4. Repository policy constraints conflict with requested issue content.

Use this single owner escalation message format:
- Blocked reason: [concise reason]
- Evidence: [label/comment/error, missing path, or failed gate name]
- Requested owner action: [exact change needed]
- Next step after owner action: [what the skill will do]

**Do not continue to next issue or step. Stop and report.**

## Assignment-Readiness Gate

An issue is assignable only if all pass:
1. Scope is small enough for one Copilot assignment.
2. Clear acceptance criteria and explicit validation commands.
3. One dominant ownership layer (unit, integration, or e2e) unless explicitly justified.
4. Blockers are explicit and currently resolvable.
5. No planning-invalid label remains.

Use detailed checks from references/checklists.md.

## Multi-Issue Mode: Per-Issue Completion Gate

Allowed only on explicit user request.

Execution rules:
1. Confirm issue list and intended operation per issue.
2. For each issue:
   - Complete Steps 1–5 (Preflight → Finalize) fully.
   - Emit per-issue summary with validation evidence (labels, comments).
   - **STOP:** Do not touch the next issue until current issue Steps 1–5 are proven complete with evidence.
3. Move to next issue only after all gates passed.
4. If repository policy conflict is detected at any step, stop immediately and request user direction (do not continue to next issue).
3. Move to Issue N+1 only if Issue N is 100% complete with evidence reported.
4. Stop conditions (repository conflict, permission issue, unresolved planning-invalid): escalate immediately, do NOT continue to next issue.
- Move to Issue N+1 only if Issue N is complete with evidence reported.
- Stop conditions (repository conflict, permission issue, unresolved planning-invalid): escalate immediately, do NOT continue.

### Lock Enforcement (Non-Negotiable)

- **One active issue at a time.** Work on exactly one issue until 100% complete (all 5 steps done, evidence posted).
- **Violation rule:** Beginning work on Issue N+1 before Issue N is done = skill execution failure.
- **Evidence is mandatory gate:** Issue N not considered done until evidence report is posted to user.
- **No parallelism:** Cannot work on multiple issues simultaneously or start Issue N+1 mid-workflow of Issue N.

## Validation Evidence Collection (MANDATORY after every mutation)

## Validation Evidence Collection (MANDATORY after every gate pass)

After every gate (Steps 2, 3, 4), you MUST collect structured evidence before proceeding. Do not skip evidence reporting.

### Evidence Format (Mandatory — Copy Exactly After Each Gate)

```
STEP N GATE EVIDENCE
Issue: #[number]
Gate: [Step name and condition]
Timestamp: [ISO 8601]

CHECKPOINT RESULT
Gate Status: [PASS | FAIL]
Decision: [what gate decided]

EVIDENCE (GitHub State)
Labels Current: [exact list of all labels on issue]
Labels Expected: [if applicable, what should be there]

Last 3 Comments:
1. [author | timestamp]: [first 100 chars of comment]
2. [author | timestamp]: [first 100 chars of comment]
3. [author | timestamp]: [first 100 chars of comment]

Validation Status:
  planning-invalid: [PRESENT | ABSENT]
  Linter output: [paste bot comment if present, or "none"]

GATE DECISION
Next Action: [Step N+1 | STOP Escalate | Step 3a (repair, if requested)]
```

### Evidence Requirements Per Step

**After Step 2 (REWRITE/UPDATE):**
- Issue body saved: yes/no
- Template headings present: list first 3 exact heading names
- Structured refs format (- #NUMBER): verified yes/no
- Test Necessity decision applied: yes/no
- If yes (test required): linked/created test issue number(s)
- If no (test not required): explicit rationale

**After Step 3 (VALIDATE):**
- All labels on issue: [list]
- planning-invalid present/absent: [explicit]
- Bot validation comment present: yes/no (paste if yes)
- New validation comment after label apply timestamp: yes/no (include comment id + timestamp if yes)
- Polling evidence: number of polls and total wait duration

**After Step 4 (READINESS GATE CHECK):**
- Checklist: list all readiness + deep-dive items with [✓PASS] or [✗FAIL]
- Failed items: explain each
- Passed items: show one supporting fact per item
- Uncertainty words check result: [✓PASS] or [✗FAIL] with quoted task lines
- Test Necessity consistency check: [✓PASS] or [✗FAIL] with quoted evidence
- **For test issues:** AC mapping check [✓PASS] or [✗FAIL] — are all ACs defined inline with test scenarios + assertions (not just ID lists)?
- **Quoted evidence required for each passed deep-dive item:**
  - Section heading where evidence was found (for example `### Technical Tasks` or `### Acceptance Criteria Mapping`)
  - Exact snippet in quotes copied from issue body
  - Brief rationale for why snippet satisfies the item

### Mandatory Compliance

Do not proceed to the next step without evidence in this format. If evidence is incomplete:
- You have NOT completed the gate.
- Re-collect using the template above.
- This ensures all gates are traceable and failures are visible.

## Output Requirements

For every run include:
1. What changed (in each issue).
2. Why it changed (map to policy).
3. Validation evidence (exact labels and comment text from Steps 3–4).
4. Test Necessity decision, reasoning, and resulting test issue action (created/linked/none).
5. Remaining blockers and next recommended issue.
6. Residual risks and explicit follow-up issue links for deferred work.

## References

- Load references/templates.md when rewriting or creating issue bodies for feature/story/enabler/test templates.

- Load references/checklists.md before any mutation and before finalizing assignment-readiness decisions.

- Load references/assignment-readiness-deep-dive.md during Step 1 Preflight (to identify pre-mutation gaps) and Step 4 Readiness Gate (to verify Copilot assignment safety).

- Load references/repair-playbooks.md only when validation fails or hierarchy/format issues are detected.

- Load references/runbook-example.md when running a single-issue end-to-end execution pass.

- Load references/evaluation-checklist.md after a run to self-grade output quality before final response.

## Evaluation Resources

Use these files for iterative quality checks:
- evals/trigger-queries.train.json for description tuning on train prompts.
- evals/trigger-queries.validation.json for description generalization checks.
- evals/output-evals.json for output quality runs and assertion grading.
