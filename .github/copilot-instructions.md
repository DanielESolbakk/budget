# Budget Planner Repository Instructions

## Product Intent

This repository builds a Windows-first desktop budget planner for a household user managing multiple accounts locally.

The application must:
- run locally as a desktop GUI application
- keep transaction content on-device by default
- support digital PDF bank statements, CSV imports, and manual transaction entry
- categorize transactions through merchant normalization and deterministic rules before any smarter local automation is introduced
- provide budgeting, forecasting, search, review, backup, and export workflows

## Locked Architecture Decisions

- Use Electron, React, TypeScript, and SQLite unless an explicit architecture decision record replaces that stack.
- Keep the renderer process focused on presentation and user interaction.
- Keep import, persistence, categorization, export, backup, and forecasting logic outside the UI layer.
- Treat the Electron main process plus service layer as the source of truth for business logic.
- Keep shared domain types and validation contracts in a dedicated shared layer.

## Privacy And Data Handling

- Financial transaction data must remain local by default.
- Do not add bank APIs, cloud sync, telemetry, analytics, or background network calls unless the user explicitly approves a scope change.
- External services are not allowed to process transaction content in the baseline product.
- Prefer explicit user-initiated file import and export flows.
- Design backup and export so the user can recover or move their data without vendor lock-in.

## Public Repository Handling

- This GitHub repository is public. Assume anything committed to the repository is visible to anyone.
- Never commit secrets, tokens, credentials, private keys, raw bank statements, unsanitized financial exports, backups, local databases, or personally identifying financial artifacts.
- Do not commit user-specific absolute file system paths in code, docs, issues, or planning artifacts. Use repository-relative paths or neutral placeholders instead.
- Keep local-only sensitive artifacts in gitignored paths such as local/, private/, data/local/, backups/local/, or fixtures/private/.
- Only commit sanitized or synthetic fixtures that are safe for public distribution.
- If real financial samples are needed for local testing, store them only in ignored paths and document the expected sanitized fixture shape in the repository.

## Delivery Priorities

Build in this order unless a planning document states otherwise:
1. Planning documents and acceptance criteria
2. Core domain model and schema
3. Import pipeline
4. Categorization and correction workflow
5. Desktop application shell and user workflows
6. Budgeting and forecasting
7. Backup, export, privacy verification, and release hardening

Do not jump to polished UI work before the import, categorization, and persistence paths are stable.

## Required Planning Artifacts

Before broad implementation of a feature, maintain the relevant documents under docs/ways-of-work/plan.

At minimum, major features should have:
- a feature PRD
- a technical breakdown
- an implementation plan
- a project plan
- an issues checklist
- acceptance criteria that can map to tests and GitHub issues
- a test strategy section that maps acceptance criteria to unit, integration, and end-to-end coverage

Before broad implementation starts, create and maintain:
- an architecture decision record for stack and runtime boundaries
- a domain glossary covering core product terms

When planning work for GitHub issues, follow the existing Epic > Feature > Story or Enabler > Test structure defined by the repository planning skill.

Use docs/ways-of-work/plan/budget-planner/issue-catalog.json as the machine-readable planning reference for seeded Epic, Feature, Enabler, and Test hierarchy.
- Prefer catalog keys and catalog parent relationships over hand-authored issue-number chains when creating or updating planning issues.
- Treat the catalog as the planning seed artifact and GitHub issue numbers as runtime references that must be kept aligned with it.

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

## Feature Scope Guidance

In scope for the first milestone:
- one local household user managing multiple accounts
- digital text PDFs
- CSV imports
- manual transaction entry
- default editable categories
- rule-based categorization with confidence scoring
- review and correction flows
- monthly dashboards
- monthly category targets
- simple forward-looking forecasting
- backup and export

Out of scope for the first milestone unless the user explicitly changes scope:
- live bank synchronization
- bank APIs
- multi-device collaboration
- cloud processing of transaction data
- scanned-image OCR unless real sample artifacts force it
- advanced envelope budgeting as a release blocker
- advanced goal-based planning as a release blocker

## Implementation Rules

