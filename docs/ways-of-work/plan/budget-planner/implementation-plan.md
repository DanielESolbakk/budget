# Budget Planner Implementation Plan

## Objective

Deliver the first usable version of Budget Planner in a sequence that stabilizes domain, import, categorization, and privacy-critical workflows before broader UI polish.

## Phase Sequence

### Phase 1: Foundations

- Create the feature PRD
- Create the technical breakdown
- Create the project plan and issues checklist
- Create the architecture decision record for the locked stack
- Create the domain glossary
- Define the initial schema and repository contracts

Exit criteria:

- Planning artifacts exist and align with repository instructions
- Domain vocabulary is stable enough for implementation naming
- Schema direction is documented well enough to start imports

### Phase 2: Import And Categorization Core

- Implement import jobs and parser adapters
- Implement digital text PDF import spike and validate samples
- Implement CSV import and manual entry
- Implement duplicate detection
- Implement merchant normalization and deterministic categorization
- Implement review queue and correction workflow

Exit criteria:

- A user can import data and review low-confidence results
- Import provenance and duplicate handling are working
- Corrections feed future categorization behavior

### Phase 3: Desktop User Workflows

- Build Electron shell and IPC boundaries
- Build React onboarding, import, ledger, review, dashboard, budget, and forecast views
- Add search and filters
- Add monthly targets and simple forecast surfaces

Exit criteria:

- Critical user flows work end-to-end through the desktop shell
- Renderer remains thin and business logic stays outside UI components

### Phase 4: Privacy, Quality, And Release Readiness

- Add backup and export flows
- Add no-network verification
- Add representative fixtures
- Add unit, integration, and end-to-end coverage
- Add performance checks for 10,000 transactions and multiple accounts

Exit criteria:

- Privacy and backup/export workflows are verified
- Required automated coverage exists for risk-bearing behavior
- Performance is acceptable for expected local usage

## Workstream Dependencies

| Workstream | Depends on | Blocks |
| --- | --- | --- |
| ADR and glossary | None | Schema, technical breakdown, consistent issue writing |
| Schema and repositories | ADR and glossary | Import, categorization, budget target persistence |
| Import pipeline | Schema | Review queue, dashboard totals, export |
| Categorization engine | Schema and import pipeline | Review workflow, dashboard accuracy |
| Desktop shell and UI | Schema, import, categorization | End-to-end flows |
| Backup, export, privacy verification | Stable schema and shell | Release readiness |
| Automated tests | Working slices in each prior workstream | Feature completion and merge readiness |

## Validation Plan

### Before Import Buildout

- Validate sanitized digital text PDF samples
- Confirm CSV variants and likely account mapping cases

### During Import And Categorization

- Add unit coverage for parsers and rule logic
- Add integration coverage for import-to-ledger behavior
- Add regression tests for duplicate and correction behavior when bugs are fixed

### During UI Delivery

- Add Playwright coverage for import, review, dashboard, forecast, export, and backup flows

### Before Release Readiness

- Run no-network verification in development and packaged builds
- Run performance checks with at least 10,000 transactions and multiple accounts

## Required Scripts And CI Expectations

Once scaffolding exists, the repository must provide CI scripts for:

- `lint`
- `typecheck`
- `test:unit`
- `test:integration`
- `test:e2e`
- `verify:no-network`

## Risks And Mitigations

- PDF variability: mitigate with bank-specific parser adapters and sanitized fixtures.
- Native SQLite packaging: mitigate with explicit packaging documentation and early build validation on Windows.
- LLM implementation drift: mitigate with acceptance-criteria-to-test mapping, PR guardrails, and issue-ready planning docs.
- Public repository exposure: mitigate with sanitized fixtures, repo-relative documentation, and gitignored local-only artifact paths.

## Immediate Next Actions

1. Create ADR and glossary artifacts.
2. Create the GitHub issue breakdown from these docs.
3. Scaffold the initial Electron and TypeScript workspace once the issue plan is accepted.
