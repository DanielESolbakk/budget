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
- Format ledger amounts as NOK and accept amount-filter input in kroner with up to two decimal places, converting exactly to minor units for queries.
- Show result count, active filters, clear-all action, accessible per-filter removal, and explicit loading, empty, and error states.
- Keep merchant and date as immediately available filters; move less frequent filters into progressive disclosure.
- Show the number and identity of active account, category, and NOK range filters in the collapsed `More filters` label so their state remains recognizable when the controls are hidden; group the two bounds as `Amount range` in the summary.
- Give progressive filters a quieter, denser treatment than quick filters while retaining a minimum 44px interactive control height.
- Provide quick filters for Uncategorized, Income, Expenses, This month, and Large transactions; define Large transactions as an absolute amount of at least NOK 10,000, and resolve This month against the current local calendar month whenever a filter or saved view is applied.
- Accept inclusive amount ranges in NOK with up to two decimal places, converting exactly to integer minor units, and show a localized example beside the fields.
- Apply changed filter criteria automatically after 250 milliseconds without further input; keep the last successful rows visible and announce that the ledger is updating until the matching rows and count arrive together.
- Persist user-named filter views locally, allow applying and deleting them, and disable saving while filter results are pending; support views such as Needs a category and Large expenses.
- Keep saved views and maintenance actions visually secondary: show saved views behind a collapsed count disclosure, group Income/Expenses as one choice, reserve the action accent for selected quick filters and the primary task, and keep Clear all and pagination neutral.
- Sort account and category columns by their displayed labels, and visibly and programmatically expose the active sort field and direction.
- Keep account choices and display labels available independently of matching ledger rows, including when the ledger is empty.
- Add SQLite-backed filtering, sorting, total counts, and bounded pagination before presenting 10,000 or more transactions; query only uncategorized rows for the review queue.
- Surface the categorization queue as an attention view with remaining count, current progress, oldest-booking-first order with stable transaction-ID tie-breaking, and predictable focus movement after a save.
- Provide a `Review uncategorized` action from the ledger summary that shows the queue count and moves focus to the first pending category control.
- Add a clear explanation when a correction creates or updates future categorization behavior.

Acceptance criteria:

- [x] A user can scan ledger rows by date, merchant, amount, category, and account without parsing concatenated text.
- [x] Applied filters are visible and removable individually or together.
- [x] Ledger filtering, sorting, and page changes use SQLite-backed bounded queries with a separate total count; the renderer receives and transforms only the requested page, and review loading queries only uncategorized transactions.
- [x] The Electron transaction workspace remains responsive with a synthetic 10,000-transaction data set while sorting and changing pages.
- [x] The review queue communicates the remaining workload and moves focus to the next relevant item after a successful correction.
- [x] Correction feedback states whether future matching behavior changed.
- [x] The amount filter accepts valid NOK values with up to two decimal places, converts them exactly to minor units, and displays active amounts in NOK.
- [x] Quick filters for Uncategorized, Income, Expenses, This month, and Large transactions compose with other criteria and can be toggled off; Large transactions means absolute amount greater than or equal to NOK 10,000.
- [x] This month resolves to the current local calendar month each time it is applied, including when loaded from a saved view.
- [x] The amount range accepts inclusive minimum and maximum NOK values with at most two decimal places, converts them exactly to minor units, and rejects malformed values or a minimum greater than the maximum while preserving the last successful results and associating the error with both fields.
- [x] Changing any filter automatically applies the complete criteria after 250 milliseconds without further input; result count, active chips, and table rows represent the same query, and no Apply filters action is exposed.
- [x] While a debounced query is pending, the last successful rows remain visible with an updating status; on failure, those rows remain visible and a retry action is available.
- [x] Users can save a named, fully applied filter view locally, apply it after restarting the application, and delete it; saving is unavailable while results are pending, and saved views preserve semantic quick filters and amount ranges rather than a stale page of results.
- [x] Saved-view management is collapsed by default with its saved-view count visible; its controls appear only when the user opens the disclosure.
- [x] The collapsed `More filters` label reports the count and identity of active account, category, and amount-range criteria; it groups minimum/maximum under `Amount range` and preserves the summary while the controls are hidden.
- [x] The NOK amount controls show an example accepted value such as `100,50` beside their persistent labels.
- [x] Expanded account, category, and amount controls are visually subordinate to quick filters and retain at least 44px interactive height.
- [x] Income and Expenses are visually grouped as one choice; only selected quick filters use the action accent, while Clear all and pagination are secondary controls.
- [x] At a 390-by-844 content viewport, the Transactions workspace stacks navigation and filter controls without horizontal page overflow or clipped filter labels.
- [x] Account and category sorts follow the displayed labels, and the active sort field and direction are visible and exposed to assistive technology.
- [x] Account choices and human-readable account labels remain available when no transactions match or the ledger is empty.
- [x] Every active-filter removal control has an accessible name based on its user-facing filter label rather than an internal field identifier.
- [x] Review queue order is oldest booked transaction first, with transaction ID as a deterministic tie-breaker.
- [x] When uncategorized transactions exist, the ledger summary offers a `Review uncategorized` action with the pending count that moves focus to the first pending category control.

