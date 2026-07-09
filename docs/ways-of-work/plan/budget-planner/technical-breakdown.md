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
- PDF and CSV parser adapters
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

- Import coordinator creates an import job and routes to the correct parser adapter.
- PDF parser adapter handles digital text PDF extraction.
- CSV parser adapter handles delimiter, encoding, and field mapping.
- Manual entry uses shared validation and persistence contracts.
- Duplicate detection compares imported candidates against persisted transactions.
- Import preview provides parsed rows, warnings, duplicates, and failures before commit.

### Categorization Pipeline

- Merchant normalization standardizes raw merchant text into a consistent alias candidate.
- Categorization rule evaluation applies user and seeded rules in deterministic order.
- Confidence scoring distinguishes auto-accept, review, and uncategorized outcomes.
- User corrections create or refine local categorization rules for future imports.

### Ledger And Review

- Ledger queries expose filtering by account, date, merchant, amount, category, and confidence.
- Review queue isolates low-confidence and uncategorized transactions.
- Correction actions update the transaction record and rule set with provenance.

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
- `budget_targets`
- `forecast_assumptions`
- `backup_snapshots`

## Persistence Notes

- Use additive schema evolution with explicit migrations.
- Store import provenance for each transaction.
- Preserve enough raw source metadata to explain parser results and category assignment.
- Maintain clear correction history or auditable rule provenance.

## PDF Import Strategy

- Assume digital text PDFs first.
- Validate with real sanitized bank statement samples before finalizing parser shape.
- Prefer bank-specific parser adapters if layouts diverge.
- Keep scanned-image OCR as a deferred adapter behind the same import interface.

## SQLite Binding Note

- `better-sqlite3` is a reasonable default for synchronous local desktop access and deterministic query behavior.
- Document native-module rebuild and packaging steps explicitly in the future ADR and implementation setup.
- If packaging friction becomes disproportionate, an equivalent SQLite binding can be substituted without changing the broader architecture.

## Testing Breakdown

### Unit

- PDF parsing helpers
- CSV mapping and validation
- Duplicate detection
- Merchant normalization
- Categorization rules and confidence logic
- Forecast calculations
- Export serializers

### Integration

- Import-to-ledger flow
- Correction updates rule behavior
- Budget target persistence and aggregation
- Backup restore integrity
- No-network verification harness for protected workflows

### End-to-End

- Import PDF
- Import CSV
- Review and correct categories
- Search ledger
- Update budget targets
- View forecast
- Export data
- Restore backup

## Open Technical Risks

- PDF layout variance across Norwegian banks
- Native SQLite packaging on Windows with Electron
- Drift between seeded categories and user-corrected rules
- Ensuring no-network verification remains meaningful in development and packaged builds

## Decisions To Lock In ADRs

- Final SQLite binding and packaging guidance
- PDF extraction library or adapter strategy
- Shared validation library choice
- Desktop test harness split for Vitest e2e smoke and Playwright runtime e2e
