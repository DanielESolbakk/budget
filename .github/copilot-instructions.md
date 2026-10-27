# Budget Planner Repository Instructions

## PR Workflow

All code changes require pull requests via GitHub MCP tools:
- Create feature branches for all work
- Use `mcp_github_mcp_se_create_pull_request` to submit changes
- Wait for human approval before merge; branch protection enforces server-side rules.

## Product Intent

This repository builds a Windows-first desktop budget planner for a household user managing multiple accounts locally.

The application must:
- run locally as a desktop GUI application
- keep transaction content on-device by default
- support digital PDF bank statements, CSV imports, and manual transaction entry
- categorize transactions through merchant normalization and deterministic rules before any smarter local automation is introduced
- provide budgeting, forecasting, search, review, backup, and export workflows

## Locked Architecture Decisions

- Use Electron, React, TypeScript, and SQLite unless an ADR replaces this stack.
- Keep renderer focused on presentation; move import, persistence, categorization, export, backup, forecasting logic to Electron main process plus service layer.
- Keep shared domain types and validation contracts in dedicated shared layer.

## Privacy And Data Handling

- Financial data remains local by default; no bank APIs, cloud sync, telemetry, analytics, or background network calls without explicit user approval.
- External services cannot process transaction content; prefer explicit user-initiated import/export.
- Design backup and export for user recovery and portability without vendor lock-in.

## Public Repository Handling

- Never commit secrets, credentials, raw bank statements, unsanitized exports, backups, databases, or PII.
- Use repository-relative paths (not absolute) and sanitized/synthetic fixtures only.
- Store real samples in gitignored paths (local/, private/, data/local/, backups/local/, fixtures/private/) with documented expected shape.

## Delivery Priorities

1. Planning documents and acceptance criteria
2. Core domain model and schema
3. Import pipeline
4. Categorization and correction workflow
5. Desktop application shell and user workflows
6. Budgeting, forecasting, backup, export, and release hardening

Do not polish UI before import, categorization, and persistence are stable.

## Required Planning Artifacts

Major features require: PRD, technical breakdown, implementation plan, project plan, issues checklist, acceptance criteria, test strategy.

Before broad implementation: create ADR for stack/runtime boundaries and domain glossary.

Follow Epic > Feature > Story/Enabler > Test structure. Use `docs/ways-of-work/plan/budget-planner/issue-catalog.json` as machine-readable reference; derive hierarchy from catalog keys, not hand-authored issue chains. Keep GitHub issues aligned with catalog.

## Domain Language

Use these terms consistently in code, tests, and documentation:
- household
- account
- transaction
- category
- merchant alias
- categorization rule
- import job
- budget target
- forecast assumption
- backup snapshot

Avoid inventing near-duplicates for the same concept.

## Feature Scope

**In scope:** one local user, multiple accounts, text PDFs, CSV/manual entry, default categories, rule-based categorization, review flows, monthly dashboards/targets, simple forecasting, backup/export.

**Out of scope:** live sync, bank APIs, multi-device, cloud processing, scanned-image OCR, advanced budgeting/planning (unless user changes scope).

## Implementation Rules

- Model the domain first. UI naming and storage naming should match.
- Prefer deterministic business rules over opaque automation for categorization.
- Low-confidence categorization must surface in the product for review.
- User corrections should refine future categorization behavior through local rules or clearly auditable logic.
- Parser logic must be source-aware. If bank statement formats diverge, introduce parser adapters instead of piling heuristics into one parser.
- Keep import flows idempotent where possible through duplicate detection and import provenance.
- Record enough metadata to explain where a transaction came from and why it received a category.

## Quality Bar

- Every feature ships with tests matching its risk.
- Parser, normalization, categorization logic: unit tests. Import-to-ledger: integration. Critical workflows: end-to-end.
- Use realistic Norwegian merchant fixtures and sanitized bank statement samples; validate against 10K+ transactions.
- Add no-network verification for default transaction workflows.