Dependencies:

- SQLite query contracts and indexes for total count, sorting, pagination, uncategorized review, and account display metadata.
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
- Proposed stories: application shell navigation; review-home hierarchy; ledger table and filters; categorization attention queue; same-merchant correction propagation with preview and undo; guided CSV/PDF import; data-safety workspace; shared interaction-state hardening.
- Proposed enablers: paged ledger query contract; account and category display-label contract; reusable renderer primitives where repeated behavior justifies them.
- Proposed test issues: navigation and compact-window coverage; ledger scale and keyboard coverage; same-merchant propagation unit, integration, and Playwright runtime coverage; import-state coverage; restore safety and recovery coverage; visual regression baselines.

Any catalog changes must derive parent relationships from `docs/ways-of-work/plan/budget-planner/issue-catalog.json` and follow the repository's planning issue templates.

## Test Strategy

### Unit

- Pure view-model transformations for exception summaries and destination-state decisions, NOK-to-minor-unit filter conversion, display-label sorting, filter chips, pagination state, and review queue ordering.
- Quick-filter composition, dynamic current-month resolution, inclusive amount ranges, NOK parsing, pending-filter debounce state, and saved-view validation.
- No unit tests for static styling or implementation details.

### Integration

- SQLite-backed paged and sorted ledger queries, total counts, account metadata for empty results, and targeted uncategorized queue ordering.
- Local SQLite saved-view create/list/delete persistence and query counts for combined draft criteria.
- Navigation view-state preservation for selected month, ledger filters, and unsaved form input across destination changes; submitted operations retain an observable completion or error outcome.
- Destination data-state contracts distinguish pending, empty, stale, and failed results without allowing a Review load failure to gate unrelated destinations.
- Import stage transitions, validation summaries, and post-import next actions.
- Restore confirmation input and snapshot metadata boundaries.
- Same-merchant propagation updates only explicitly selected existing uncategorized matches; undo restores only those propagated rows and preserves the original correction and future rule.

### Playwright

- Critical navigation and monthly-review journey through the Electron runtime, including current-location semantics and returning to a destination with local work in progress.
- Transaction table cell labels and sort order, visible sort direction, NOK amount filtering, accessible filter removal and clear-all, empty-ledger account choices, and the direct uncategorized review action.
- Quick-filter composition and removal, debounced result updates without an Apply action, amount-range validation and error associations, and saved-view create/apply/delete across an Electron restart.
- Saved-view collapsed/expanded state, quick-filter active/inactive hierarchy, and compact-width ledger overflow.
- The transaction workspace with a synthetic 10,000-transaction dataset, including sorting and page changes.
- Keyboard traversal across destinations, month selection, exception actions, and main content; verify focus remains predictable after destination changes.
- Compact 390 by 844 and desktop 1280 by 800 visual checks for navigation, review hierarchy, and first-viewport content.
- Initial Review-load, destination-data-load, month-change, and stale-refresh failures, including recovery while another destination is active.
- Review target-form disclosure and exception actions whose labels match the destination queue scope.
- Same-merchant propagation preview, selection, cancel, confirmation, success, and undo.
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
- Mixed-merchant batch categorization. Same-merchant correction propagation remains in its separately groomed story until preview, selection, confirmation, and undo behavior are specified.

## Exit Criteria

- The four task destinations are implemented with preserved local-first behavior.
- The selected month's financial status and actionable exceptions are visible in the desktop first viewport.
- Ledger, import, categorization, and recovery workflows meet their slice acceptance criteria.
- Automated coverage exists at the appropriate unit, integration, and Playwright layers.
- Desktop and compact-window visual baselines are reviewed, accessibility checks pass, and no-network verification remains green.
