# Budget Planner Implementation Plan

## Objective

Deliver the first usable version of Budget Planner in a sequence that stabilizes domain, import, categorization, and privacy-critical workflows before broader UI polish. The approved E7 expansion adds non-destructive management of multiple local household ledgers after the single-ledger persistence and desktop workflows are stable.

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

- Implement import jobs and extensible parser adapters
- Implement standalone text and binary PDF extraction with multi-page row handling
- Implement CSV import and field mapping
- Implement cross-format import review, correction, and dismissal audit
- Implement manual entry and duplicate detection
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

### Phase 5: Local Household Ledger Management (E7)

- Record the accepted local-ledger registry, database-location, legacy-adoption, and active-runtime decisions in an ADR before implementation.
- Register the existing local database in place without rewriting or moving its records.
- Implement separate SQLite ledgers, active-ledger switching, and read/write/import isolation.
- Add distinct desktop workflows for creating and switching household ledgers and for starting fresh without removing the previous ledger.
- Keep backup and restore scoped to a clearly identified household ledger.

Exit criteria:

- Existing installations open their original household ledger after upgrade.
- A user can create and switch ledgers without cross-ledger reads or writes.
- “Start fresh” creates and activates a new ledger while keeping the previous ledger available and unchanged.
- Unit, integration, and Playwright coverage verifies adoption, isolation, recovery, restart persistence, and local-only behavior.

## Workstream Dependencies

| Workstream | Depends on | Blocks |
| --- | --- | --- |
| ADR and glossary | None | Schema, technical breakdown, consistent issue writing |
| Schema and repositories | ADR and glossary | Import, categorization, budget target persistence |
| Import pipeline | Schema | Import review, dashboard totals, export |
| Import review and correction | Import pipeline and row-state schema | Corrected ledger records and downstream categorization |
| Categorization engine | Schema and import pipeline | Review workflow, dashboard accuracy |
| Desktop shell and UI | Schema, import, categorization | End-to-end flows |
| Backup, export, privacy verification | Stable schema and shell | Release readiness |
| Household-ledger management (E7) | Stable SQLite persistence, backup/restore, Electron main-process lifecycle, and setup flow | Safe creation, selection, switching, and fresh-ledger workflows |
| Automated tests | Working slices in each prior workstream | Feature completion and merge readiness |

## Validation Plan

### Before Import Buildout

- Validate sanitized text, CSV, and binary PDF samples for multiple bank layouts
- Confirm multi-page PDFs, wrapped descriptions, malformed rows, and likely account mapping cases

### During Import And Categorization

- Add unit coverage for extraction, parser adapters, row classification, and rule logic
- Add integration coverage for import-to-ledger and review-state behavior
- Add regression tests for duplicate and correction behavior when bugs are fixed

### During UI Delivery

- Add Playwright coverage for file selection, import review, correction, dismissal, dashboard, forecast, export, and backup flows

### During Household Ledger Management

- Add unit coverage for profile validation, registry paths, and active-ledger state transitions.
- Add integration coverage for legacy adoption, two-database isolation, backup/restore identity, and failure recovery.
- Add Playwright coverage for create/switch and “Start fresh” as separate user workflows, including compact-window controls and an isolated Electron user-data directory on relaunch.
- Use synthetic household and transaction records only; verify the default flow makes no outbound network requests.

### Before Release Readiness

- Run no-network verification in development and packaged builds
- Run performance checks with at least 10,000 transactions and multiple accounts

## Test Framework Ownership

This repository uses two test frameworks with distinct, non-overlapping ownership.

### Vitest (unit, integration, and static artifact checks)

- **Scope**: pure logic, parsing, normalization, domain calculations, React component rendering (via `renderToStaticMarkup`), IPC contract behavior.
- **Entry points**: `tests/unit/`, `tests/integration/`, `tests/e2e/`, `tests/nonetwork/`.
- **Runs in**: Node process, no Electron binary required.  Safe to run with `ELECTRON_SKIP_BINARY_DOWNLOAD=1`.
- **Commands**: `npm run test:unit`, `npm run test:integration`, `npm run test:artifacts`, `npm run verify:no-network`.
- **Artifact lane**: `npm run test:artifacts` rebuilds main, preload, and renderer once before static inspection, even when outputs exist. `npm run test:e2e:vitest` is its compatibility alias, not native startup or IPC evidence.

### Playwright (Electron runtime smoke)

- **Scope**: desktop runtime flow validation — window boot, root render, preload bridge availability, critical household-ledger journeys, and CI failure artifact retention.
- **Entry points**: `tests/playwright/` (specs and POM modules).
- **Runs in**: launched Electron process via Playwright `_electron` API.  Requires a built app (`npm run build`) and the Electron binary.
- **Command**: `npm run test:e2e:playwright`.
- **POM convention**: use `tests/playwright/pom/` for reusable page-object abstractions; keep business assertions in specs.
- **Locator strategy**: prefer `getByRole` role-first locators; use `getByText` for unique prose; avoid CSS selectors.
- **Assertions**: use Playwright web-first assertions (`expect(locator).toBeVisible()`); never use fixed timeout sleeps.
- **Isolation**: use the shared Electron fixture to create a per-test database and isolated `--user-data-dir`; relaunches that verify persistence reuse both isolated paths and wait for the user-visible record selection before asserting compact-window details.
- **CI artifacts**: traces (`test-results/`) and HTML report (`playwright-report/`) are retained on failure.

### Decision rule

If a test can be written as a Vitest unit or integration test, write it there.  Only escalate to Playwright when the test requires an actual Electron launch, DOM rendering in a live window, or IPC wiring through the preload bridge.

## Required Scripts And CI Expectations

Once scaffolding exists, the repository must provide CI scripts for:

- `lint`
- `typecheck`
- `test:unit`
- `test:integration`
- `test:artifacts` (fresh-build static inspection)
- `test:e2e:vitest` (compatibility alias)
- `test:e2e:playwright` (when Playwright coverage is in issue scope)
- `verify:no-network`

## Risks And Mitigations

- PDF variability: mitigate with bank-specific parser adapters and sanitized fixtures.
- Native SQLite packaging: mitigate with explicit packaging documentation and early build validation on Windows.
- Legacy database adoption and path handling: retain the existing file in place, test configured paths explicitly, and fail visibly rather than selecting another ledger.
- Ledger-switch lifecycle: invalidate or finish work tied to the previous database before rebinding main-process services, and verify isolation across imports, backup, and restore.
- Restore identity mismatch: identify both the active household and snapshot household before replacement and block silent cross-ledger restore.
- LLM implementation drift: mitigate with acceptance-criteria-to-test mapping, PR guardrails, and issue-ready planning docs.
- Public repository exposure: mitigate with sanitized fixtures, repo-relative documentation, and gitignored local-only artifact paths.

## Immediate Next Actions

1. Complete the E7 ADR and household-ledger planning updates.
2. Link the E7 Feature, Stories, and layer-specific Test issues, then validate the issue hierarchy.
3. Begin implementation only after the ADR and issue plan are owner-approved and assignment prerequisites are satisfied.
