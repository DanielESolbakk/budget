# ADR-001: Stack and Runtime Boundaries

## Status

Accepted

## Date

2026-05-23

## Context

Budget Planner is a Windows-first desktop product for one local household user. The first release must support digital PDF statements, CSV import, and manual transaction entry while keeping transaction content on-device by default.

The repository is LLM-developer-first, so the architecture must reduce ambiguity and encourage deterministic implementation and testability.

## Decision Drivers

- Local-first privacy and no-network-by-default handling of financial content
- Predictable implementation path for TypeScript-oriented contributors
- Clear separation of UI and business logic for test coverage
- Practical desktop packaging for Windows
- Deterministic categorization and auditable correction flows

## Decision

Use the following locked stack unless superseded by a later ADR:

- Electron for desktop runtime and packaging
- React for renderer UI
- TypeScript across renderer, main process, and shared contracts
- SQLite for local persistence, using better-sqlite3 or equivalent binding

## Runtime Boundaries

### Renderer Process

- Responsible for presentation and user interaction only
- Must not directly access SQLite or raw file-system persistence behavior
- Calls business workflows through IPC contracts

### Main Process and Service Layer

- Source of truth for business logic
- Owns import orchestration, persistence, categorization, export, backup, and forecast workflows
- Performs boundary validation on IPC payloads before invoking services

### Shared Layer

- Owns domain types and validation contracts shared across runtime boundaries
- Defines stable contracts for IPC and service interfaces

### Import and Parser Layer

- Uses source-aware parser adapters (for example, per bank statement format)
- Keeps parser-specific logic isolated instead of merging all heuristics into one parser

## Privacy and Data Handling Constraints

- Transaction content remains local by default
- No background network calls for transaction workflows
- No cloud sync, bank APIs, telemetry, or analytics in baseline scope
- Only sanitized or synthetic fixtures are allowed in committed repository artifacts

## Testing Implications

- Unit tests for parser adapters, merchant normalization, rule evaluation, and forecasting logic
- Integration tests for import-to-ledger behavior, correction persistence, and backup/restore workflows
- End-to-end desktop tests for critical user journeys
- A no-network verification check is required for development and packaged builds

## Consequences

### Positive

- Unified TypeScript stack improves implementation consistency and handoff quality
- Clear runtime boundaries make business logic easier to test and review
- SQLite preserves local-first privacy and supports deterministic behavior

### Negative

- Native SQLite bindings can introduce Windows packaging and rebuild friction
- Electron packaging and update pipelines add operational complexity
- Strict boundaries require discipline in IPC contract design

## Alternatives Considered

### Tauri plus React plus TypeScript plus Rust services

Rejected for first release. While technically viable, it introduces a split-language delivery path and higher implementation risk for LLM-driven iteration.

### PySide plus Python plus SQLite

Rejected for first release. Desktop feasibility is strong, but it diverges from the TypeScript-first collaboration and tooling path chosen for this repository.

### Browser-only web app

Rejected for first release. It weakens local-only guarantees and introduces unnecessary privacy and deployment complexity for the target scope.

## Acceptance Criteria

- [ ] Runtime boundaries are enforced in code layout and reviews
- [ ] Renderer code does not directly own persistence or import business logic
- [ ] Business workflows are testable outside UI components
- [ ] CI validates required lint, typecheck, test, and no-network scripts once scaffolding exists
- [ ] Follow-up ADRs are created before changing stack or boundary decisions