## Test Enforcement

- Missing/weak tests = incomplete work.
- Bug fixes: add regression test (fails before fix, passes after). Features: map acceptance criteria to tests before implementation. Cross-layer changes: unit + integration + end-to-end coverage.
- Do not remove/weaken tests to pass CI.
- If test deferred, document why and link follow-up issue.
- Keep fixtures deterministic and Norwegian-representative for reproducibility.
- Work complete only when test suites pass and acceptance criteria demonstrably covered.

## Coverage Signal Rules (Vitest)

- Treat coverage as a signal, not proof of correctness. Use it to find blind spots, not to replace behavioral assertions.
- Configure coverage under `test.coverage` in Vitest configs. Do not place coverage options at root level.
- Coverage signal commands must run with `vitest run` (non-watch) so agent executions terminate predictably.
- When using `coverage.include`, include target source paths explicitly so uncovered files are reported; otherwise percentages can look falsely high.
- Keep branch and function coverage in focus for deterministic business logic (import, normalization, categorization, forecasting), not just line coverage.
- If coverage thresholds fail for a touched deterministic module, add or improve tests in that module before broadening scope.

## AI Test Generation Guardrails (Vitest)

- Keep AI-generated tests behavior-focused and edge-case aware; do not accept happy-path-only output.
- Use Vitest APIs (`vi.*`) only.
- Apply detailed test authoring rules from `.github/instructions/testing.instructions.md`.

## Test Automation Triangle

- Unit (broad base): pure logic, parsing, normalization, validation, deterministic calculations.
- Integration (narrower): cross-module workflows, persistence, import-to-ledger, IPC, data contracts.
- Playwright end-to-end (focused): critical user journeys only; cannot substitute for cheaper lower-layer tests.
- Every Story/Feature must state coverage plan (unit/integration/Playwright); excluded layers must link follow-up issue.

### Planning-First Test Lifecycle

- Create concrete Test planning issues alongside an owner-approved Story or Enabler, before product implementation starts. Planning the tests does not require delivered or active product code.
- Each Test issue must name its immediate implementation owner and parent AC IDs, own one test layer, specify at least two reproducible scenarios with expected results, identify sanitized/synthetic fixtures, list existing entry-point directories and explicit test-file creation tasks, and provide scoped validation commands.
- Record missing product capabilities as explicit implementation-issue blockers. Use `needs-grooming` for unresolved planning defects, not an otherwise complete Test plan's open product blockers. Product implementation stays in the Story/Enabler, never hidden in a Test issue. Test issues may specify required future behavior without claiming it exists.
- Creation, structural validation, assignment readiness, test execution, and passing evidence are separate states. A planned Test can exist while blocked; do not assign it with unresolved blockers or missing product prerequisites. New test files belong in creation tasks, not nonexistent implementation entry points.
- TDD tests may be authored before or alongside the parent implementation, but expected red tests are not passing evidence or completion. Standalone Test assignment still requires its runtime/scaffolding prerequisites and all readiness gates.
- Do not create coverage anchors, reserved scenarios, placeholder commands, empty triangle-completeness issues, or Tests for unapproved roadmap ideas. Reuse or repurpose existing matching issues before creating new ones.

## Playwright Implementation Policy

- Canonical detailed contract: `.agents/skills/playwright-skill/SKILL.md`. Do not create a second Playwright rule set in issue bodies or other instruction files.
- `.github/instructions/playwright.instructions.md` is only the path trigger and pointer to that canonical skill.
- For an assigned Playwright issue, read the canonical skill before editing, use its required packs (`core`, `ci`, `pom`), and follow its locator, waiting, isolation, fixture, and artifact rules.
- If assigned Playwright coverage cannot be completed to that contract, post a concise blocker instead of shipping partial coverage.

## Change Management

