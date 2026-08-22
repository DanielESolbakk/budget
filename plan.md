# Plan: Local Budget Planner

Build a Windows-first, local-first household budgeting desktop app using Electron, React, TypeScript, and SQLite. Keep all financial transaction content on-device, start with digital PDF + CSV + manual entry, and use a deterministic merchant-normalization and rule-based categorization engine before adding optional local OCR or local ML. Pair the build with strong repo guidance, acceptance criteria, and test artifacts so a future LLM can implement it predictably.

## Steps

1. Phase 1: Product and architecture foundation. Create a feature PRD for the desktop budget planner, an ADR selecting Electron + React + TypeScript + SQLite, and a domain glossary covering household, account, transaction, category, merchant, rule, budget, forecast, import job, and backup. This blocks all later implementation because it fixes the vocabulary and boundaries.
2. Phase 1: Repo guidance and LLM handoff scaffolding. Populate repo instructions, coding conventions, review prompts, and the docs structure under /docs/ways-of-work/plan so future implementation work has explicit acceptance criteria, file ownership expectations, and test strategy. This can run in parallel with the PRD once the architecture decision is stable.
3. Phase 1: Model the core data domain. Define SQLite schema and repository contracts for households, accounts, transactions, categories, merchant aliases, category rules, monthly budgets, forecast assumptions, import jobs, and backup/export metadata. Include an audit trail for import provenance and category corrections. This depends on step 1.
4. Phase 2: Implement the import pipeline. Build import flows for standalone text, CSV, binary digital PDFs, and manual transaction entry. Add local PDF extraction, parser adapters per source, duplicate detection, import review, and failure reporting. Keep scanned-image OCR out of the first milestone; design the importer so OCR can be added as a parser adapter later. This depends on step 3.
5. Phase 2: Implement categorization. Build merchant normalization, default category seeds for Norwegian household finance, rule-based classification, confidence scoring, and a review queue for low-confidence matches. Corrections should teach the rule engine by generating or refining local rules. Keep an interface boundary so a future local ML classifier can be added without changing the transaction UI. This depends on steps 3 and 4.
6. Phase 3: Build the desktop application shell. Create the Electron shell, React app, and feature modules for onboarding, import workflow, transaction ledger, category management, rule management, dashboard, budgets, and forecasts. Use a local IPC/service boundary so UI logic stays testable and does not couple directly to persistence. This depends on steps 3 through 5.
7. Phase 3: Deliver the first budgeting and forecasting experience. Start with monthly category targets, actual-vs-target tracking, recurring income/expense detection, and a simple forward cashflow projection. Defer envelope budgeting and richer goal planning to a follow-up feature after the ledger and classification flow are stable. This depends on steps 5 and 6.
8. Phase 4: Privacy, backup, and export. Enforce a no-network-by-default app posture, add backup/export flows for SQLite plus CSV exports, and document what leaves the machine and what never does. This can proceed in parallel with late Phase 3 UI work once the schema is stable.
9. Phase 4: Quality system and release readiness. Add unit tests for parsers and rules, integration tests for import-to-ledger flows, Playwright desktop end-to-end tests for the critical workflows, representative PDF and CSV fixtures, and non-functional checks for performance with at least 10,000 transactions. This depends on steps 4 through 8.
10. Phase 4: GitHub planning automation. Use the breakdown-plan skill to turn the PRD and technical breakdown into Epic > Feature > Story/Enabler > Test issues, with dependencies and acceptance criteria. This should happen after steps 1 and 2 produce the source planning documents, and before broad implementation begins.

## Issue Hierarchy

1. Epic: Foundations and LLM delivery scaffolding.
2. Epic: Transaction ingestion and normalization.
3. Epic: Categorization and correction workflow.
4. Epic: Dashboard, budgeting, and forecasting.
5. Epic: Privacy, backup, export, and release quality.
6. Under each epic, create Features first, then Stories for user-facing behavior, Enablers for schema/parser/test infrastructure, and explicit Test issues for fixture coverage, parser accuracy, and end-to-end flows.

## Relevant Files

