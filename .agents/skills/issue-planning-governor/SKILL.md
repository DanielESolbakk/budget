---
name: issue-planning-governor
description: Use when governing lifecycle changes, validation, or assignment readiness for GitHub feature, story, enabler, or test issues in the budget repository, including planning-invalid repair and hierarchy checks.
compatibility: Requires GitHub MCP issue tools and repository planning rules in .github/copilot-instructions.md. Do not use gh; Actions validation may require an authorized human through GitHub UI.
metadata:
  owner: budget-repo
  workflow: issue-planning
  version: "1.3"
---

# Issue Planning Governor

Use for issue-governance planning, not implementation. Handle one primary issue at a time; process explicitly requested batches sequentially.

## Scope

- Covers lifecycle and readiness for Feature, Story, Enabler, and Test.
- Epic issues may be read for hierarchy checks, but do not create, rewrite, validate, or close them.
- Excludes issue deletion, coding, and pull-request implementation.

## Rules

- Never delete; close only for completed criteria or a linked successor.
- `planning-invalid` blocks readiness. Repair only after a fresh failing validation, at most twice. Timeout, unresolved blockers, or permission failures stop the run.
- Use GitHub MCP for issue operations; do not use GitHub CLI (`gh`). MCP issue access does not provide Actions dispatch or run-status access.
- Keep transaction content local; do not add cloud processing, telemetry, or analytics.
- Keep product implementation and test execution separate; Test issues verify existing behavior.
- Use `- #NUMBER` for structured references; ban uncertainty in tasks, criteria, and validation commands.
- Decide Test Necessity. If tests are required, map every parent AC to a test issue and name the immediate parent as the AC source; AC IDs belong to their declaring issue.
- Declare Unit (Vitest), Integration (Vitest), and runtime end-to-end (Playwright) coverage; link a follow-up per deferred layer and align runner and folder labels.
- R16 Frontend planning completeness applies to visible UI. See the deep-dive for G9 requirements; issues without renderer entry points or UI changes are exempt. Impeccable is opt-in.

## Workflow

1. **Preflight:** Read issue body, labels, comments; verify type, hierarchy, links, blockers, Test Necessity, and test layers. Before mutation, confirm an authorized human can trigger and verify fresh GitHub UI validation; stop if type, hierarchy, or validation route is unverified.
2. **Update:** Use `references/templates.md`. Keep existing entry points real; list new files as tasks. Keep implementation and test ownership separate.
3. **Validate:** Follow the Validation Loop Checklist. A pre-existing `planning-invalid` label is not a fresh processing signal. MCP issue writes are not validation signals. If no fresh signal appears within 180 seconds, stop and escalate without repair.
4. **Readiness:** Run G1-G9 and the deep-dive checks in `references/assignment-readiness-deep-dive.md`. Quote evidence for each pass; mark G9 not applicable only when the issue has no renderer-visible work.
5. **Finalize:** Use the evidence format in `references/checklists.md`. Report changes, validation, Test Necessity, test-layer status, blockers, and follow-ups. Do not advance after a stop condition.

## References

- Load `references/checklists.md` for preflight, validation, evidence, and escalation formats.
- Load `references/assignment-readiness-deep-dive.md` for G1-G9 and assignment checks.
- Load `references/repair-playbooks.md` only after a fresh validation failure.
- Use `references/runbook-example.md` and `references/evaluation-checklist.md` as needed.