- Preserve a clear path for future local OCR or local ML, but do not let speculative extensibility complicate the first implementation.
- If a change alters architecture, schema boundaries, or privacy posture, update the planning documents in the same work.
- If a feature request conflicts with these instructions, surface the conflict explicitly and resolve it through a documented decision rather than silently drifting the architecture.

## Agent Blocked-Work Policy

- If an assigned issue has open `Blocked by` issues, the agent must post a comment on the issue listing the unresolved blockers and stop. Do not implement any subset of the work.
- Resolve each `Blocked by` reference against its current GitHub state. A closed prerequisite does not block assignment or require a body edit before work can start; verify required implementation entry points and product/runtime seams separately.
- If an assigned issue lists `Implementation Entry Points` paths that do not exist in the workspace, the agent must post a comment identifying the missing infrastructure and stop. Do not silently implement only the feasible subset.
- Deferred technical tasks must be tracked as explicit open issues — not silently omitted from the PR. If a task cannot be done in the current PR, create or reference a follow-up issue in the PR body before closing.

## Available Tooling

- Prefer GitHub MCP for issue and pull-request operations. Check actual tool availability and authentication; do not assume Git CLI or Actions tools are unavailable. Local Git operations do not bypass server-side branch protection.

## Agent Instruction Entry Points

- `.github/copilot-instructions.md` is the repository-wide policy and architecture source of truth.
- `AGENTS.md` exists as a short execution-time entrypoint for Copilot cloud agent with the fastest path to commands, architecture map, and issue handoff expectations.
- Keep the two files aligned. Put durable policy, scope, and quality rules here. Put concise task-start guidance in `AGENTS.md` so the agent can consume both without duplicating the full policy document.

## Assigned Copilot Operational Guidance

- For PR AC mapping, default to the primary planning issue as the AC source unless the PR explicitly requests aggregate scope across additional planning issues. Describe in the "Acceptance Criteria to Test Mapping" section how this PR helps satisfy each AC from the linked issue. Format is free-form prose (not structured rows). Focus on clarity and completeness; manual reviewer verification will determine if coverage is adequate. You do not need to follow strict syntax rules, but ensure each AC is mentioned clearly. Mark at least one test command checkbox in "Test Evidence" to confirm validation was performed.
- Permission mismatch can happen: an agent may be able to comment while being unable to edit issue/PR body fields. When this occurs, post one concise owner action checklist and stop repeating retries.
- Avoid looped remediation comments. Repeat only when validation output changed, permissions changed, or new evidence was collected.
- Follow the GitHub MCP Interactive Writes contract below for complete form payloads, pending-state reporting, replacement requests, and saved-state verification.
- Determine available GitHub capabilities from the authenticated MCP tools, not browser sign-in or assumptions about tool names. Inspect actual validation results: a successful Actions run may still report issue-level planning failures.

## GitHub MCP Interactive Writes

