---
name: issue-planning-governor
description: Use this skill when the user asks to plan, create, edit, link, validate, or close GitHub planning issues in the budget repository, including planning-invalid fixes, validate-planning loops, issue-template rewrites, and epic-feature-story-enabler-test relationship alignment. Do not use this skill for code implementation, test execution, UI work, migrations, or general documentation edits unless the primary task is issue-governance planning.
compatibility: Requires GitHub MCP issue read/write/search tools and repository planning rules in .github/copilot-instructions.md.
metadata:
  owner: budget-repo
  workflow: issue-planning
  version: "1.1"
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

## Single-Mode Operation

- Operate on one primary issue at a time.
- If the user explicitly asks for multi-issue work, process sequentially and finish all gates for issue N before issue N+1.
- No parallel issue execution.

## Rule Set (Deterministic)

Apply these rules in every run.

- R1 Never delete issues.
- R2 Close issues only with explicit rationale tied to completed acceptance criteria or superseding issue links.
- R3 Treat planning-invalid as a hard blocker.
- R4 Keep repository privacy posture in planning output: no cloud/network-by-default processing for transaction content, no telemetry/analytics language, no encouragement to commit PII/raw statements/backups.
- R5 Keep implementation scope and test scope separate:
  - story/feature issues must not own test execution scope when a linked test issue exists.
  - test issues must be verification-only.
- R6 Structured references in headings sections must use bullet issue refs only: - #NUMBER.
- R7 Ban uncertainty terms in Technical Tasks, Acceptance Criteria, and Validation Commands:
  - if needed, as needed, where applicable, or equivalent, as appropriate, if required.
- R8 Test Necessity decision is mandatory and binding:
  - either no dedicated test issue needed now, or test issue required and linked/created.
- R9 Validation loop is mandatory after mutation: apply validate-planning and poll for processing.
- R10 Validation timeout is a hard stop: if no processing signal within 180 seconds, escalate validation-timeout and stop.
- R11 Feature/story readiness requires status coherence across linked issues and blockers.
- R12 If test issue is required, acceptance criteria traceability must be complete: all parent AC IDs must be covered in linked test issue mapping.

## Rule Precedence

If rules conflict, apply in this order:
1. Stop conditions (R3, R10)
2. Scope boundaries (R5)
3. Data/privacy constraints (R4)
4. Deterministic formatting and language (R6, R7)
5. Traceability and readiness (R8, R11, R12)

## Required Pre-Execution Checklist

Copy and fill before Step 1.

```text
SKILL COMPLIANCE CHECKLIST
Issue number: [#___]
Issue type: [feature/story/enabler/test]
Date started: [YYYY-MM-DD]

- [ ] I will execute Steps 1-5 in order.
- [ ] I will run validation after any mutation.
- [ ] I will stop on planning-invalid or validation-timeout.
- [ ] I will not move to another issue until this issue completes.
```

## Guardrails (Must Pass)

Run these checks explicitly at Step 4.

- G1 Template headings valid for issue type (references/templates.md).
- G2 Structured issue refs in required sections are - #NUMBER only.
- G3 No uncertainty terms in Technical Tasks, Acceptance Criteria, Validation Commands.
- G4 Scope boundary clean:
  - feature/story Technical Tasks do not absorb dedicated test issue execution scope.
  - test issues do not absorb missing production behavior under src/, electron/, preload, IPC, renderer.
- G5 Test necessity consistency:
  - decision is recorded and body content matches that decision.
- G6 AC traceability completeness:
  - if test issue required, all parent AC IDs are present in linked test issue Acceptance Criteria Mapping.
- G7 Status coherence:
  - blockers are explicit, open/relevant, and non-circular.
  - completion claims do not conflict with linked issue states.
- G8 Entry points policy:
  - assignable-now entry points point to existing paths.
  - new files are listed under Technical Tasks, not as required existing entry points.

## Workflow (Sequential Gates)

### Step 1: PREFLIGHT

- Read issue body, labels, recent comments.
- Identify issue type.
- Verify parent epic/feature alignment and linked issue consistency.
- Run Test Necessity decision and record one outcome:
  - No test issue needed now, or
  - Test issue required (link/create action).

Gate:
- PASS only if type, hierarchy, and Test Necessity decision are clear and consistent.
- FAIL -> stop and escalate.

