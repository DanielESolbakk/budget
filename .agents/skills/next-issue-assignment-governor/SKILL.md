---
name: next-issue-assignment-governor
description: Use when choosing the next open GitHub issue for cloud Copilot assignment, prioritizing an issue backlog, or deciding whether completion or governance evidence blocks assignment.
argument-hint: "Exclude issue numbers and optional focus slice (example: exclude #144, focus F5.1)"
compatibility: Requires GitHub MCP issue read/search tools, repository file access, and issue-planning-governor skill availability.
metadata:
  owner: budget-repo
  workflow: next-issue-advice
  version: "1.0"
---

# Next Issue Assignment Governor

## Overview

Recommend one open planning issue for GitHub assigned cloud Copilot only after its remaining work is proven against the exact default-branch commit. Active-slice continuity ranks candidates; it does not limit the search.

## Decision Contract

- Enumerate the full paginated open planning backlog. For a new assignment, exclude every already-assigned or in-progress issue; existing work remaining does not make it available for reassignment. Do not exclude older unassigned issues by age alone. Honor explicit focus and exclusion arguments.
- Audit the exact `BASE_SHA`. `work-remains` requires a directly confirmed in-scope gap; exclude `satisfied-on-main`; skip candidate-specific `unclear` and continue. If the shared base SHA is unavailable, stop and escalate.
- The confirmed gap is the candidate's remaining assignment scope, not a prerequisite to finish before assignment. Governance verification is a separate direct-assignment gate.
- Compare plausible equal- or higher-ranked candidates across the full inventory before claiming an issue is strongest.
- Require an open, unblocked issue with required entry-point infrastructure. Apply the missing-entry-point blocker only to exact paths declared as `Implementation Entry Points`; an absent test file listed as a task deliverable is work when its declared entry-point directory exists.
- **Hard assignment gate:** `planning-invalid` blocks direct assignment; its absence alone does not establish readiness. Only `issue-planning-governor` returning `verified` permits `assign-now`. Do not treat repo-owner authority, deadline, accepted risk, conditional PR terms, or substitute labels as an exception. If asked to bypass this gate, retain `governance-check-required`; changing the rule requires changing governing repository policy first.
- Keep test issues verification-only, preserve story/feature test boundaries, and maintain local-only transaction handling.
- Return one primary recommendation only after the completion, eligibility, and ranking gates. At most one fallback may be included, and it must independently pass those gates.

## Required References

- **REQUIRED:** Follow [references/assignment-workflow.md](references/assignment-workflow.md) for GitHub evidence, candidate evaluation, validation, output, and escalation.
- Use [references/candidate-scoring-rubric.md](references/candidate-scoring-rubric.md) and [references/governance-check-mini-checklist.md](references/governance-check-mini-checklist.md).
- **REQUIRED SUB-SKILL:** Use `verification-before-completion` before any completion or validation claim.
- Use `reviewing-pr-delivery` only for criterion-mapping discipline; do not run its PR review or checkbox-sync workflow.
