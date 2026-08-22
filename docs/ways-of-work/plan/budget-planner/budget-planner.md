# Budget Planner PRD

## Overview

Budget Planner is a Windows-first desktop application for a household user managing multiple accounts on one machine. The product imports standalone text statements, binary bank statement PDFs, CSV exports, and manual entries, then organizes transactions with deterministic categorization rules and human review workflows.

The first milestone prioritizes reliable import, understandable categorization, searchable review, monthly dashboards, monthly category targets, simple forecasting, and backup and export.

## Problem Statement

The user needs a modern local desktop tool to understand income and expenses without depending on bank APIs, cloud processing, or third-party budgeting services. Existing budgeting tools often assume online sync, cloud storage, or opaque categorization. This product must keep financial transaction content on-device by default and still provide useful automation and review workflows.

## Target User

- One local household user managing multiple accounts
- Comfortable importing statements manually
- Needs clear monthly overviews, category tracking, and forecast visibility
- Values privacy, local control, and understandable categorization logic

## Goals

- Import transactions from standalone text files, CSV files, binary digital PDFs, and manual entry
- Route imports through extensible source-aware adapters without hard-coding one bank in the import coordinator
- Normalize merchants and categorize transactions using deterministic rules first
- Surface low-confidence classifications for review and correction
- Show monthly dashboards for income, expenses, and category performance
- Support monthly category targets and simple forward-looking forecasts
- Keep financial transaction content local by default
- Provide backup and export without vendor lock-in

## Non-Goals For First Milestone

- Live bank synchronization
- Bank APIs
- Multi-device collaboration
- Cloud processing of transaction content
- Scanned-image OCR unless real samples make it necessary
- Advanced envelope budgeting as a release blocker
- Advanced goal-based planning as a release blocker

## Product Scope

### In Scope

- Household, account, transaction, category, merchant alias, categorization rule, budget target, forecast assumption, import job, and backup snapshot concepts
- Standalone text statement import
- Binary digital PDF statement import
- CSV import
- Manual transaction entry
- Duplicate detection and import provenance
- Default editable categories
- Merchant normalization and rule-based categorization with confidence scoring
- Review queue for low-confidence or unmatched transactions
- Search, filter, and manual correction workflows
- Monthly category targets
- Simple forward cashflow projection
- Backup and export workflows

### Out Of Scope

- Automatic bank syncing
- Shared multi-user collaboration
- Cloud-hosted intelligence over transaction content
- Raw scanned receipt OCR as a first-milestone requirement
- Business bookkeeping and accounting compliance workflows

## Core User Flows

1. Select a local text, CSV, or PDF statement and preview detected transactions.
2. Correct or dismiss unresolved import rows, then confirm duplicate handling and account mapping.
3. Review low-confidence categories and correct transactions.
4. Browse the ledger with search and filters.
5. View monthly totals, category trends, and budget target performance.
6. Review a simple forecast based on recurring income and expense patterns.
7. Export data or create a backup snapshot.

## Functional Requirements

### Import

- The application must import transactions from standalone text files, CSV files, binary digital PDFs, and manual transaction entry.
- The application must route each input through an extensible source-aware adapter boundary without hard-coding one bank in the coordinator.
- The application must retain unresolved import rows for manual correction or audited dismissal.
- The application must preserve import provenance, including source type and import job history.
- The application must detect likely duplicates before finalizing import.
- The application must show import errors and partial failures clearly.

### Categorization

- The application must normalize merchant names before categorization.
- The application must categorize using deterministic rules before any future smarter local automation.
- The application must attach a confidence score or equivalent review signal to classification results.
- The application must allow user corrections and use those corrections to refine future rule behavior.

### Ledger And Review

- The application must provide a searchable, filterable ledger.
- The application must support reviewing uncategorized and low-confidence transactions.
- The application must allow manual edits to category, merchant alias, notes, and account mapping where appropriate.

### Budgeting And Forecasting

- The application must support monthly category targets.
- The application must show actual versus target values for a month.
- The application must provide a simple forward-looking forecast using stored transactions and recurring patterns.

### Privacy, Backup, And Export

- The application must work locally without cloud dependency for baseline workflows.
- The application must offer backup and restore behavior that preserves data integrity.
- The application must allow export in user-controlled formats such as CSV.

## Acceptance Criteria

- [ ] AC1: A user can import a standalone text file or binary digital PDF and preview detected transactions and unresolved rows.
- [ ] AC2: A user can import a CSV file and map required fields when headers do not match defaults.
- [ ] AC3: Duplicate detection prevents accidental duplicate transaction creation during repeated imports.
- [ ] AC4: Merchant normalization and categorization rules assign categories to common household transactions with reviewable confidence.
- [ ] AC5: A user can review low-confidence transactions and correct categories from the ledger or review queue.
- [ ] AC6: A user can search and filter the ledger by account, date, merchant, amount, and category.
- [ ] AC7: A user can set monthly category targets and see actual versus target values.
- [ ] AC8: A user can view a simple forecast for future cashflow based on current data.
- [ ] AC9: A user can export data and create a backup snapshot locally.
- [ ] AC10: Default workflows handling transaction content do not send data externally.

## Success Metrics

- A statement import and review flow can be completed without leaving the desktop app.
- Common Norwegian merchants can be categorized with stable deterministic behavior.
- Import, review, dashboard, forecast, export, and backup critical flows have automated coverage.
- The app remains responsive with at least 10,000 transactions across multiple accounts.

## Dependencies

- Architecture decision record for Electron, React, TypeScript, and SQLite
- Domain glossary using the locked repository vocabulary
- Sample sanitized digital text PDFs and CSV fixtures
- CI and PR enforcement already added in `.github/`

## Test Strategy

| Acceptance criterion | Unit | Integration | End-to-end |
| --- | --- | --- | --- |
| AC1 Text/PDF import review | Extraction, adapter selection, and row classification | Import job and review persistence | Import text/PDF through desktop workflow |
| AC2 CSV mapping | Field mapping validation | CSV import orchestration | Import CSV through desktop workflow |
| AC3 duplicate detection | Duplicate fingerprint rules | Repeat import against stored ledger | Re-import scenario in desktop flow |
| AC4 categorization | Merchant normalization and rule engine | Categorization during import | Import plus review confirmation |
| AC5 correction workflow | Rule refinement logic | Correction persistence and queue updates | Review and correct low-confidence items |
| AC6 ledger search and filters | Query builders and selectors | Repository filter behavior | Search and filter ledger in UI |
| AC7 monthly targets | Budget target calculations | Target persistence and aggregation | Set and view monthly targets |
| AC8 forecasting | Recurring pattern and projection logic | Forecast pipeline with stored transactions | View forecast in dashboard |
| AC9 backup and export | Export serializer and backup manifest logic | Backup restore integrity | Export and restore user workflow |
| AC10 no-network behavior | Verification helpers and allowlist checks | App-process verification in packaged and dev modes | Confirm critical flows operate without outbound transaction traffic |