### Step 2: REWRITE/UPDATE

- Rewrite/update using references/templates.md.
- Keep language concise, deterministic, and testable.
- Enforce R5 scope separation.
- Enforce R6 formatting and R7 uncertainty-term ban.
- Apply Test Necessity outcome from Step 1 (binding).

Gate:
- PASS only if body matches template, refs format, scope boundary, and decision consistency.
- FAIL -> stop and escalate.

### Step 3: VALIDATE

- Apply validate-planning label.
- Poll every 15-20 seconds, up to 180 seconds.
- Processing signal is any one of:
  - validate-planning removed,
  - planning-invalid presence changed,
  - new planning-lint/system comment after label-apply timestamp.

Gate:
- planning-invalid present -> stop and escalate.
- validation-timeout (no processing signal at 180 seconds) -> stop and escalate.
- otherwise proceed.

Repair behavior:
- Perform Step 3a repair only if user explicitly requests repair.

### Step 4: READINESS GATE

- Run Guardrails G1-G8 with explicit evidence.
- Run references/assignment-readiness-deep-dive.md checks and include quoted proof for passed deep-dive claims.

Gate:
- PASS only if all required checks pass.
- Any fail -> stop and escalate.

### Step 5: FINALIZE

Provide a concise run summary:
- what changed
- why changed (map to rules)
- validation evidence (labels/comments)
- Test Necessity decision and test issue action
- blockers and next recommended issue
- residual risks and follow-up links

Gate:
- PASS when evidence is complete and specific.
- FAIL -> stop and escalate.

## Validation Evidence Format (Single Canonical Format)

Use this exact format after Steps 2, 3, and 4.

```text
STEP N GATE EVIDENCE
Issue: #[number]
Gate: [step]
Timestamp: [ISO 8601]

CHECKPOINT RESULT
Gate Status: [PASS|FAIL]
Decision: [continue|stop]

EVIDENCE
Labels Current: [list]
planning-invalid: [PRESENT|ABSENT]
Last 3 Comments:
1. [author | timestamp]: [snippet or none]
2. [author | timestamp]: [snippet or none]
3. [author | timestamp]: [snippet or none]

For Step 3 only:
- Poll count: [N]
- Total wait: [seconds]
- Processing signal observed: [yes/no + detail]

For Step 4 only:
- Guardrails: G1 [PASS/FAIL], G2 [PASS/FAIL], G3 [PASS/FAIL], G4 [PASS/FAIL], G5 [PASS/FAIL], G6 [PASS/FAIL], G7 [PASS/FAIL], G8 [PASS/FAIL]
- Deep-dive quoted proof: [required for each PASS claim]

NEXT ACTION
[Step N+1 | STOP Escalate]
```

## Stop Conditions And Escalation

Stop and escalate when any apply:
- planning-invalid after Step 3
- validation-timeout at 180 seconds
- permissions block required mutation
- mandatory hierarchy/blocker condition cannot be verified
- readiness guardrail failure

Use this escalation message format:
- Blocked reason: [concise reason]
- Evidence: [label/comment/error/failed guardrail]
- Requested owner action: [exact action]
- Next step after owner action: [what will be done]

Do not continue to another step or issue after escalation.

## Output Requirements

Each run must include:
- What changed.
- Why it changed.
- Validation evidence from Steps 3-4.
- Test Necessity decision and resulting test issue action.
- Remaining blockers and next recommended issue.
- Residual risks and follow-up issue links.

## Quality Targets

- Q1 Zero unresolved planning-invalid labels at finalize.
- Q2 Zero boundary-bleed violations at finalize (R5 / G4).
- Q3 Complete AC traceability when test issue required (R12 / G6).
- Q4 No contradictory gate outcomes in one run.
- Q5 One canonical evidence block per gate (no duplicate formats).

## Token Discipline

- Keep mutation outputs concise and evidence-first.
- Use one canonical evidence block format.
- Avoid repeating unchanged checklist text after first report; report only deltas.
- Do not duplicate stop, evidence, or workflow sections.

## References

Load as needed for execution:
- references/templates.md
- references/checklists.md
- references/assignment-readiness-deep-dive.md
- references/repair-playbooks.md (only when validation fails or hierarchy/format issues are detected)
- references/runbook-example.md
- references/evaluation-checklist.md
