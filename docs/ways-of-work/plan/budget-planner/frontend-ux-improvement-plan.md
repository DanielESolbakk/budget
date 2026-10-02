# Frontend UX Improvement Plan

## Decision

Improve the existing Windows-first desktop experience without replacing its dark, high-contrast visual identity. Reorganize the renderer around focused tasks so the monthly review is faster to understand and import, correction, and recovery work no longer compete with it in one long page.

This is an Operate-mode product surface. Familiar controls, scanability, clear state, and efficient repeated use take priority over decorative expression.

## Job And Audience

- Audience: one household user reviewing multiple local accounts in a desktop application.
- Primary job: understand the selected month's financial position, identify exceptions, and move directly to the transactions that need action.
- Secondary jobs: import transactions, correct categories, set budget targets, forecast, back up, restore, and export local data.
- Success: the user can answer "What changed this month, what needs attention, and what should I do next?" without scrolling through unrelated workflows.

## Initial Baseline Evidence

- `src/renderer/App.tsx` places monthly review, ledger search, targets, imports, categorization, backup, export, and restore in one document.
- The selected month appears in both a select control and a horizontally scrolling month rail, consuming attention without adding a second distinct capability.
- The desktop visual baseline in `tests/playwright/dashboard-renderer-smoke.spec.ts-snapshots/dashboard-desktop.png` gives substantial first-viewport space to introductory copy and month navigation instead of financial status and exceptions.
- The compact baseline in `tests/playwright/dashboard-renderer-smoke.spec.ts-snapshots/dashboard-mobile.png` places most financial information below the first viewport.
- `src/renderer/dashboard/LedgerSection.tsx` exposes useful filters but renders results as concatenated list text rather than a scannable ledger.
- `src/renderer/import/CsvImportSection.tsx` contains a multi-stage preview, mapping, validation, and confirmation workflow without persistent stage orientation or a clear disabled-action explanation.
- `src/renderer/import/CategoryReviewSection.tsx` supports correction one transaction at a time but does not show queue progress or optimize repeated review.
- Recovery actions use related but inconsistent browse-and-confirm interaction patterns.

## Direction

### Structural Thesis

Use a task-based application shell with four stable destinations:

1. **Review**: monthly totals, exceptions, targets, category context, and forecast.
2. **Transactions**: searchable ledger plus the categorization review queue.
3. **Import**: manual entry and guided CSV or PDF import.
4. **Data safety**: backup snapshot, restore, and export.

Desktop uses persistent navigation so every destination is one action away. Compact windows use a space-efficient equivalent that preserves destination labels and current-location state. Navigation state must not alter domain or persistence behavior. Switching destinations must not silently discard unsaved or pending work: preserve in-memory view state for the current session, or explain the discard and obtain confirmation before navigating away. Completion and error feedback for submitted operations must remain available after returning.

### Monthly Review Thesis

- Keep one month selector in a stable review toolbar; remove the duplicate month rail.
- Put income, expenses, and net first, followed immediately by actionable exceptions such as uncategorized transactions and categories over target. Exception wording and its destination must agree about whether the work is month-scoped or queue-wide.
- Treat category and forecast sections as supporting analysis, not equal-priority panels.
- Keep target creation near target-versus-actual results, but keep the form collapsed until the user chooses to add or edit a target.
- Preserve the current restrained dark palette, orange action accent, strong focus treatment, and tabular numeric formatting.

### Boundaries

- Keep renderer components focused on presentation and interaction; filtering, sorting, pagination, import, categorization, and persistence rules remain in application or domain services.
- Keep all transaction content on-device and add no telemetry, analytics, cloud sync, or background network access.
- Preserve existing import and recovery behavior while changing presentation and navigation.
- Design for the supported Windows desktop window first and retain a usable compact-window layout.
- Do not introduce a new brand, theme switcher, decorative animation, gamification, or dashboard chart library in this roadmap.

## Priority Roadmap

### Slice 1: Focused App Shell And Review Home

Value: High

Deliver the largest reduction in cognitive load before refining individual workflows.

