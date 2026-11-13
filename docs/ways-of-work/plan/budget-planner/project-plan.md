# Budget Planner Project Plan

## Project Overview

Budget Planner is a local-first desktop budget application for one local user managing multiple independent household ledgers, each with multiple accounts. The project aims to deliver trustworthy transaction import, deterministic categorization, reviewable automation, and privacy-preserving budgeting workflows.

## Feature Summary

- Reliable statement import from text files, binary PDFs, CSVs, and manual entry
- Deterministic merchant normalization and categorization rules
- Review queue for low-confidence outcomes
- Monthly dashboards, budget targets, and simple forecasting
- Local backup and export
- Separate household ledgers with in-app creation, selection, and switching
- A non-destructive “Start fresh” workflow that preserves the previous ledger

## Success Criteria

- Import and review workflows function end-to-end on Windows desktop.
- Critical transaction content workflows remain local by default.
- Automated tests cover parser, categorization, import-to-ledger, and desktop critical journeys.
- Representative fixtures support deterministic regression testing.
- The app remains responsive with at least 10,000 transactions.
- Existing local databases remain usable after adoption into the household-ledger registry.
- Reads, writes, imports, backups, and restores remain isolated to the selected household ledger.

## Key Milestones

1. Planning and governance artifacts complete
2. Domain model and schema drafted
3. Import and categorization core working
4. Desktop shell and ledger workflows working
5. Budgeting, forecasting, backup, and export working
6. Release-quality testing and verification complete
7. Local household-ledger management planned and implemented under E7

## Risk Assessment

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Digital PDF variance across banks | High | Validate early with sanitized samples and bank-specific adapters |
| Native SQLite packaging friction | Medium | Lock guidance in ADR and validate packaging early on Windows |
| LLM contributor skimps on tests | High | Use CI guardrails, PR template, and issue-level AC-to-test mapping |
| Public repo accidental data leakage | High | Use sanitized fixtures, public-repo rules, and gitignored local-only paths |
| Forecast scope creep | Medium | Keep first release to simple forward projections only |
| Legacy database adoption or ledger switching can select the wrong file | High | Register the existing database in place, keep path resolution in Electron main, and test two-ledger isolation and restart persistence |
| Backup restore can replace a different household ledger | High | Show target identity and require explicit mismatch handling before restore |

## Work Item Hierarchy

```mermaid
graph TD
    A[Epic: Foundations and LLM Delivery Scaffolding] --> A1[Feature: Planning and Governance Artifacts]
    A --> A2[Feature: Core Architecture Decisions]

    B[Epic: Transaction Ingestion and Normalization] --> B1[Feature: Text, CSV, and PDF Import]
    B --> B2[Feature: Import Review and Correction]
    B --> B3[Feature: Duplicate Detection and Provenance]

    C[Epic: Categorization and Correction Workflow] --> C1[Feature: Merchant Normalization]
    C --> C2[Feature: Review Queue and Corrections]

    D[Epic: Dashboard, Budgeting, and Forecasting] --> D1[Feature: Monthly Dashboard]
    D --> D2[Feature: Monthly Targets and Forecast]

    E[Epic: Privacy, Backup, Export, and Release Quality] --> E1[Feature: Backup and Export]
    E --> E2[Feature: Verification and Quality Gates]

    G[Epic: Local household ledger management (E7)] --> G1[Feature: Local household ledger management (F7.1)]
    G1 --> G2[Story: Create and switch household ledgers (S7.1.1)]
    G1 --> G3[Story: Start fresh without losing the previous ledger (S7.1.2)]
```

## Feature Breakdown

### Epic: Foundations and LLM Delivery Scaffolding

- Feature: Planning and governance artifacts
- Feature: ADR, glossary, and repo conventions
- Enabler: CI, PR template, and ruleset alignment
- Test: Governance validation and doc lint coverage

### Epic: Transaction Ingestion and Normalization

- Feature: Digital text PDF import
- Feature: CSV import and field mapping
- Feature: Manual entry and duplicate detection
- Feature: Cross-format import review and correction
- Enabler: Import job schema and parser adapters
- Enabler: Local document extraction and import review persistence
- Test: Parser fixtures, extraction, and import review coverage

### Epic: Categorization and Correction Workflow

- Feature: Merchant normalization
- Feature: Rule evaluation and confidence scoring
- Feature: Review queue and correction loop
- Enabler: Rule persistence and provenance model
- Test: Categorization fixtures and regression coverage

### Epic: Dashboard, Budgeting, and Forecasting

- Feature: Monthly dashboard and ledger insights
- Feature: Monthly category targets
- Feature: Simple forward cashflow forecast
- Enabler: Aggregation queries and forecast services
- Test: Dashboard and forecast end-to-end coverage

### Epic: Privacy, Backup, Export, and Release Quality

- Feature: Backup snapshot and restore
- Feature: CSV export
- Feature: No-network verification
- Enabler: Performance harness and packaging checks
- Test: Backup/export and no-network verification suites

### Epic: Local Household Ledger Management (#527, E7)

- Feature F7.1: Local household ledger management (#528)
- Story S7.1.1: Create and switch between local household ledgers, preserving existing records and restore identity (#529)
- Story S7.1.2: Start fresh in a new local household ledger while retaining the previous ledger (#534)
- Story S7.1.1 Tests: Unit #531, Integration #532, Playwright #533
- Story S7.1.2 Tests: Unit #535, Integration #536, Playwright #537
- No separate Enabler is planned: Story S7.1.1 owns the shared local-ledger manager used by Story S7.1.2.

## Priority Guidance

- P0: Planning artifacts, schema direction, import pipeline, categorization review loop
- P1: Desktop ledger, dashboards, targets, simple forecast
- P1: Backup, export, no-network verification, release-quality automation
- P1: Local household-ledger creation, switching, and non-destructive fresh-start workflow (E7)
- P2: Niceties that improve usability but do not block first usable release

## GitHub Project Board Guidance

- Backlog
- Sprint Ready
- In Progress
- In Review
- Testing
- Done

## Definition Of Done

- Acceptance criteria are complete
- Required automated tests pass
- Bug fixes include regression coverage
- Planning artifacts are updated when architecture, schema, or privacy posture changes
- Household-ledger operations preserve data isolation, legacy adoption, and explicit backup/restore identity.
- Public-repo handling rules are respected

## Sprint Planning Assumption

- 2-week sprints
- Protect 20 percent capacity for defects and integration surprises
- Keep parser and categorization work sliced narrowly enough for deterministic validation
