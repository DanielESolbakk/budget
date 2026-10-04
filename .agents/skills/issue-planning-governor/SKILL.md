---
name: issue-planning-governor
description: Use when creating, updating, validating, or resolving scope, hierarchy, grooming, and readiness issues for GitHub Feature, Story, Enabler, or Test issues in the budget repository.
compatibility: Requires GitHub MCP issue tools and repository planning rules in .github/copilot-instructions.md. Do not use gh; Actions validation may require an authorized human through GitHub UI.
metadata:
  owner: budget-repo
  workflow: issue-planning
  version: "1.4"
---

# Issue Planning Governor

Govern Feature, Story, Enabler, and Test planning, not implementation. Epics are read-only hierarchy context.

## Rules

- Never delete; close only for completed criteria or a linked successor.
- `planning-invalid` blocks readiness. Repair only after a fresh failure, at most twice. Timeout, unresolved blockers, or permission failures stop the run.
- Use GitHub MCP, never `gh`; MCP cannot dispatch or inspect Actions runs. Issue-record updates need no PR; repository-file changes do.
- Keep transaction content local; add no cloud processing, telemetry, or analytics.
- Use `- #NUMBER` references in structured sections; ban uncertainty in tasks, criteria, and validation commands.
- A workflow pass proves structure only. Preserve `needs-grooming` until G1-G9 pass with quoted evidence.
- Apply R16/G9 to visible UI; non-renderer work is exempt. Impeccable is opt-in.

## Workflow

Before any issue mutation, read and follow [Issue Batch Governance](references/issue-batch-governance.md). Use [templates](references/templates.md), [checklists](references/checklists.md), and the [readiness deep dive](references/assignment-readiness-deep-dive.md) for issue content and readiness.

Run G1-G9 from the deep-dive. Quote each pass with evidence only after fresh structural validation; keep `needs-grooming` until applicable checks pass. After 180 seconds without one, stop without repair.

## References

Load `references/repair-playbooks.md` only after a fresh failure; use the runbook/evaluation references as needed.