Verified baseline (2026-10-02): the four destinations, current-location semantics, single month selector, exception actions, first-viewport visibility at 1280 by 800, keyboard traversal, and last-valid-review behavior on month-change and refresh failures are present. Keep these behaviors intact while completing the remaining scope below.

Scope:

- Introduce the four-destination application shell and visible current-location state.
- Extract Review, Transactions, Import, and Data safety composition into focused view components. Keep `App` responsible for shell coordination and keep business rules in application or domain modules.
- Replace duplicate month controls with one review toolbar selector.
- Recompose Review with income, expenses, and net first, followed by exception actions; keep category and forecast analysis secondary. Fit the totals and exceptions in the first viewport at a 1280 by 800 content area.
- Keep target creation beside target-versus-actual results, but disclose its form only after an add or edit action.
- Add actionable summaries for uncategorized transactions and categories over target. Keep each summary's wording, scope, and destination aligned; do not imply that an all-month queue is filtered to the selected month.
- Define applicable loading, empty, refreshing, and error states for each destination and asynchronous data region. Never present an unresolved request as an empty result, preserve the last valid content during refresh, and provide a recovery action after failure.
- Keep Review data-load failures from blocking access to Transactions, Import, or Data safety.
- Preserve unsaved view-local input and in-flight operation outcomes when users change destinations, or warn and confirm before discarding work.
- Mount non-Review destinations on first visit, then retain their view state for the session so unused queries do not run during startup.
- Establish shared navigation, toolbar, status, action-group, form-field, and data-region conventions. Extract a component only when the same behavior is used by at least two delivered workflows; keep one-off layout local.
- Preserve existing ledger query, import, categorization, and recovery behavior. Do not pull Slice 2 pagination/table work, Slice 3 import-stage redesign, or Slice 4 recovery redesign into this slice.

Acceptance criteria:

- [x] Review, Transactions, Import, and Data safety are each reachable in one navigation action.
- [x] The current destination is conveyed visually and programmatically.
- [x] Only one month-selection control is exposed in Review.
- [x] Monthly income, expenses, net, and the presence or absence of actionable exceptions are visible without vertical scrolling at 1280 by 800.
- [x] Keyboard users can traverse navigation, month selection, summary actions, and main content in a predictable order.
- [x] Refresh and month-change failures keep the last valid data visible and explain the available recovery action.
- [x] `App` composes focused destination views, and destination changes do not silently discard unsaved input or hide the outcome of a submitted operation.
- [x] Review displays income, expenses, and net before exceptions; category and forecast content remain secondary; target entry is collapsed until requested.
- [x] Each asynchronous destination region distinguishes pending, completed-empty, ready, refreshing, and failed states where applicable. A failed refresh preserves the last valid content and offers recovery; an initial Review failure does not block the other destinations.
- [x] Exception wording and navigation disclose queue scope: a selected-month uncategorized summary either opens a month-filtered queue or clearly identifies that the destination queue spans months.
- [x] At 390 by 844, all destination labels and current-location state remain perceivable without horizontal page overflow.
- [x] Shared interaction conventions are consistent across delivered destinations, and any extracted shared component has at least two real consumers.

Dependencies:

- Existing dashboard, ledger, and categorization query contracts.
- A lightweight renderer view-state decision; a routing dependency is unnecessary unless deep linking becomes an accepted requirement.
- No new query contract is required to clarify that the categorization queue spans months. If the product instead requires month-filtered queue results, defer that query change to Slice 2 and record it as a dependency.

### Slice 2: Transaction Workspace And Attention Queue

Value: High

Turn the ledger and categorization queue into an efficient repeated-use workspace.

Scope:

- Replace the ledger result list with a semantic data table containing date, merchant, amount, category, and account.
- Format amounts as NOK and show human-readable category and account labels where contracts provide them.
- Show result count, active filters, clear-all action, and explicit loading, empty, and error states.
- Keep merchant and date as immediately available filters; move less frequent filters into progressive disclosure.
- Add service-backed sorting and bounded pagination or virtualization before presenting 10,000 or more transactions.
- Surface the categorization queue as an attention view with remaining count, current progress, and predictable focus movement after a save.
- Add a clear explanation when a correction creates or updates future categorization behavior.
- Consider batch categorization only after a safe preview, mixed-selection handling, and undo or confirmation behavior are specified.

