# Budget Planner Project Plan

## Project Overview

Budget Planner is a local-first desktop budget application for one household user managing multiple accounts. The project aims to deliver trustworthy transaction import, deterministic categorization, reviewable automation, and privacy-preserving budgeting workflows.

## Feature Summary

- Reliable statement import from text files, binary PDFs, CSVs, and manual entry
- Deterministic merchant normalization and categorization rules
- Review queue for low-confidence outcomes
- Inline transaction category editing with optional local merchant learning
  and category splitting; see S3.3.2 (#598) and Tests #599-#601
- Monthly dashboards, budget targets, and simple forecasting
- Mortgage repayment scenarios and local Rogaland bank-evidence import, beginning with F9.2 (#264), Story #539, and Tests #541, #543, and #544
- Local backup and export
- Activity automation, beginning with a local category catalog and create,
  rename, and safe merge workflows; see [Activity automation plan](activity-automation-plan.md).

## Success Criteria

- Import and review workflows function end-to-end on Windows desktop.
- Critical transaction content workflows remain local by default.
- Automated tests cover parser, categorization, import-to-ledger, and desktop critical journeys.
- Representative fixtures support deterministic regression testing.
- The app remains responsive with at least 10,000 transactions.

## Key Milestones

1. Planning and governance artifacts complete
2. Domain model and schema drafted
3. Import and categorization core working
4. Desktop shell and ledger workflows working
5. Budgeting, forecasting, backup, and export working
6. Release-quality testing and verification complete

## Risk Assessment

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Digital PDF variance across banks | High | Validate early with sanitized samples and bank-specific adapters |
| Native SQLite packaging friction | Medium | Lock guidance in ADR and validate packaging early on Windows |
| LLM contributor skimps on tests | High | Use CI guardrails, PR template, and issue-level AC-to-test mapping |
| Public repo accidental data leakage | High | Use sanitized fixtures, public-repo rules, and gitignored local-only paths |
| Forecast scope creep | Medium | Keep first release to simple forward projections only |
| Untrusted mortgage HTML or projected/actual confusion | High | Parse saved pages inertly, preserve unknowns and provenance, and keep bank projections separate from ledger and actual balances |

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
    F[Epic: Household net worth (#251)] --> F1[Feature: Manual asset/liability registry (#267)]
    F --> F2[Feature: Mortgage evidence and repayment scenarios (#264)]
    F2 --> F21[Story: Rogaland evidence import (#539)]
    F21 --> F211[Unit Test #541]
    F21 --> F212[Integration Test #543]
    F21 --> F213[Playwright Test #544]
    F --> F3[Feature: Net-worth forecast (#265)]
    F --> F4[Feature: Offline value refresh (#266)]
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
- Feature F3.4: Category catalog and user-managed categories (#585)
- Story S3.4.1: Create and rename categories (#587); Tests #589, #590, #591
- Story S3.4.2: Preview and safely merge categories (#588); Tests #592, #593, #594
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

### Epic: Household net worth (#251)

- F9.1 (#267) owns the manual asset and liability registry.
- F9.2 (#264) remains the owner of mortgage evidence and repayment scenarios. Its first bank-import slice is #539; later refresh, reconciliation, calculator, and reporting Stories retain their existing owners.
- #539 imports verified saved Rogaland HTML into an existing or explicitly incomplete loan. Tests #541, #543, and #544 own Unit, Integration, and Playwright verification respectively.
- Household forecast and monthly reporting consumers remain with their existing Feature/Story owners; mortgage import does not absorb those responsibilities.
- After the first tested import/preview path exists, benchmark synthetic three- and thirty-year inputs on Windows 11 Home/Pro 25H2 or newer with a compatible 64-bit two-core CPU and 4 GB RAM. Use measured elapsed time and peak memory to propose resource caps and performance targets; obtain owner approval before finalizing hard limits or making performance claims.

## Priority Guidance

- P0: Planning artifacts, schema direction, import pipeline, categorization review loop
- P1: Desktop ledger, dashboards, targets, simple forecast
- P1: Backup, export, no-network verification, release-quality automation
- P2: Niceties that improve usability but do not block first usable release
- Approved next Activity workstream: F3.4 category management, then offline
  merchant recognition, unknown-merchant learning, safe batch review, and
  recurring suggestions. Only F3.4 is materialized for this planning batch;
  later workstreams require their own concrete readiness checks.

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
- Public-repo handling rules are respected

## Sprint Planning Assumption

- 2-week sprints
- Protect 20 percent capacity for defects and integration surprises
- Keep parser and categorization work sliced narrowly enough for deterministic validation
