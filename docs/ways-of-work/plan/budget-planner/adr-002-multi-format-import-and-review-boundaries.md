# ADR-002: Multi-Format Import and Review Boundaries

## Status

Proposed

## Date

2026-08-22

## Context

The budget planner must accept standalone text statements, CSV exports, and binary digital PDFs from banks selected by the household user. The current implementation has separate text-PDF and CSV paths, and the PDF path reads UTF-8 text directly rather than extracting text from binary PDF bytes.

Bank statement layouts vary. A single hard-coded parser cannot provide durable coverage for every bank. Imports also produce imperfect input such as wrapped descriptions, repeated page headers, unreadable PDFs, missing fields, and malformed rows. The application must keep valid data useful while making every unresolved source row explainable and recoverable.

## Decision Drivers

- Transaction content remains local by default.
- The renderer remains separate from file access, parsing, and persistence.
- Parser output is deterministic and auditable.
- Adding a bank layout does not change the shared import coordinator contract.
- Valid rows remain useful without silently dropping unresolved source content.
- Existing ledger records remain readable through additive schema migration.

## Decision

### Input Contract

The import boundary accepts three user-selectable local file types:

- Standalone `.txt` statement text
- `.csv` statement exports
- Binary digital `.pdf` statements

A native file chooser filters these extensions. The main process owns file access and determines the input type before invoking the appropriate local service.

### Extraction Boundary

Binary PDFs are converted to ordered text pages by a local extraction service. The extracted representation preserves page identity, source offsets, and raw row text. Multi-page documents retain repeated headers, footers, and wrapped-description continuation data for downstream classification.

Standalone text files bypass binary extraction and enter the same source-document contract. Scanned-image OCR is outside the first implementation boundary.

### Adapter Boundary

Parser adapters implement a stable source-aware contract with:

- Capability detection
- Stable adapter identity
- Source identity
- Deterministic candidate ordering
- Explicit diagnostics for unknown layouts and malformed rows

The import coordinator uses the adapter registry and does not contain a bank-specific switch. A new bank layout is added as an adapter with synthetic or sanitized fixtures while shared transaction, import-job, and review contracts remain stable.

Rogaland Sparebank remains the initial regression adapter. DNB, Bank2, and future bank layouts are added independently as source fixtures and adapters.

### Review and Persistence Boundary

Each import can produce valid candidates and unresolved review items. Valid candidates persist immediately with import provenance. Unresolved rows do not create transactions until corrected. A correction validates canonical date, amount, merchant, account, and currency fields before creating one transaction with correction provenance.

A dismissal creates no transaction and records the raw row, source identity, parser diagnostics, user reason, and timestamp. Repeated correction or dismissal commands are deterministic and duplicate-safe.

Review items, correction history, and dismissal audit data are stored locally through additive SQLite migrations. The import job retains source and adapter provenance for both successful and partial outcomes.

### Privacy Boundary

PDF extraction, text parsing, CSV mapping, review, correction, and persistence run locally. No transaction content is sent to cloud services, bank APIs, telemetry, analytics, or background network calls.

## Consequences

### Positive

- The three supported input types share one clear local boundary.
- Bank-specific variation is isolated in adapters.
- Partial imports remain useful without silently converting malformed rows into transactions.
- Review and dismissal actions remain explainable from local provenance.
- Existing transaction and dashboard consumers can evolve without knowing extraction details.

### Negative

- Binary PDF extraction adds a native or JavaScript dependency and packaging validation work.
- The review queue and audit model require new schema tables and migration tests.
- Supporting arbitrary bank layouts remains an incremental adapter and fixture effort.
- Multi-page and wrapped-row handling increases parser test complexity.

## Alternatives Considered

### One Generic Bank Parser

Rejected. Bank layouts differ in headers, row grouping, amount columns, page artifacts, and continuation lines. A generic parser would accumulate fragile heuristics and weaken auditability.

### Cloud PDF Extraction

Rejected. It violates the local-first privacy boundary for transaction content and introduces network availability as an import dependency.

### Atomic Import Only

Rejected for the agreed user workflow. The product should preserve valid rows immediately while retaining unresolved rows for manual correction or audited dismissal.

### Separate Implementations for Each File Type

Rejected. Format-specific extraction and mapping may differ, but the shared source-document, candidate, provenance, review, and persistence contracts should remain consistent.

## Testing Implications

- Unit tests cover binary extraction, source capability selection, row classification, exact fixture output, review transitions, correction validation, and dismissal audit construction.
- Integration tests cover extraction-to-ledger persistence, provenance, migrations, partial outcomes, and duplicate-safe repeated actions.
- Playwright tests cover native file selection, successful and unresolved import states, correction, dismissal, dashboard refresh, and no-network behavior.
- Fixtures use synthetic or sanitized text, CSV, and binary PDF inputs for Rogaland, DNB, Bank2, unknown layouts, wrapped descriptions, repeated page headers, and malformed rows.

## Acceptance Criteria for This ADR

- [ ] The implementation plan identifies standalone text, CSV, and binary PDF input boundaries.
- [ ] The adapter contract permits new bank layouts without changing the import coordinator.
- [ ] The review contract distinguishes valid transactions, unresolved rows, corrected rows, and dismissed rows.
- [ ] The persistence plan records source evidence and audit provenance through additive migrations.
- [ ] The privacy and testing boundaries are reflected in linked planning issues #15, #16, #206, #207, #208, #212, and #213.
