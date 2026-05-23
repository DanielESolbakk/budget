# Budget Planner Issues Checklist

## Pre-Creation Checklist

- [ ] PRD exists and is current
- [ ] Technical breakdown exists and is current
- [ ] Implementation plan exists and is current
- [ ] Project plan exists and is current
- [ ] Issue catalog exists and is current
- [ ] Acceptance criteria and test strategy are mapped
- [ ] ADR and glossary work is identified or completed
- [ ] Use GitHub Issue Forms in `.github/ISSUE_TEMPLATE/` for Epic, Feature, Story, Enabler, and Test issues
- [ ] Derive initial issue hierarchy from `docs/ways-of-work/plan/budget-planner/issue-catalog.json` instead of inventing parent links manually
- [ ] Keep created planning issues aligned with the issue catalog as issue numbers are assigned

## Epic Creation Checklist

- [ ] Create epic issue: Foundations and LLM delivery scaffolding
- [ ] Create epic issue: Transaction ingestion and normalization
- [ ] Create epic issue: Categorization and correction workflow
- [ ] Create epic issue: Dashboard, budgeting, and forecasting
- [ ] Create epic issue: Privacy, backup, export, and release quality
- [ ] Set priority and value tier in the epic issue form
- [ ] Apply priority and value labels if repository label automation or conventions require them
- [ ] Add each epic to the project board

## Feature And Enabler Checklist

### Foundations and LLM delivery scaffolding

- [ ] Feature: Planning and governance artifacts
- [ ] Feature: ADR and glossary
- [ ] Enabler: CI, PR template, and ruleset maintenance
- [ ] Test: Governance validation and documentation checks

### Transaction ingestion and normalization

- [ ] Feature: Digital text PDF import
- [ ] Feature: CSV import and field mapping
- [ ] Feature: Manual entry and duplicate detection
- [ ] Enabler: Import job schema and parser adapter framework
- [ ] Test: Sanitized fixture coverage for PDF and CSV import

### Categorization and correction workflow

- [ ] Feature: Merchant normalization
- [ ] Feature: Rule evaluation and confidence scoring
- [ ] Feature: Review queue and correction workflow
- [ ] Enabler: Categorization rule persistence and provenance
- [ ] Test: Merchant fixture and regression coverage

### Dashboard, budgeting, and forecasting

- [ ] Feature: Monthly dashboard
- [ ] Feature: Monthly category targets
- [ ] Feature: Simple forward forecast
- [ ] Enabler: Aggregation and forecast query layer
- [ ] Test: Dashboard and forecast end-to-end coverage

### Privacy, backup, export, and release quality

- [ ] Feature: Backup and restore
- [ ] Feature: CSV export
- [ ] Feature: No-network verification
- [ ] Enabler: Performance harness and packaging validation
- [ ] Test: Backup/export, no-network, and performance coverage

## Story Creation Checklist

- [ ] Each story uses the household and transaction domain language
- [ ] Each story has explicit acceptance criteria
- [ ] Each story links to required enablers and tests
- [ ] Each story has a clear user outcome and independent value
- [ ] Each story is small enough to validate in one focused PR when possible

## Test Issue Checklist

- [ ] Each test issue declares whether it is story/enabler, feature, or epic-wide/cross-cutting scope
- [ ] Cross-cutting test issues anchor to a parent epic and explain related planning items
- [ ] Parser fixture issue covers sanitized digital text PDFs
- [ ] CSV fixture issue covers encoding, delimiter, and field mapping cases
- [ ] Categorization fixture issue covers common Norwegian merchants
- [ ] End-to-end test issue covers import, review, correction, dashboard, forecast, export, and backup flows
- [ ] No-network verification issue covers development and packaged builds
- [ ] Performance issue covers at least 10,000 transactions and multiple accounts

## Pull Request Readiness Checklist

- [ ] PR body contains acceptance-criteria-to-test mapping
- [ ] PR body contains test evidence
- [ ] Bug-fix PRs contain regression test details
- [ ] Code changes include package manifest and required CI scripts once scaffolding begins
- [ ] Public repository handling rules are respected

## Follow-Up Tracking Checklist

- [ ] Missing tests are tracked with linked follow-up issues if work cannot be completed immediately
- [ ] Architecture or schema changes update planning docs in the same change
- [ ] Privacy-sensitive local samples remain outside version control in ignored directories