1. **Read and prepare before writing.** Confirm repository, operation, target number, and current saved content. Check the selected tool really performs that operation: branch creation is not PR creation, and an existing issue needs update, not create. Complete prerequisites before the write; never run a create in parallel with its duplicate check or branch publication.
2. **Populate the complete form.** For an issue update, send the freshly fetched full `title`, full `body`, and complete intended `labels`, even for a label-only change; preserve unrelated content and labels. For a PR, supply a non-empty title and the full repository-template body, plus the intended repository/base/head. Do not send partial, empty, or "pending publication" placeholder forms: a missing required field can disable the user's green submit button.
3. **Verify a PR's remote head first.** Publish the intended commits, then read the remote branch/head commit and confirm it contains changes relative to the intended base. Check for an existing PR with that head/base before creating one. A local branch name alone is not sufficient; an unpublished/deleted head can produce `PullRequest.head (invalid)`.
4. **Report the observed state, not assumed UI delivery.** `awaiting_user_submission` means an approval request is pending, not that GitHub changed or the user can see a usable form. Say "MCP returned a pending approval request; the GitHub change is not yet verified," not "I sent you the form" or "updated." Distinguish requested, pending, user-reported submission, and read-back-verified states.
5. **Reconcile after submission or interruption.** Read the saved issue/PR and verify title, body, labels, branch, and hierarchy as applicable. An interrupted call has an unknown outcome, not automatic failure. A returned creation number is a successful create: reuse it and never replay that create. Before retrying an unknown create, reconcile matching records across open, closed, and merged states and verify the exact scope.
6. **Recover an unusable update once, with authorization.** If the user reports an invisible/empty form or disabled button, acknowledge that report; do not insist that it is visible or require cancellation the UI does not offer. If the user explicitly authorizes a replacement update to a known issue/PR, fetch its current state, verify the original change is absent, then send one fully populated replacement for that same target. This is not permission to duplicate a non-idempotent create. Identify the replacement by target and tell the user to submit only the intended replacement, not older forms.
7. **Stop only the affected write.** If the form remains unusable, record the exact blocked operation once and continue independent authorized work. Do not repeatedly ask for the same impossible submit/cancel action, bypass approval, manufacture alternate empty forms, or claim all MCP access is unavailable because the browser is signed out.
8. **Recheck after a human merge or branch switch.** Before the next commit/push/PR write, inspect the current local branch/worktree and the PR's remote state. If the previous PR merged and its branch was deleted, preserve uncommitted work and use a fresh feature branch for the next authorized change; do not reopen the merged PR or create against its stale head.

## Planning Issue Body Format (Linter Enforced)

**All issue references within `###` section headings must use bullet-point format (`- #NUMBER`):**

```markdown
### Parent Epic Issue
- #22

### Linked Test Issues
- #73
- #74
```

NOT: `#22` or `#73, #74` (inline or comma-separated).

**Rules:**
- Linter regex: `###\s+${escapedHeading}\s*\n([\s\S]*?)(?=\n###\s+|$)` extracts section content
- All issues must appear as list items: `- #NUMBER` (hyphen + space + number)
- Applies to: Parent Epic Issue, Parent Feature Issue, Linked Test Issues, Linked Enabler Issues, Parent Story Or Enabler Issue, etc.
- Use templates (Epic, Feature, Story, Test, Enabler) to ensure correct format
- If planning validation marks issue `planning-invalid`, correct formatting, then add the `validate-planning` label to re-validate

### Stories Without Separate Enablers

- A Story may own all of its implementation. A separate Enabler is required only for genuine enabling work, not for hierarchy completeness.
- Keep `### Linked Enabler Issues`. Link real same-feature Enablers as `- #NUMBER`, or use one explicit declaration with a concrete rationale:

```markdown
### Linked Enabler Issues
- None - This Story owns its allocation implementation; no shared enabling work is required.
```

- Do not mix `None` with issue references, use an empty/bare `None`, borrow unrelated Enablers, or create placeholder work to satisfy validation. Test links, parent alignment, blockers, and readiness requirements remain unchanged.
- When a validator rejects legitimate scope under documented policy, identify the conflicting rule and propose a focused, regression-tested validator/template/governance PR. Keep the affected issue `needs-grooming` and `planning-invalid` until the merged validator and a fresh run establish structural validity; continue unrelated authorized planning work.
- Structural validation removes `planning-invalid` only. It must not remove `needs-grooming` or imply planning completeness or assignment readiness; complete the issue-planning governor's semantic planning checks separately. A planning-complete issue with an open blocker remains unassignable even when `needs-grooming` is absent.

## Planning Signal Discipline

- Before implementing, review issue body, labels, and linter comments for validation results
- Stop and repair any issue marked `planning-invalid` before writing implementation code
- Derive hierarchy from `docs/ways-of-work/plan/budget-planner/issue-catalog.json`; keep GitHub issues aligned with catalog
- If PR links to invalid planning issue, treat work as blocked until resolved
- Treat tests as their own planning scope whenever an issue needs both behavior and verification: if a story or feature still needs product behavior changes, do not consider the issue complete just because tests were added.
- When creating or updating planning issues, keep implementation work and test work separated into their own issues unless the issue is explicitly a test issue.
- If an issue is meant to be test-only, say so explicitly in the issue body and keep it linked to the parent story or feature; do not let Copilot infer that a story is finished from test additions alone.

