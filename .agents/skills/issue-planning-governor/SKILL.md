---
name: issue-planning-governor
description: Use when governing lifecycle, validation, or assignment readiness for GitHub Feature, Story, Enabler, or Test issues, including planning-invalid repair and hierarchy checks.
compatibility: Requires GitHub MCP issue tools and repository planning rules in .github/copilot-instructions.md. Do not use gh; Actions validation may require an authorized human through GitHub UI.
metadata:
  owner: budget-repo
  workflow: issue-planning
  version: "1.3"
---

# Issue Planning Governor

Use for issue governance, not implementation. Handle one primary issue at a time; process requested batches sequentially.

## Scope

- Scope: Feature, Story, Enabler, and Test issue lifecycle/readiness.
- Epic issues may be read for hierarchy checks, but do not create, rewrite, validate, or close them.
- Out of scope: deleting issues or implementing code/PRs.

## Rules

- Never delete issues. Close only when acceptance criteria are complete or a superseding issue is linked.
- A pre-existing `planning-invalid` label is not a fresh processing signal. `planning-invalid` blocks readiness. Repair only after a fresh failing validation, at most twice. Timeout, unresolved blockers, or permission failures stop the run.
- Use GitHub MCP, not `gh`; it cannot dispatch Actions or inspect run status.
- Keep transaction content local; no cloud processing, telemetry, or analytics.
- Separate implementation from tests; Test issues verify existing behavior.
- Use `- #NUMBER` in reference sections; ban uncertainty in Technical Tasks, Acceptance Criteria, and Validation Commands.
- Decide Test Necessity. If required, map every parent AC to a test issue and name the immediate parent as its source; AC IDs belong to their declaring issue.
- Declare Unit (Vitest), Integration (Vitest), and runtime end-to-end (Playwright) coverage, or link a follow-up for each deferred layer; align runner and folder labels.
- R16 Frontend planning completeness applies to visible UI. See the deep-dive for G9 requirements; issues without renderer entry points or UI changes are exempt. Impeccable is opt-in.

## Workflow

1. **Preflight:** Read body, labels, and recent comments. Confirm type, hierarchy, links, blockers, Test Necessity, test layers, and an authorized route for fresh GitHub UI validation. Stop if any cannot be verified.
2. **Update:** Use `references/templates.md`. Keep entry points real; list new files as tasks. Separate implementation and test ownership.
3. **Validate:** Follow the Validation Loop Checklist. A pre-existing `planning-invalid` label is not a fresh processing signal. MCP issue writes are not validation signals. If no fresh signal appears within 180 seconds, stop and escalate without repair.
4. **Readiness:** Run G1-G9 and the deep-dive checks in `references/assignment-readiness-deep-dive.md`. Quote evidence for each pass; mark G9 not applicable only when the issue has no renderer-visible work.
5. **Finalize:** Use `references/checklists.md`. Report changes, validation, Test Necessity, layer status, blockers, and follow-ups. Stop at any gate.

## References

- Load `references/checklists.md` for preflight, validation, evidence, and escalation formats.
- Load `references/assignment-readiness-deep-dive.md` for G1-G9 and assignment checks.
- Load `references/repair-playbooks.md` only after a fresh validation failure.
- Use `references/runbook-example.md` and `references/evaluation-checklist.md` as needed.
