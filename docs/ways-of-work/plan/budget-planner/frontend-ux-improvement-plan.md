# Frontend UX Improvement Plan

## Decision

Improve the existing Windows-first desktop experience without replacing its dark, high-contrast visual identity. Reorganize the renderer around focused tasks so the monthly review is faster to understand and import, correction, and recovery work no longer compete with it in one long page.

This is an Operate-mode product surface. Familiar controls, scanability, clear state, and efficient repeated use take priority over decorative expression.

## Job And Audience

- Audience: one household user reviewing multiple local accounts in a desktop application.
- Primary job: understand the selected month's financial position, identify exceptions, and move directly to the transactions that need action.
- Secondary jobs: import transactions, correct categories, set budget targets, forecast, back up, restore, and export local data.
- Success: the user can answer "What changed this month, what needs attention, and what should I do next?" without scrolling through unrelated workflows.

## Evidence From The Current Surface

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

Desktop uses persistent navigation so every destination is one action away. Compact windows use a space-efficient equivalent that preserves destination labels and current-location state. Navigation state must not alter domain or persistence behavior.

### Monthly Review Thesis

- Keep one month selector in a stable review toolbar; remove the duplicate month rail.
- Put income, expenses, and net first, followed immediately by actionable exceptions such as uncategorized transactions and categories over target.
- Treat category and forecast sections as supporting analysis, not equal-priority panels.
- Keep target creation near target-versus-actual results, but disclose the form only when the user chooses to add or edit a target.
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

Scope:

- Introduce the four-destination application shell and visible current-location state.
- Split the current `App` composition into focused view components without moving business rules into the renderer.
- Replace duplicate month controls with one review toolbar selector.
- Recompose the Review destination so monthly totals and exceptions fit in the first viewport at a 1280 by 800 content area.
- Add actionable exception summaries for uncategorized transactions and categories over target; each summary opens the relevant destination or filtered context.
- Add destination-level loading, empty, stale-refresh, and error states that preserve the last valid review when possible.
- Establish reusable navigation, toolbar, status banner, action group, form field, and data-region patterns before later slices use them.

Acceptance criteria:

- [x] Review, Transactions, Import, and Data safety are each reachable in one navigation action.
- [x] The current destination is conveyed visually and programmatically.
- [x] Only one month-selection control is exposed in Review.
- [x] Monthly income, expenses, net, and the presence or absence of actionable exceptions are visible without vertical scrolling at 1280 by 800.
- [x] Keyboard users can traverse navigation, month selection, summary actions, and main content in a predictable order.
- [x] Refresh and month-change failures keep the last valid data visible and explain the available recovery action.

Dependencies:

- Existing dashboard, ledger, and categorization query contracts.
- A lightweight renderer view-state decision; a routing dependency is unnecessary unless deep linking becomes an accepted requirement.

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

- Pure view-model transformations for exception summaries, filter chips, pagination state, and import-stage derivation.
- No unit tests for static styling or implementation details.

### Integration

- Paged and sorted ledger query contracts, total counts, and display labels.
- Navigation view-state preservation where user-entered state must survive destination changes.
- Import stage transitions, validation summaries, and post-import next actions.
- Restore confirmation input and snapshot metadata boundaries.

### Playwright

- Critical navigation and monthly-review journey through the Electron runtime.
- Keyboard traversal and focus movement across destinations, filters, import stages, and category correction.
- Compact-window and desktop visual baselines for the app shell and Review destination.
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
