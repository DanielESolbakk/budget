---
name: issue-planning-governor
description: Use when creating, updating, validating, or resolving scope, hierarchy, grooming, and readiness issues for GitHub Feature, Story, Enabler, or Test issues in the budget repository.
compatibility: Requires GitHub MCP issue tools and repository planning rules in .github/copilot-instructions.md. Do not use gh; Actions validation may require an authorized human through GitHub UI.
metadata:
  owner: budget-repo
  workflow: issue-planning
  version: "1.6"
---

# Issue Planning Governor

Govern Feature, Story, Enabler, and Test planning, not implementation. Epics are read-only hierarchy context.

## Rules

- Never delete; close only for completed criteria or a linked successor.
- `planning-invalid` blocks readiness. Repair only after a fresh failure, at most twice. Timeout or permission failure stops the validation run; unresolved blockers stop assignment, not planning.
- Use GitHub MCP, never `gh`; inspect available Actions tools rather than assuming capabilities. Issue-record updates need no PR; repository-file changes do.
- Serialize GitHub MCP issue writes. Never parallelize issue creation; verify each created issue before creating the next.
- Keep transaction content local; add no cloud processing, telemetry, or analytics.
- Use `- #NUMBER` references in structured sections; ban uncertainty in tasks, criteria, and validation commands.
- A workflow pass proves structure only. Preserve `needs-grooming` until G1-G9 pass as planning checks with quoted evidence; an accurately documented open blocker alone is not a planning defect.
- After planning checks pass, remove `needs-grooming` even if an open blocker remains. Report the issue as blocked and unassignable until blockers and missing runtime prerequisites are resolved.
- At assignment, check each blocker against its live issue state. A closed prerequisite is not an open blocker and does not require an issue edit before work starts; verify required product/runtime seams separately.
- Plan concrete Tests alongside approved Stories/Enablers before product code exists. Require parent ACs, one layer, expected scenarios, fixtures, file-creation tasks, commands, and product blockers; missing implementation blocks assignment, not planning. Never create coverage anchors.
- Apply R16/G9 to visible UI; non-renderer work is exempt. Impeccable is opt-in.

## Workflow

Before any issue mutation, read and follow [Issue Batch Governance](references/issue-batch-governance.md). Use [templates](references/templates.md), [checklists](references/checklists.md), and the [readiness deep dive](references/assignment-readiness-deep-dive.md) for issue content and readiness.

For interactive forms, follow the repository-wide [GitHub MCP Interactive Writes contract](../../../.github/copilot-instructions.md#github-mcp-interactive-writes); pending requests are neither verified UI delivery nor saved writes.

When reporting batch progress, give the known remaining approval and validation-trigger counts separately; identify unknown counts and why. Include any separate post-validation label updates in the estimate.

Run G1-G9 from the deep-dive. Treat them as planning checks. Quote each pass with evidence only after fresh structural validation; keep `needs-grooming` until those checks pass. Separately check assignment prerequisites; do not assign an issue with an open blocker or missing runtime. A fresh structural validation result is required. After 180 seconds without one, stop without repair.

## References

Load `references/repair-playbooks.md` only after a fresh failure; use the runbook/evaluation references as needed.
