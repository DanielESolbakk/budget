---
name: issue-planning-governor
description: Use when governing lifecycle changes, validation, or assignment readiness for GitHub feature, story, enabler, or test issues in the budget repository, including planning-invalid repair and hierarchy checks.
compatibility: Requires GitHub MCP issue tools and repository planning rules in .github/copilot-instructions.md. Do not use gh; Actions validation may require an authorized human through GitHub UI.
metadata:
  owner: budget-repo
  workflow: issue-planning
  version: "1.4"
---

# Issue Planning Governor

Govern Feature, Story, Enabler, and Test planning, not implementation. Handle one issue at a time; process batches sequentially and stop on any stop condition. Epics are read-only hierarchy context.

## Rules

- Never delete; close only for completed criteria or a linked successor.
- `planning-invalid` blocks readiness. Repair only after a fresh failure, at most twice. Timeout, unresolved blockers, or permission failures stop the run.
- Use GitHub MCP, never `gh`; MCP cannot dispatch or inspect Actions runs.
- Keep transaction content local; do not add cloud processing, telemetry, or analytics.
- Use `- #NUMBER` for structured references; ban uncertainty in tasks, criteria, and validation commands.
- A workflow pass proves structure only. Preserve `needs-grooming` until G1-G9 pass with quoted evidence.
- Apply R16/G9 to visible UI; non-renderer work is exempt. Impeccable is opt-in.

## Issue Materialization Gate

- Keep unscheduled ideas roadmap-only; never create empty delivery/Test hierarchies for visibility.
- Create an Enabler only when a real same-Feature Story exists. Never invent a Story to satisfy validation.
- Decide Test Necessity from changed behavior. Create Tests only after an immediate Story/Enabler owns delivered or active implementation scope. Each Test owns one layer and executable scenarios/commands.
- Never create coverage anchors, reserved scenarios, placeholder commands, or Tests solely for traceability, triangle completeness, or validator success. Declare Unit, Integration, and Playwright intent on the parent; link concrete follow-ups only when justified.
- If the requested hierarchy cannot pass this gate, leave it `needs-grooming`, report the missing decision/scope, and stop rather than manufacture links.

## Workflow

1. **Preflight:** Read body, labels, comments; verify type, hierarchy, blockers, gate, Test Necessity, and layers. Confirm a human can trigger and verify fresh UI validation.
2. **Update:** Use `references/templates.md`. Existing entry points must be real; list new files as tasks. Map each parent AC to a necessary Test and name the immediate parent as AC source.
3. **Validate:** Follow the Validation Loop Checklist. Existing labels and MCP writes are not fresh signals. After 180 seconds without one, stop without repair.
4. **Readiness:** Run G1-G9 from the deep-dive. Quote each pass; G9 is N/A only without renderer-visible work.
5. **Finalize:** Use the checklist evidence format. Report changes, validation, Test Necessity, layers, blockers, and follow-ups.

## References

Load `checklists.md` and `assignment-readiness-deep-dive.md`. Load `repair-playbooks.md` only after a fresh failure; use the runbook/evaluation references as needed.