- README.md — replace the placeholder with project vision, local-first privacy statement, and development entry points.
- .github/skills/breakdown-plan/SKILL.md — use this as the issue hierarchy and checklist template source.
- .github/copilot-instructions.md — add implementation constraints, architecture rules, and artifact requirements for future LLM execution.
- .github/instructions/style.instructions.md — define coding, testing, and documentation conventions.
- [ADR-001: Stack and Runtime Boundaries](docs/ways-of-work/plan/budget-planner/adr-001-stack-and-runtime-boundaries.md) — architecture decision record for locked stack and runtime boundaries.
- [ADR-002: Multi-Format Import and Review Boundaries](docs/ways-of-work/plan/budget-planner/adr-002-multi-format-import-and-review-boundaries.md) — proposed local extraction, adapter, and review boundaries for text, CSV, and PDF imports.
- [Budget Planner Domain Glossary](docs/ways-of-work/plan/budget-planner/domain-glossary.md) — canonical domain terms used across docs, code, tests, and issues.
- docs/ways-of-work/plan/budget-planner/budget-planner.md — feature PRD.
- docs/ways-of-work/plan/budget-planner/technical-breakdown.md — domain model, import pipeline, and module boundaries.
- docs/ways-of-work/plan/budget-planner/implementation-plan.md — execution order, dependencies, and validation steps.
- docs/ways-of-work/plan/budget-planner/project-plan.md — issue-ready hierarchy and release slices.
- docs/ways-of-work/plan/budget-planner/issue-catalog.json — machine-readable planning reference and seeded issue keys.
- docs/ways-of-work/plan/budget-planner/issues-checklist.md — GitHub issue creation checklist.

## Verification

1. Validate standalone text, binary PDF, and CSV fixtures against the parser spike before committing to the final importer design; success means the local extractor and adapters preserve source rows reliably enough that OCR can stay deferred.
2. Confirm categorization quality with a labeled merchant fixture set covering common Norwegian merchants such as grocery, transport, utilities, salary, transfers, and subscriptions; success means deterministic rules plus corrections produce stable results.
3. Run end-to-end tests for import, review, correction, dashboard refresh, budget target updates, forecast refresh, export, and backup restore.
4. Run a no-network verification pass in development and packaged builds to ensure the default application path does not send transaction data externally.
5. Run performance checks for at least 10,000 transactions and multiple accounts to confirm the desktop UI remains responsive.

## Decisions

- Included scope: Windows-first desktop app, one local user managing a household across multiple accounts, digital PDF + CSV + manual entry, local-only storage, backup/export, dashboard, budgeting, forecasting, search, and manual correction.
- Deliberately excluded from the first milestone: bank APIs, live bank sync, multi-device collaboration, cloud-hosted processing of transaction content, scanned-image OCR unless sample artifacts force it, and advanced envelope or goal planning as day-one requirements.
- Recommended stack: Electron + React + TypeScript + better-sqlite3 or equivalent SQLite binding, shared schema validation, and Playwright/Vitest for testability. This is favored over Tauri or PySide because the repo is empty, the future developer is likely an LLM, and the Electron/TypeScript ecosystem gives the most predictable implementation path for a modern GUI app.
- Stack comparison outcome: Tauri remains technically viable, but it is not the preferred choice because Rust plus a split frontend/backend stack raises delivery risk, slows iteration, and weakens LLM-driven implementation and testing compared with a unified TypeScript desktop architecture.

- Classification strategy: rules-first with merchant normalization and confidence scoring, plus a clean extension point for future local ML. This reduces early complexity while preserving a path to smarter categorization.
- Privacy boundary: transaction content stays local by default. External services are only acceptable later for non-sensitive metadata, and should be off by default.
- Public repository handling: this repository is public. Do not commit secrets, credentials, raw bank statements, unsanitized financial exports, local databases, backups, or user-specific absolute file system paths. Keep sensitive local-only artifacts in gitignored paths such as local/, private/, data/local/, or fixtures/private/.

## Further Considerations

1. If the sample PDFs contain layout variance across multiple Norwegian banks, add a bank-specific parser registry early rather than relying on one generic parser.
2. If you want envelope budgeting and savings-goal planning equal to monthly targets in the first serious release, split budgeting into a separate feature epic instead of treating it as one dashboard extension.
3. If future optional intelligence is desired, define a plugin boundary now so local OCR or local ML can be added without changing the storage model or UI contracts.
