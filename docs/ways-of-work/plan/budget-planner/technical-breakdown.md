# Budget Planner Technical Breakdown

## Architecture Summary

The application uses Electron for the desktop shell, React for the renderer, TypeScript for application code, and SQLite for local persistence. The Electron main process and service layer own business logic. The renderer is limited to presentation and user interaction.

## Runtime Boundaries

### Renderer

- Onboarding screens
- Import flow UI
- Ledger, search, filters, and review UI
- Budget and forecast views
- Backup and export UI

### Main Process And Services

- IPC handlers
- SQLite access and migrations
- Import orchestration
- Local document extraction
- Text, CSV, and PDF parser adapters
- Merchant normalization
- Categorization rules and confidence logic
- Forecast calculations
- Backup and export services
- No-network verification hooks

### Shared Layer

- Domain types
- Validation contracts
- Result types and error envelopes
- Shared enums and constants

## Module Breakdown

### Import Pipeline

- Import coordinator creates an import job and routes text, CSV, and PDF input to the correct parser adapter.
- Local document extraction converts binary PDFs to text while preserving page and source-row metadata.
- Standalone text files enter the same parser boundary without requiring PDF extraction.
- CSV parser adapter handles delimiter, encoding, and field mapping.
- Manual entry uses shared validation and persistence contracts.
- Duplicate detection compares imported candidates against persisted transactions.
- Import review records parsed rows, unresolved rows, warnings, duplicates, corrections, and dismissals.
- Valid rows may persist immediately; unresolved rows never become transactions until corrected, and dismissed rows retain an audit record.

### Categorization Pipeline

- Merchant normalization standardizes raw merchant text into a consistent alias candidate.
- Categorization rule evaluation applies user and seeded rules in deterministic order.
- Confidence scoring distinguishes auto-accept, review, and uncategorized outcomes.
- User corrections create or refine local categorization rules for future imports.

### Ledger And Review

- Ledger queries expose filtering by account, date, merchant, amount, category, and confidence.
- Import review isolates unresolved rows from text, CSV, and PDF imports.
- Categorization review isolates low-confidence and uncategorized transactions.
- Correction actions update the transaction record and retain provenance.

### Budgeting And Forecasting

- Monthly budget target service stores and aggregates per-category targets.
- Forecast service derives simple forward projections from historical recurring transactions and current balances when available.

### Backup And Export

- Backup snapshot service captures database state and metadata needed for restore.
- Export service produces user-controlled outputs such as CSV.

## Data Model Direction

### Core Entities

- household
- account
- transaction
- category
- merchant alias
- categorization rule
- import job
- import review item
- budget target
- forecast assumption
- backup snapshot

### Suggested Tables

- `households`
- `accounts`
- `transactions`
- `categories`
- `merchant_aliases`
- `categorization_rules`
- `import_jobs`
- `import_job_rows`
- `import_review_items`
- `budget_targets`
- `forecast_assumptions`
- `backup_snapshots`

## Persistence Notes

- Use additive schema evolution with explicit migrations.
- Store import provenance for each transaction and review item.
- Preserve source file identity, page number, raw row text, and parser diagnostics for review and audit.
- Keep valid transaction persistence separate from unresolved-row and dismissal state.
- Maintain clear correction history or auditable rule provenance.

## Multi-Format Import Strategy

- Accept standalone text files, CSV files, and binary PDFs through one local import boundary.
- Extract text from binary PDFs locally before adapter selection; scanned-image OCR remains out of scope.
- Support multi-page PDFs, repeated page headers and footers, and descriptions wrapped across continuation lines.
- Select adapters by source capabilities rather than hard-coding one bank in the import coordinator.
- Add bank-specific adapters when layouts diverge, while keeping the shared transaction and review contracts stable.
- Unknown layouts produce explicit diagnostics and reviewable unresolved rows instead of silently producing incomplete transactions.

## SQLite Binding Note

- `better-sqlite3` is a reasonable default for synchronous local desktop access and deterministic query behavior.
- Document native-module rebuild and packaging steps explicitly in the future ADR and implementation setup.
- If packaging friction becomes disproportionate, an equivalent SQLite binding can be substituted without changing the broader architecture.

## Testing Breakdown

### Unit

- PDF extraction and text normalization helpers
- Text, CSV, and PDF adapter selection and row classification
- Import review state transitions and correction validation
- Duplicate detection
- Merchant normalization
- Categorization rules and confidence logic
- Forecast calculations
- Export serializers

### Integration

- Import-to-ledger flow for text, CSV, and binary PDF inputs
- Import review persistence, correction, and dismissal audit behavior
- Correction updates rule behavior
- Budget target persistence and aggregation
- Backup restore integrity
- No-network verification harness for protected workflows

### End-to-End

- Select and import text, CSV, and PDF files
- Review, correct, and dismiss unresolved import rows
- Review and correct categories
- Search ledger
- Update budget targets
- View forecast
- Export data
- Restore backup

## Open Technical Risks

- PDF layout variance across Norwegian banks
- Binary PDF extraction quality for wrapped and multi-page rows
- Native SQLite packaging on Windows with Electron
- Review-state complexity across three input formats
- Drift between seeded categories and user-corrected rules
- Ensuring no-network verification remains meaningful in development and packaged builds

## Decisions To Lock In ADRs

- Final SQLite binding and packaging guidance
- PDF extraction library and extensible adapter strategy
- Import review row states and correction audit schema
- Shared validation library choice
- Desktop test harness split for Vitest e2e smoke and Playwright runtime e2e