## Planning Bot Output Guardrails

Use this checklist when generating or auto-updating planning issues so `planning validation` passes on first run.

1. Section formatting
- Use `###` headings exactly as expected by templates.
- Inside reference sections, use bullet issue refs only: `- #NUMBER`.
- Exception: Linked Enabler Issues on a self-contained Story uses the justified `- None - <rationale>` declaration above instead of issue references.
- Do not use inline refs (`#22`) or comma-separated refs (`#22, #23`) inside section bodies.

2. Required sections by issue type
- Story must include: Parent Epic Issue, Parent Feature Issue, Linked Enabler Issues, Linked Test Issues, Testing Requirements, Implementation Entry Points, Validation Commands, Fixture Or Example Inputs, Out Of Scope.
- Feature must include: Parent Epic Issue, Test Issues In This Feature, Test Automation Triangle Coverage, Implementation Entry Points, Validation Commands, Fixture Or Example Inputs, Out Of Scope.
- Test must include: Test Scope Type, Parent Epic Issue, Parent Feature Issue (when scope is Story/Enabler or Feature), Test Level, Implementation Entry Points.
- Enabler must include: Parent Epic Issue, Parent Feature Issue, Stories Enabled.

3. Triangle coverage consistency
- If Feature `Test Automation Triangle Coverage` mentions unit/integration/playwright, linked test issues must include matching `Test Level` values.
- If a layer is deferred, the same line must explicitly say deferred/follow-up and include an issue ref (for example `#123`).

4. Enabler hierarchy rule (critical)
- Enabler issues are validated as feature-scoped: `Parent Feature Issue` must resolve to one feature issue.
- Every story in `Stories Enabled` must use that same `Parent Feature Issue`.
- Do not model one enabler as cross-feature unless lint rules are changed first.

5. Parent alignment checks
- Feature parent epic must match all linked feature tests.
- Story parent epic and parent feature must match linked test parent references.
- Linked enablers on stories must not point to a different parent feature than the story.

6. Label discipline
- Apply planning labels before lint runs (`epic`, `feature`, `user-story`, `enabler`, `test`).
- Treat `planning-invalid` as a blocking signal; fix body/links first, then add the `validate-planning` label to re-validate.

## Frontend Design Governance (Opt-In)

Frontend planning issues that include renderer entry points or visible UI changes may use the Impeccable design governance skill.
Impeccable is opt-in and applies only to frontend-relevant work; non-frontend issues do not require it.

**Privacy constraint:** Impeccable must not be used for cloud processing, telemetry, analytics, or any network access to transaction content. Financial data stays local by default.

### Prerequisites

- Node 22.12 or newer: `node --version`
- Impeccable installation: `npx impeccable install` (run from the repository root, one-time setup)
- Alternative: enable GitHub Copilot's built-in Experimental setting for Impeccable without installation

### Usage

1. Run `/impeccable init` before starting frontend implementation work on a planning issue.
2. Run `npx impeccable check` to validate design governance after changes.
3. Generated output files (`PRODUCT.md`, `DESIGN.md`, skill caches) must not be committed.

### Frontend Planning Requirements

Frontend-relevant planning issues must explicitly document:
- Design direction: intended visual style and interaction pattern
- Design-system preservation: which existing tokens, components, and patterns are reused
- Responsive behavior: breakpoints and layout expectations
- Accessibility: keyboard navigation, focus management, contrast, and ARIA requirements
- Visual-validation intent: how Impeccable or equivalent deterministic checks verify the result

Non-frontend issues (import, persistence, categorization, IPC, export, backup, forecasting) are exempt from these requirements.
