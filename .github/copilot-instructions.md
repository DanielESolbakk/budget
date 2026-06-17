# Budget Planner Repository Instructions

## PR Workflow

All code changes require pull requests via GitHub MCP tools:
- Create feature branches for all work
- Use `mcp_github_mcp_se_create_pull_request` to submit changes
- Wait for human approval before merge (Git CLI unavailable; branch protection enforces server-side)

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

## Test Automation Triangle

- Unit (broad base): pure logic, parsing, normalization, validation, deterministic calculations.
- Integration (narrower): cross-module workflows, persistence, import-to-ledger, IPC, data contracts.
- Playwright end-to-end (focused): critical user journeys only; cannot substitute for cheaper lower-layer tests.
- Every Story/Feature must state coverage plan (unit/integration/Playwright); excluded layers must link follow-up issue.

## Change Management

- Preserve a clear path for future local OCR or local ML, but do not let speculative extensibility complicate the first implementation.
- If a change alters architecture, schema boundaries, or privacy posture, update the planning documents in the same work.
- If a feature request conflicts with these instructions, surface the conflict explicitly and resolve it through a documented decision rather than silently drifting the architecture.

## Agent Blocked-Work Policy

- If an assigned issue has open `Blocked by` issues, the agent must post a comment on the issue listing the unresolved blockers and stop. Do not implement any subset of the work.
- If an assigned issue lists `Implementation Entry Points` paths that do not exist in the workspace, the agent must post a comment identifying the missing infrastructure and stop. Do not silently implement only the feasible subset.
- Deferred technical tasks must be tracked as explicit open issues — not silently omitted from the PR. If a task cannot be done in the current PR, create or reference a follow-up issue in the PR body before closing.

## Available Tooling

- GitHub CLI (`gh`) is available in the terminal for all GitHub operations (issues, PRs, labels, releases, etc.).
- Prefer the GitHub MCP tools for structured issue/PR creation and reading when available, but fall back to `gh` for any operations not covered by MCP tools.

## Agent Instruction Entry Points

- `.github/copilot-instructions.md` is the repository-wide policy and architecture source of truth.
- `AGENTS.md` exists as a short execution-time entrypoint for Copilot cloud agent with the fastest path to commands, architecture map, and issue handoff expectations.
- Keep the two files aligned. Put durable policy, scope, and quality rules here. Put concise task-start guidance in `AGENTS.md` so the agent can consume both without duplicating the full policy document.

## Assigned Copilot Operational Guidance

- For PR AC mapping, default to the primary planning issue as the AC source unless the PR explicitly requests aggregate scope across additional planning issues. Describe in the "Acceptance Criteria to Test Mapping" section how this PR helps satisfy each AC from the linked issue. Format is free-form prose (not structured rows). Focus on clarity and completeness; manual reviewer verification will determine if coverage is adequate. You do not need to follow strict syntax rules, but ensure each AC is mentioned clearly.
- Permission mismatch can happen: an agent may be able to comment while being unable to edit issue/PR body fields. When this occurs, post one concise owner action checklist and stop repeating retries.
- Avoid looped remediation comments. Repeat only when validation output changed, permissions changed, or new evidence was collected.

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

## Planning Signal Discipline

- Before implementing, review issue body, labels, and linter comments for validation results
- Stop and repair any issue marked `planning-invalid` before writing implementation code
- Derive hierarchy from `docs/ways-of-work/plan/budget-planner/issue-catalog.json`; keep GitHub issues aligned with catalog
- If PR links to invalid planning issue, treat work as blocked until resolved

## Planning Bot Output Guardrails

Use this checklist when generating or auto-updating planning issues so `planning validation` passes on first run.

1. Section formatting
- Use `###` headings exactly as expected by templates.
- Inside reference sections, use bullet issue refs only: `- #NUMBER`.
- Do not use inline refs (`#22`) or comma-separated refs (`#22, #23`) inside section bodies.

2. Required sections by issue type
- Story must include: Parent Epic Issue, Parent Feature Issue, Linked Test Issues, Testing Requirements, Implementation Entry Points, Validation Commands, Fixture Or Example Inputs, Out Of Scope.
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
