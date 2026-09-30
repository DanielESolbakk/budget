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

Use this skill for issue-governance planning, not implementation. It governs one primary issue at a time; handle an explicitly requested batch sequentially.

## Scope

- In scope: lifecycle and readiness work for Feature, Story, Enabler, and Test issues.
- Epic issues may be read for hierarchy checks, but do not create, rewrite, validate, or close them.
- Out of scope: issue deletion, code implementation, and PR implementation.

## Rules

- Never delete issues. Close only for completed acceptance criteria or a superseding issue link.
- `planning-invalid` blocks readiness. Repair only after a fresh failing validation, at most twice. Timeout, unresolved blockers, or permission failures stop the run.
- Use GitHub MCP for issue operations; do not use GitHub CLI (`gh`). MCP issue access does not provide Actions dispatch or run-status access.
- Keep financial content local by default. Do not introduce cloud processing, telemetry, or analytics for transaction content.
- Keep product implementation and test execution separate; Test issues verify existing behavior.
- Use `- #NUMBER` in structured reference sections. Ban uncertainty wording in Technical Tasks, Acceptance Criteria, and Validation Commands.
- Decide Test Necessity. If tests are required, map every parent AC to a test issue and name the immediate parent as the AC source; AC IDs belong to their declaring issue.
- Declare Unit (Vitest), Integration (Vitest), and runtime end-to-end (Playwright) coverage, or link a follow-up for each deferred layer. Keep runner and folder labels aligned.
- R16 Frontend planning completeness applies to visible UI. See the deep-dive for G9 requirements; issues without renderer entry points or UI changes are exempt. Impeccable is opt-in.

## Workflow

1. **Preflight:** Read the issue body, labels, and recent comments. Confirm supported type, hierarchy, linked issues, blockers, Test Necessity, and test layers. Before mutation, confirm an authorized human can trigger and verify fresh planning validation through GitHub UI. Stop if type, hierarchy, or a validation route cannot be verified.
2. **Update:** Use `references/templates.md`. Keep existing entry points real; list new files as tasks. Keep implementation and test ownership separate.
3. **Validate:** Follow the Validation Loop Checklist. A pre-existing `planning-invalid` label is not a fresh processing signal. MCP issue writes are not validation signals. If no fresh signal appears within 180 seconds, stop and escalate without repair.
4. **Readiness:** Run G1-G9 and the deep-dive checks in `references/assignment-readiness-deep-dive.md`. Quote evidence for each pass; mark G9 not applicable only when the issue has no renderer-visible work.
5. **Finalize:** Use the evidence format in `references/checklists.md`. Report changes, validation, Test Necessity, test-layer status, blockers, and follow-ups. Do not advance after a stop condition.

## References

- Load `references/checklists.md` for preflight, validation, evidence, and escalation formats.
- Load `references/assignment-readiness-deep-dive.md` for G1-G9 and assignment checks.
- Load `references/repair-playbooks.md` only after a fresh validation failure.
- Use `references/runbook-example.md` and `references/evaluation-checklist.md` as needed.
