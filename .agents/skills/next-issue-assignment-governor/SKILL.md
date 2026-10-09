---
name: next-issue-assignment-governor
description: Use when selecting the next cloud-Copilot issue from an open backlog, especially when documented project value, readiness, or parent-test dependencies conflict.
argument-hint: "Exclude issue numbers and optional focus slice (example: exclude #144, focus F5.1)"
compatibility: Requires GitHub MCP issue read/search tools, repository file access, and issue-planning-governor skill availability.
metadata:
  owner: budget-repo
  workflow: next-issue-advice
  version: "1.1"
---

# Next Issue Assignment Governor

## Overview

Recommend a cloud-Copilot assignment only after remaining work is proven against the exact default-branch commit and governance is verified. If the highest-value target cannot pass those gates because evidence is unclear or planning needs repair, return it separately as preparation-only with its exact next action; never imply it is assignable. Active-slice continuity ranks candidates but does not limit the search.

## Decision Contract

- Enumerate the full paginated open planning backlog. For a new assignment, exclude every already-assigned or in-progress issue. Do not exclude older unassigned issues by age alone. Honor explicit focus and exclusion arguments.
- Resolve and audit the exact default-branch `BASE_SHA`. `work-remains` requires a directly confirmed in-scope gap; exclude `satisfied-on-main`. Skip candidate-specific `unclear` for assignment scoring. If the shared `BASE_SHA` is unavailable, stop the completion audit.
- Rank documented project value before assignment convenience, using the user's stated goal, roadmap priority, launch criteria, critical-path relationships, or a directly stated user outcome. Do not infer value from recency, issue readiness, source symbols, or a missing test file.
- For a Test issue, verify its parent behavior is delivered at `BASE_SHA`, or its immediate Story/Enabler is actively assigned, implementation-ready, and unblocked. Otherwise rank the implementation owner or its preparation action; do not recommend the Test first.
- Keep a higher-value issue primary when its planning gaps are repairable; route it through `issue-planning-governor` rather than switching to a lower-value ready issue. Never invent an Enabler, Story, Test, acceptance criterion, or dependency.
- If the highest-value candidate's completion is `unclear` and a concrete evidence or governance action exists, return it as `preparation-only`. State `Completion Check: unclear`; do not claim `work-remains`, score it as assignable, or assign it.
- Compare plausible equal- or higher-value candidates across the full inventory. If the highest-value scope has a real unresolved dependency, identify that prerequisite or stop with the exact blocker.
- Require an open, unblocked, unassigned issue with required entry-point infrastructure. Apply the missing-entry-point blocker only to exact paths declared as `Implementation Entry Points`; an absent task-deliverable file is work when its declared directory exists.
- **Hard assignment gate:** only `issue-planning-governor` returning `verified` permits `assign-now`. `planning-invalid`, repo-owner authority, deadlines, accepted risk, conditional PR terms, and substitute labels cannot waive this gate. Never assign first and defer governance.
- Keep Test issues verification-only, preserve story/feature test boundaries, and maintain local-only transaction handling.
- Return direct assignment advice only after completion, eligibility, value-ranking, and governance gates pass. A preparation-only target is not an assignment recommendation. At most one fallback may be included, and it must independently pass the direct-assignment gates.

## Required References

- **REQUIRED:** Follow [references/assignment-workflow.md](references/assignment-workflow.md) for GitHub evidence, candidate evaluation, validation, output, and escalation.
- Use [references/candidate-scoring-rubric.md](references/candidate-scoring-rubric.md) and [references/governance-check-mini-checklist.md](references/governance-check-mini-checklist.md).
- **REQUIRED SUB-SKILL:** Use `verification-before-completion` before any completion or validation claim.
- Use `reviewing-pr-delivery` only for criterion-mapping discipline; do not run its PR review or checkbox-sync workflow.