- Model the domain first. UI naming and storage naming should match.
- Prefer deterministic business rules over opaque automation for categorization.
- Low-confidence categorization must surface in the product for review.
- User corrections should refine future categorization behavior through local rules or clearly auditable logic.
- Parser logic must be source-aware. If bank statement formats diverge, introduce parser adapters instead of piling heuristics into one parser.
- Keep import flows idempotent where possible through duplicate detection and import provenance.
- Record enough metadata to explain where a transaction came from and why it received a category.

## Quality Bar

- Every meaningful feature should ship with tests that match its risk.
- Parser, normalization, and categorization logic require unit tests.
- Import-to-ledger flows require integration coverage.
- Critical user workflows require end-to-end desktop coverage.
- Use realistic fixtures, including representative Norwegian merchants and sanitized bank statement samples when available.
- Validate performance against at least 10000 transactions before treating the desktop UX as stable.
- Add a no-network verification check in development and packaged builds for default workflows handling transaction content.

## Test Enforcement For LLM Contributors

- Treat missing or weak automated tests for behavior changes as an incomplete implementation.
- For bug fixes, add or update a regression test that fails before the fix and passes after the fix.
- For feature work, map acceptance criteria to concrete automated tests before implementation starts.
- For cross-layer changes (parser, schema, categorization, IPC, and UI), add coverage at the unit and integration layers, plus end-to-end coverage for affected critical user journeys.
- Do not remove, weaken, or skip tests just to make a change pass review or CI.
- If a required automated test cannot be added immediately, document why in the implementation plan and issue, and create a linked follow-up test issue before closing the work.
- Keep fixtures deterministic and representative of Norwegian formats so results are reproducible across LLM iterations.
- Consider any change complete only when relevant test suites pass and acceptance criteria are demonstrably covered.

## Test Automation Triangle Policy

- Follow a test automation triangle with a broad unit base, a narrower integration layer, and a focused Playwright end-to-end layer.
- Default test layering for implementation issues:
	- Unit tests for pure logic, transformation, parsing, normalization, validation, and deterministic calculation behavior.
	- Integration tests for cross-module workflows, persistence contracts, import-to-ledger behavior, IPC boundaries, and fixture-driven data contracts.
	- Playwright end-to-end tests for critical user journeys only, including flows that span multiple layers and cannot be trusted through lower layers alone.
- Do not use Playwright tests as a substitute for unit or integration coverage when lower-level tests can validate behavior more cheaply and deterministically.
- Every Story and Feature planning issue must explicitly state how unit, integration, and Playwright coverage will be addressed.
- If one layer is intentionally excluded for a scoped issue, the issue must state why and link a follow-up test issue where applicable.

## Change Management

- Preserve a clear path for future local OCR or local ML, but do not let speculative extensibility complicate the first implementation.
- If a change alters architecture, schema boundaries, or privacy posture, update the planning documents in the same work.
- If a feature request conflicts with these instructions, surface the conflict explicitly and resolve it through a documented decision rather than silently drifting the architecture.

## Available Tooling

- GitHub CLI (`gh`) is available in the terminal for all GitHub operations (issues, PRs, labels, releases, etc.).
- Prefer the GitHub MCP tools for structured issue/PR creation and reading when available, but fall back to `gh` for any operations not covered by MCP tools.

## Agent Instruction Entry Points

- `.github/copilot-instructions.md` is the repository-wide policy and architecture source of truth.
- `AGENTS.md` exists as a short execution-time entrypoint for Copilot cloud agent with the fastest path to commands, architecture map, and issue handoff expectations.
- Keep the two files aligned. Put durable policy, scope, and quality rules here. Put concise task-start guidance in `AGENTS.md` so the agent can consume both without duplicating the full policy document.

## Planning Signal Discipline

- Before implementing from a GitHub issue, review the issue body, labels, and latest bot comments for planning validation results.
- If a planning issue has the planning-invalid label or an issue-traceability-lint failure comment, stop and repair the issue graph before writing implementation code.
- When opening or updating planning issues, derive initial hierarchy from docs/ways-of-work/plan/budget-planner/issue-catalog.json instead of inventing parent links from memory, then keep the issue graph aligned with the catalog.
- If a PR links to a planning issue marked planning-invalid, treat the work as blocked until the planning issue passes validation.
