---
name: next-issue-assignment-governor
description: Recommends the next GitHub issue to assign to GitHub assigned cloud Copilot, with mandatory governance readiness checks. If the best candidate lacks governance-check evidence, require issue-planning-governor before assignment.
argument-hint: Exclude issue numbers and optional focus slice (example: exclude #144, focus F5.1)
compatibility: Requires GitHub MCP issue read/search tools, repository file access, and issue-planning-governor skill availability.
metadata:
  owner: budget-repo
  workflow: next-issue-advice
  version: "1.0"
---

# Next Issue Assignment Governor

Use this skill when the user asks which issue to assign next to GitHub assigned cloud Copilot.

## When to Use This Skill

Use this skill when:
- A user asks "what issue should I assign next".
- A user asks for cloud Copilot assignment advice.
- A user needs governance-gated issue prioritization.

Keywords:
- next issue
- assign copilot
- cloud copilot
- governance check
- planning-valid

## Scope

In scope:
- Open-issue candidate discovery and ranking.
- Governance readiness checks before assignment recommendation.
- Explicit handoff instruction when governance check is missing.

Out of scope:
- Code implementation.
- Pull request review.
- Broad planning rewrites.

## Required Inputs

- Repository owner and repo.
- Optional excluded issues already in progress (for example #144).
- Optional focus slice (epic, feature, label, or milestone).

If no exclusions are provided, infer active in-progress issues from recent updates and assignees.

## Single-Issue Output Contract

- Return one primary next issue recommendation.
- Return at most one fallback issue.
- Never return a recommendation without governance status.

## Rule Set

- R1 Only open issues can be recommended.
- R2 Issue must be assignable now: no unresolved `Blocked by` items and no missing required entry-point paths.
- R3 Governance validity is mandatory:
  - If `planning-invalid` is present, issue is not assignable.
- R4 Governance-check evidence is mandatory for direct assignment:
  - direct assignment allowed only when governance-check evidence is `verified`.
  - if candidate is strongest but evidence is `missing` or `unclear`, recommend the issue with status `governance-check-required` and instruct running `issue-planning-governor` first.
- R5 Preserve scope boundaries:
  - test issues are verification-only.
  - story/feature issues should not absorb dedicated test execution scope when linked test issues exist.
- R6 Respect repository privacy posture: no cloud/network-by-default transaction processing or telemetry language.
- R7 Prefer smallest unblocked scope in the currently active feature slice.

Follow [references/governance-check-mini-checklist.md](references/governance-check-mini-checklist.md) for the minimum governance gate.

## Governance-Check Evidence Levels

Classify one of three levels:

1. `verified`
- `planning-invalid` label absent.
- Required template sections for issue type are present.
- Deterministic planning markers are present (for example `Test Necessity Decision` section, explicit `Validation Commands`, explicit `Out Of Scope`).
- No unresolved hierarchy or blocker contradictions found.

2. `unclear`
- No `planning-invalid` label, but one or more required template/governance markers are incomplete, ambiguous, or contradictory.

3. `missing`
- Issue does not meet minimal governance structure for its type, or governance readiness cannot be established from available data.

Direct cloud-copilot assignment is only allowed for `verified`.

## Candidate Ranking Model

Score each candidate from 0-100:

- Assignability (0-35): blocker-free, entry points exist, scope is actionable now.
- Slice Continuity (0-25): aligns with the current active feature/epic and avoids context switching.
- Scope Size (0-20): 2-4 ACs and 3-5 concrete tasks preferred.
- Evidence Quality (0-20): clear ACs, deterministic commands, concrete fixtures.

Use [references/candidate-scoring-rubric.md](references/candidate-scoring-rubric.md) for scoring details and examples.

Apply governance gate after scoring:
- Top candidate with `verified` -> recommend direct assignment.
- Top candidate with `unclear` or `missing` -> recommend `governance-check-required` and provide exact governance action.

Tie-break rules when scores are equal:
1. Prefer `verified` over `unclear` over `missing`.
2. Prefer issue in the same active feature slice.
3. Prefer fewer open blockers/dependencies.
4. Prefer issue with newer update timestamp.

## Workflow

### Step 1: Build Candidate Set

- List open issues by planning labels: feature, user-story, enabler, test.
- Exclude issues already assigned/in progress when requested.
- Keep candidates in the same active slice first.
- Record data freshness timestamp from the newest `updated_at` in candidate set.

### Step 2: Assignability Precheck

For each top candidate:
- Read issue body, labels, dependencies, and linked planning issues.
- Verify `Blocked by` resolution.
- Verify required `Implementation Entry Points` exist.

### Step 3: Governance Check

For each remaining top candidate:
- Check `planning-invalid` label.
- Check template headings and structured issue refs format.
- Check uncertainty-term bans in tasks/AC/commands.
- Check Test Necessity Decision presence and consistency.
- Set governance evidence level: `verified`, `unclear`, or `missing`.

### Step 4: Recommend

- Pick highest-ranked candidate after gates.
- If governance is `verified`, recommend assignment now.
- If governance is `unclear` or `missing`, still recommend candidate if strongest, but set `governance-check-required` and require running `issue-planning-governor` first.

### Step 5: Return Advice

Provide concise output with:
- recommended issue
- recommendation status (`assign-now` or `governance-check-required`)
- why this issue
- governance evidence summary
- exact next action
- fallback issue (optional)

## Output Template

Use this exact structure:

```text
NEXT ISSUE ADVICE
Recommended Issue: #[number] - [title]
Status: [assign-now | governance-check-required]
Confidence: [high | medium | low]
Data Freshness: [ISO timestamp]

Why This Issue
- [reason 1]
- [reason 2]
- [reason 3]

Governance Check
- Evidence level: [verified | unclear | missing]
- planning-invalid: [present | absent]
- Template/readiness notes: [one concise line]

Required Next Action
- If assign-now: Assign GitHub assigned cloud Copilot to #[number].
- If governance-check-required: Run issue-planning-governor on #[number], then assign GitHub assigned cloud Copilot.

Fallback
- #[number] - [title] ([one-line reason])
```

## Good Example

```text
NEXT ISSUE ADVICE
Recommended Issue: #153 - [S5.1.2] Add renderer trigger for local backup snapshot creation
Status: assign-now
Confidence: high
Data Freshness: 2026-08-08T10:20:00Z

Why This Issue
- Unblocked and open.
- Same active F5.1 slice as current work.
- Governance evidence is complete and consistent.

Governance Check
- Evidence level: verified
- planning-invalid: absent
- Template/readiness notes: Required sections present, deterministic commands listed, test necessity decision present.

Required Next Action
- Assign GitHub assigned cloud Copilot to #153.

Fallback
- #154 - [S5.1.3] Add renderer trigger for backup snapshot restore (same slice, similarly unblocked)
```

## What to Avoid

- Recommending an issue without governance status.
- Recommending any issue with `planning-invalid` as `assign-now`.
- Returning more than one primary recommendation.
- Using vague rationale such as "seems best" without rule-based evidence.

## Stop Conditions

Stop and escalate when any apply:
- No open candidate passes assignability precheck.
- Required issue data cannot be read.
- Parent/blocked-by relationships cannot be verified.

Escalation format:
- Blocked reason: [short reason]
- Evidence: [exact missing data or tool error]
- Requested user action: [one concrete action]
- Next step after action: [what will be done]

## Quality Targets

- Q1 Never recommend an issue with `planning-invalid` for direct assignment.
- Q2 Always return one primary recommendation or one blocked escalation.
- Q3 Always include governance status and explicit next action.
- Q4 Keep recommendation aligned with active feature slice when possible.
- Q5 Keep output compact and deterministic.