Acceptance criteria:

- [ ] A user can scan ledger rows by date, merchant, amount, category, and account without parsing concatenated text.
- [ ] Applied filters are visible and removable individually or together.
- [ ] Sorting and page changes do not load or transform the full ledger in the renderer.
- [ ] The transaction workspace remains responsive with a synthetic 10,000-transaction data set.
- [ ] The review queue communicates the remaining workload and moves focus to the next relevant item after a successful correction.
- [ ] Correction feedback states whether future matching behavior changed.

Dependencies:

- Query contracts for total count, sorting, pagination, and display labels.
- Existing deterministic categorization-rule persistence and provenance.

### Slice 3: Guided Import Workspace

Value: High

Make import state and safe commitment obvious across formats.

Scope:

- Start with a format choice: CSV, digital PDF, or manual transaction.
- Use native file selection as the primary CSV and PDF action; keep direct path entry only where it supports advanced or test workflows.
- Present CSV import as select file, map and validate, review, then confirm.
- Present PDF import with the same stage vocabulary where the underlying behavior matches.
- Keep preview rows, duplicates, invalid rows, and rows ready to import visibly distinct.
- Explain why confirmation is unavailable and link the reason to the field or row that needs attention.
- End successful imports with a concise result summary and direct actions to review uncategorized transactions or return to the ledger.
- Keep manual entry focused and separate from batch-file mapping controls.

Acceptance criteria:

- [ ] The current import stage, completed stages, and next valid action are always clear.
- [ ] No transaction is persisted before explicit confirmation.
- [ ] Disabled confirmation has a visible, accessible reason.
- [ ] Validation identifies affected rows and preserves valid preview context.
- [ ] Success reports imported and skipped duplicate counts and offers the next relevant action.
- [ ] CSV and PDF share interaction vocabulary without hiding format-specific validation.

Dependencies:

- Existing preview identifiers, duplicate reporting, and source-aware parser adapters.
- File-dialog IPC support for CSV and PDF selection if not already shared.

### Slice 4: Data Safety And Interface Hardening

Value: Medium

Standardize high-consequence actions and finish the shared interaction system.

Scope:

- Give backup snapshot, export, and restore a consistent choose-destination or choose-source pattern followed by an explicit action.
- Show backup recency and enough snapshot metadata to distinguish restore choices.
- Require a consequence summary and confirmation before restore; preserve a clear cancellation path.
- Standardize button hierarchy, field help, pending behavior, success feedback, errors, and focus return across all destinations.
- Replace display-style typography in compact controls and labels with the product's workhorse UI type while retaining Barlow Condensed for limited section emphasis.
- Define and verify default, hover, focus, active, disabled, loading, success, warning, and error states for shared controls.
- Validate structural behavior at compact, 1280, 1440, and wide desktop window sizes without fluid type scaling.

Acceptance criteria:

- [ ] Backup, export, and restore use consistent labels, action hierarchy, pending behavior, and completion feedback.
- [ ] Restore identifies the selected snapshot and consequences before data changes.
- [ ] Shared controls expose complete keyboard and semantic states with no color-only status communication.
- [ ] No supported window size causes clipped controls, overlapping text, or inaccessible table content.
- [ ] Reduced-motion preferences remove nonessential transitions while preserving state feedback.

Dependencies:

- Snapshot metadata contract and restore safety behavior.
- Shared renderer component patterns established in Slice 1.

## Issue Decomposition

Create or update planning issues only after this direction is accepted. Keep implementation and test work separate.

- Epic alignment: E4 Dashboard, budgeting, and forecasting; E2 Transaction ingestion and normalization; E3 Categorization and correction workflow; E5 Privacy, backup, export, and release quality.
- Proposed feature scope: desktop information architecture and monthly review workspace.
- Proposed stories: application shell navigation; review-home hierarchy; ledger table and filters; categorization attention queue; guided CSV/PDF import; data-safety workspace; shared interaction-state hardening.
- Proposed enablers: paged ledger query contract; account and category display-label contract; reusable renderer primitives where repeated behavior justifies them.
- Proposed test issues: navigation and compact-window coverage; ledger scale and keyboard coverage; import-state coverage; restore safety and recovery coverage; visual regression baselines.

Any catalog changes must derive parent relationships from `docs/ways-of-work/plan/budget-planner/issue-catalog.json` and follow the repository's planning issue templates.

## Test Strategy

### Unit

- Pure view-model transformations for exception summaries and destination-state decisions, plus filter chips, pagination state, and import-stage derivation.
- No unit tests for static styling or implementation details.

### Integration

- Paged and sorted ledger query contracts, total counts, and display labels.
- Navigation view-state preservation for selected month, ledger filters, and unsaved form input across destination changes; submitted operations retain an observable completion or error outcome.
- Destination data-state contracts distinguish pending, empty, stale, and failed results without allowing a Review load failure to gate unrelated destinations.
- Import stage transitions, validation summaries, and post-import next actions.
- Restore confirmation input and snapshot metadata boundaries.

### Playwright

- Critical navigation and monthly-review journey through the Electron runtime, including current-location semantics and returning to a destination with local work in progress.
- Keyboard traversal across destinations, month selection, exception actions, and main content; verify focus remains predictable after destination changes.
- Compact 390 by 844 and desktop 1280 by 800 visual checks for navigation, review hierarchy, and first-viewport content.
- Initial Review-load, destination-data-load, month-change, and stale-refresh failures, including recovery while another destination is active.
- Review target-form disclosure and exception actions whose labels match the destination queue scope.
- CSV/PDF preview-to-confirm workflows, including disabled reasons and validation recovery.
- Backup, export, and restore cancellation, confirmation, success, and error paths.

## Validation Commands

- `npm run lint`
- `npm run typecheck`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e:playwright`
- `npm run verify:no-network`
- `npx impeccable check`

For each implementation slice, also run the narrowest affected Playwright specs before the complete runtime suite. Use the synthetic 10,000-transaction fixture or an equivalent generated fixture for ledger performance validation; never use local financial data.

## Risks And Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Navigation restructure breaks existing workflows or test locators | High | Preserve section semantics during extraction, migrate one destination at a time, and update page objects with each slice |
| Destination changes unmount child views and discard drafts, filters, or operation feedback | High | Preserve session-local view state or confirm before discarding; verify pending and completed operations remain understandable after returning |
| A Review startup failure blocks otherwise usable destinations | High | Keep shell navigation available and isolate Review loading/error state from Transactions, Import, and Data safety |
| A month-specific exception opens an all-month queue without making the scope clear | Medium | Align summary copy and destination scope; defer query-contract changes to Slice 2 if month filtering is required |
| Review summary duplicates business logic in React | High | Add application-layer view contracts for exceptions and labels; keep renderer derivation presentational |
| Ledger table attempts to render all local transactions | High | Require bounded service queries before the table is considered complete |
| Compact layout becomes a shrunken desktop layout | Medium | Define structural collapse behavior and validate at 390, 680, and 1024 pixel widths |
| Shared components become a premature design-system rewrite | Medium | Extract only behavior and patterns used by at least two delivered workflows |
| Visual refresh displaces import and correction reliability | Medium | Preserve domain contracts and stage the plan around complete workflows, not cosmetic batches |

## Out Of Scope

- Cloud sync, bank APIs, telemetry, analytics, and remote transaction processing.
- Scanned-document OCR or local ML categorization.
- New budgeting or forecast calculations.
- Multi-user, multi-device, or mobile-native product support.
- Theme switching, extensive animation, gamification, decorative dashboard charts, and visual changes without a workflow benefit.
- Batch categorization until safe preview and reversal behavior are planned.

## Exit Criteria

- The four task destinations are implemented with preserved local-first behavior.
- The selected month's financial status and actionable exceptions are visible in the desktop first viewport.
- Ledger, import, categorization, and recovery workflows meet their slice acceptance criteria.
- Automated coverage exists at the appropriate unit, integration, and Playwright layers.
- Desktop and compact-window visual baselines are reviewed, accessibility checks pass, and no-network verification remains green.
