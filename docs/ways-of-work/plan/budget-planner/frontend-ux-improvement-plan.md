# Pre-Launch UI/UX Improvement Plan

## Decision

Prioritize the improvements that make a first-time household user's path from setup to a trustworthy monthly review clear, safe, and usable before launch. A full information-architecture or visual overhaul is allowed; the current design is evidence to evaluate, not a constraint or a mandate to redesign.

This is an Operate-mode product surface. Task completion, financial-data confidence, clear state, accessibility, and scanability take priority over decoration.

## Job And Audience

- Audience: one household user setting up and reviewing multiple local accounts in a Windows-first desktop application.
- Primary job: get real household data into the app safely, understand the relevant month's position, identify exceptions, and move directly to the transactions that need action.
- Secondary jobs: import transactions, correct categories, set budget targets, forecast, back up, restore, and export local data.
- Success: the user can answer "What changed this month, what needs attention, and what should I do next?" without scrolling through unrelated workflows.

## Current Baseline Evidence

- `src/renderer/App.tsx` already provides four focused destinations: Review, Transactions, Import, and Data safety. The old one-long-page diagnosis is no longer accurate.
- `electron/main.ts` initializes a sample household, account, and transactions. The renderer's manual-entry and import-history flows still refer to `sample-hh`; `src/renderer/preload.ts` exposes account listing but no household or account creation flow. First-run setup and an honest no-data state are not present.
- `src/renderer/App.tsx` defaults the review to `2026-05`, and `src/renderer/import/ManualEntrySection.tsx` defaults the booking date to `2026-05-23`. Both are fixture-era dates, not live defaults.
- The desktop screenshot baseline shows a readable monthly summary, attention row, and supporting analysis. It does not by itself justify replacing the current visual identity.
- The 390px screenshot keeps the main totals readable, but the target-versus-actual table extends beyond the visible width. Compact-window access to tabular financial data needs a deliberate launch decision.
- Import already has format selection, staged CSV/PDF flows, validation, duplicate decisions, and success actions. Improve the first-use handoff and validate the complete task rather than rebuilding these workflows without evidence.
- Data safety already groups backup, export, and restore. Launch validation must establish that a new user can understand local storage and recover data before relying on the app.

## Launch Benefit Scale

- **UI benefit (1-5):** 1 is barely noticeable; 3 materially improves hierarchy, legibility, or state visibility; 5 transforms how clearly the product communicates its job.
- **UX benefit (1-5):** 1 removes minor friction; 3 makes a repeated task meaningfully easier; 5 prevents a likely first-use failure, data mistake, or loss of confidence.
- **Effort (1-5):** 1 is a contained presentation change; 3 crosses a workflow or shared component; 5 requires new domain, persistence, or IPC capability.
- **Launch priority:** P0 is a release gate; P1 is strongly recommended before general availability; P2 can follow launch. Within each priority, sequence prerequisites first, then rank by UX benefit, UI benefit, and lower effort. Scores are planning estimates and should be revised after task walkthroughs.

## Ranked Pre-Launch Improvements

| Rank | Improvement | UI | UX | Effort | Priority |
| --- | --- | ---: | ---: | ---: | --- |
| 1 | First-run household and account setup, real-data empty state, and removal of production sample-led behavior | 4 | 5 | 5 | P0 |
| 2 | First statement to reviewed ledger journey, including clear account selection, validation, confirmation, and next action | 4 | 5 | 3 | P0 |
| 3 | Live date context for monthly review and manual entry, with clear no-activity states | 3 | 5 | 2 | P0 |
| 4 | Local-data confidence and recovery: explain on-device handling and make backup, export, and restore outcomes understandable | 3 | 5 | 3 | P0 |
| 5 | Compact-window ledger and review readability, including access to every financial column | 4 | 4 | 3 | P1 |
| 6 | Comparative visual and information-architecture redesign decision, including a full overhaul if it wins task testing | 5 | 3 | 5 | P1 |
| 7 | Consistent keyboard, focus, loading, empty, success, warning, and error behavior across destinations | 3 | 4 | 3 | P1 |
| 8 | Decorative motion, charts, and visual polish without a demonstrated task benefit | 2 | 2 | 2 | P2 |

## Agent Handoff Rules

- Work on one rank per implementation issue and pull request. Follow the repository's separate implementation and test issue policy; do not bundle Rank 6 redesign work or Rank 8 polish into P0 fixes.
- Before coding, verify the assigned issue's planning status, blockers, implementation entry points, test links, and scope. Rank 1 requires issue-catalog alignment first; do not invent issue IDs or hierarchy.
- Keep transaction content on-device. Use synthetic fixtures only, preserve no-network behavior, and do not include real household data in screenshots, logs, or reports.
- Preserve existing import, ledger, categorization, backup, and restore contracts unless an acceptance criterion explicitly requires a change. Prefer closing demonstrated gaps over rewriting tested workflows.
- Stop when a packet's acceptance criteria and required validation pass. Do not advance to another rank without a separate assignment.

## Agent Work Packets

### Rank 1: First-Run Household And Account Setup

**Outcome:** A fresh production database opens into a real setup flow, not a sample ledger or a dashboard error. Existing populated databases remain intact.

**Implementation entry points:** `electron/main.ts`; `src/app/backup/localLedgerSqlite.ts`; `src/domain/types.ts`; `src/renderer/preload.ts`; `src/renderer/App.tsx`; renderer workspaces under `src/renderer/workspaces/`. Add a focused application service only if no existing module owns setup orchestration.

**Sequence:**

1. Define an explicit startup state for an empty database, a configured household, and a genuine load failure. Do not treat a failed ledger read as an empty ledger.
2. Make production startup pass no sample data. Keep synthetic seeding explicit in test harnesses and fixtures; do not remove the test seed path relied on by current tests.
3. Add validated, transactional creation of the single local household and its first account. Expose a typed application/IPC contract and validate again at the IPC boundary.
4. Route an unconfigured database to setup. After successful creation, open the normal workspace and keep the household/account identity available to import and manual-entry flows instead of using `sample-hh` constants.
5. Verify setup survives restart and that a partially completed setup can be resumed or safely retried.

**Acceptance criteria:**

- [ ] A fresh production database shows setup and contains no synthetic household or transaction rows.
- [ ] The user can create the local household and first account with field-level validation and an understandable recovery path for save failure.
- [ ] Setup writes household and account atomically; a failed write leaves the database in a retryable state.
- [ ] Restarting after setup opens the same household and account without reseeding or duplicating data.
- [ ] Existing populated databases and backup restore behavior are unchanged.
- [ ] Import and manual entry use the active household/account contract, not hardcoded sample identifiers.

**Tests and validation:** Add unit tests for setup-input validation, integration tests for empty startup, atomic creation, restart, and preservation of existing data, and a dedicated Playwright first-run test using an isolated empty database. Keep existing seeded startup tests explicit. Run `npm run test:unit`, `npm run test:integration`, the startup and new first-run Playwright specs, and `npm run verify:no-network`.

**Dependencies and guardrails:** Update `issue-catalog.json` and validate its Epic > Feature > Story/Enabler > Test hierarchy before implementation issues are created. This is a single-household product; do not add multi-user, cloud identity, or account synchronization.

### Rank 2: First Statement To Reviewed Ledger

**Outcome:** From completed setup, the user can import a first statement and understand what was saved, skipped, or needs categorization.

**Implementation entry points:** `src/renderer/workspaces/ImportWorkspace.tsx`; `src/renderer/import/CsvImportSection.tsx`; `src/renderer/import/PdfImportSection.tsx`; `src/renderer/import/ImportStageProgress.tsx`; `src/renderer/import/CategoryReviewSection.tsx`; `electron/main.ts`; `src/renderer/preload.ts`.

**Sequence:**

1. Connect the setup completion action to the existing Import destination. Make format choice, account choice, and the next valid action visible on arrival.
2. Reuse the existing CSV/PDF preview, mapping, validation, duplicate-decision, and explicit-confirmation stages. Keep invalid rows, duplicate candidates, and importable rows distinguishable.
3. On completion, show imported/skipped counts and direct actions to the resulting ledger or uncategorized queue. Preserve success or failure feedback when the user changes destinations.
4. Walk cancellation, malformed input, unavailable account, duplicate-only, partial validation, and retry paths. Repair only gaps exposed by these journeys; do not rewrite parsers or add OCR.

**Acceptance criteria:**

- [ ] The first-import action opens a visible format choice and never silently chooses or changes the destination account.
- [ ] No transaction is persisted until explicit confirmation; cancellation and validation failure persist none.
- [ ] Confirmation is unavailable only with an accessible explanation tied to the blocking state or row.
- [ ] Success reports added and skipped counts and offers the correct next action; uncategorized work is reachable without losing import context.
- [ ] CSV and supported digital-PDF workflows preserve their format-specific validation and use consistent stage language.
- [ ] The complete first-import journey works from an empty ledger and uses only synthetic test statements.

**Tests and validation:** Extend `tests/playwright/csv-import-workflow.spec.ts`, `tests/playwright/pdf-import-workflow.spec.ts`, and `tests/playwright/categorization-review-workflow.spec.ts` or add a focused first-import spec. Run the affected Playwright specs, `npm run test:integration`, and `npm run verify:no-network`.

**Dependencies and guardrails:** Depends on Rank 1's household/account setup contract. Preserve import idempotency, provenance, duplicate decisions, and local-only processing.

### Rank 3: Live Date Context And Empty Months

**Outcome:** Review and manual entry use live local dates rather than fixture-era dates, while valid historical fixture data remains unchanged.

**Implementation entry points:** `src/renderer/App.tsx`; `src/renderer/workspaces/ReviewWorkspace.tsx`; `src/renderer/import/ManualEntrySection.tsx`; `src/domain/ledger/filterTransactions.ts` only if a shared local-month helper is justified.

**Sequence:**

1. Replace the fixed review default with the current local calendar month. Keep the selected month stable across refreshes and user navigation.
2. Ensure the current month remains selectable when it has no transactions; render a genuine empty-month state rather than an unavailable or loading state.
3. Default manual-entry date to today's local calendar date without converting the date-only input through UTC and shifting the day.
4. Align the “This month” ledger filter with the same local-calendar boundary semantics. Do not change dates parsed from imported statements.

**Acceptance criteria:**

- [ ] Startup selects the current local month, including when there are no transactions in that month.
- [ ] The month selector includes the selected month and changing month still preserves the last valid review if a request fails.
- [ ] Manual entry starts with today's local date and persists the date the user selected.
- [ ] “This month” includes the first and last local dates of the month and excludes adjacent months, including year rollover.
- [ ] Existing historical fixtures and explicit month-selection behavior are unchanged.

**Tests and validation:** Add deterministic unit coverage with a frozen clock for month boundaries, year rollover, and local date formatting. Extend `tests/playwright/dashboard-renderer-smoke.spec.ts` and the manual-entry runtime coverage. Run the focused unit/integration tests and those Playwright specs.

**Dependencies and guardrails:** Can proceed independently of Rank 1, but final startup behavior must be checked with both an empty and a configured database. Never replace synthetic fixture dates globally.

### Rank 4: Local-Data Confidence And Recovery

**Outcome:** Users understand the local-data boundary and can recover or export their ledger without weakening existing safety behavior.

**Implementation entry points:** setup and workspace composition in `src/renderer/App.tsx` and `src/renderer/workspaces/`; `src/renderer/backup/BackupSection.tsx`; `src/renderer/backup/ExportSection.tsx`; `src/renderer/dashboard/RestoreSnapshotSection.tsx`; backup IPC in `src/renderer/preload.ts` and `electron/main.ts`.

**Sequence:**

1. Add concise, factual on-device data language to the first-use path and a discoverable route to Data safety. Do not claim encryption or other protections that the implementation does not establish.
2. Audit existing choose, cancel, pending, success, error, and retry feedback for backup and export. Keep the explicit user-selected destination and report the outcome clearly.
3. Preserve restore preview and confirmation. Ensure the selected household, snapshot time, account/transaction counts, replacement consequences, and pre-restore recovery-copy behavior are clear before the destructive action.
4. Test the first backup/export/restore journey with synthetic data and confirm no operation sends transaction content over a network.

**Acceptance criteria:**

- [ ] Local-storage language is accurate, visible before the user relies on the ledger, and does not imply remote sync or unverified security features.
- [ ] Backup and export require an explicit destination and distinguish cancellation, pending, success, and failure.
- [ ] Restore identifies the selected snapshot and replacement consequences before confirmation; cancel leaves the current ledger unchanged.
- [ ] Restore failure and recovery-copy failure remain visible and recoverable without silently discarding the current ledger.
- [ ] Existing snapshot catalog, verification, undo, and portability behavior remains intact.

**Tests and validation:** Extend `tests/playwright/recovery-workflows-smoke.spec.ts` only for uncovered UI behavior; retain `tests/integration/backup-restore-contract.test.ts`. Run the affected Playwright and integration specs plus `npm run verify:no-network`.

**Dependencies and guardrails:** No persistence redesign is authorized by this rank. Existing backup/restore contracts are implemented and tested; prefer focused copy, state, or entry-point changes.

### Rank 5: Compact-Window Financial Readability

**Outcome:** Users can understand and operate the ledger and review at compact widths without losing financial values or controls.

**Implementation entry points:** `src/renderer/app.css`; `src/renderer/dashboard/LedgerSection.tsx`; `src/renderer/dashboard/TargetVsActualSection.tsx`; `src/renderer/workspaces/ReviewWorkspace.tsx` and `TransactionsWorkspace.tsx`; the existing desktop/mobile screenshot specs.

**Sequence:**

1. Capture the existing 390px and desktop baselines, then inventory clipping, horizontal page overflow, hidden columns, and inaccessible controls.
2. Keep the desktop semantic table. At compact widths, prefer labeled stacked transaction rows with date, merchant, amount, category, and account available; use a horizontal scroller only if its affordance and keyboard access are explicit and every value remains reachable.
3. Apply the same visible-value rule to target-versus-actual and other financial tables. Preserve sorting, filtering, row identity, and amount formatting.
4. Validate at 390, 680, 1024, 1280, and 1440 CSS pixels; do not use viewport-scaled font sizes or solve clipping by shrinking text below readable sizes.

**Acceptance criteria:**

- [ ] No required transaction or target value is clipped, hidden without an alternate, or dependent on an undiscoverable gesture.
- [ ] Compact layouts have no horizontal page overflow; any table-region scrolling has a visible cue and can be operated by keyboard.
- [ ] Date, merchant, amount, category, and account remain associated with the correct transaction in both desktop and compact presentations.
- [ ] Existing sort, filter, pagination, focus, and 10,000-transaction responsiveness behavior is unchanged.
- [ ] Desktop and compact screenshots show no overlap, clipped text, or focus obstruction.

**Tests and validation:** Extend `tests/playwright/ledger-search-filter-workflow.spec.ts` and `tests/playwright/dashboard-renderer-smoke.spec.ts`; retain the synthetic 10,000-transaction case. Run the focused Playwright specs and `npm run test:e2e:playwright` before accepting a broad layout change.

**Dependencies and guardrails:** Do not remove ledger columns or data, alter SQLite query contracts, or redesign every workspace as part of this rank.

### Rank 6: Comparative Visual And Information-Architecture Decision

**Outcome:** Make an evidence-backed choice between the current interface and a complete redesign. This rank is a decision gate, not automatic permission to code an unselected visual direction.

**Implementation entry points:** Current visual evidence in `src/renderer/App.tsx`, `src/renderer/app.css`, workspace components, and `tests/playwright/dashboard-renderer-smoke.spec.ts-snapshots/`. Product constraints in `PRODUCT.md` and `.github/copilot-instructions.md` remain binding.

**Sequence:**

1. In the implementing session, run Impeccable context once for the renderer target and follow the Operate-mode workflow. Treat the current implementation and screenshots as incumbent evidence; keep all product claims, privacy constraints, and working behavior.
2. Compare the incumbent with a materially different composition/identity using the same synthetic household and the same Review, first-import, and Data safety tasks at desktop and compact sizes.
3. If only composition changes, preserve the established visual world. If replacing the visual world, use Impeccable's new-work direction process and concept seed; present the direction for user selection before implementation.
4. Record the chosen direction and measurable task outcomes. Do not build both variants into production or silently split the difference.

**Acceptance criteria:**

- [ ] The comparison covers first-viewport comprehension, destination discovery, primary-task completion, financial-data legibility, and compact-window behavior.
- [ ] The selected direction is explicitly recorded; no replacement-world implementation begins before user selection.
- [ ] Any chosen redesign preserves local-first behavior, import/review/recovery contracts, accessibility, and real product terminology.
- [ ] A replacement world receives the required surface direction contract and finished design documentation; an extension does not rewrite the design system without approval.
- [ ] If the incumbent performs as well or better, record that result and do not redesign solely for novelty.

**Validation:** Prototype/screenshot comparison at 1440px and 390px with synthetic data; run affected Playwright visual and workflow specs after implementation, `npx impeccable check`, and the Impeccable detector once on changed UI targets. Do not run detector or design checks for a planning-only comparison.

**Dependencies and guardrails:** User confirmation is required to lock a replacement direction. This rank may be scheduled before other P1 work, but it must not delay P0 launch gates.

### Rank 7: Cross-Destination Interaction And Accessibility States

**Outcome:** Users can operate core tasks by keyboard and understand every asynchronous, empty, validation, success, and failure state consistently.

**Implementation entry points:** `src/renderer/App.tsx`; all four `src/renderer/workspaces/` components; shared control and state styles in `src/renderer/app.css`; relevant import, ledger, backup, and restore sections; `tests/playwright/keyboard-accessibility-smoke.spec.ts`.

**Sequence:**

1. Inventory existing behavior for navigation, month selection, ledger filters, import stages, categorization, backup, export, and restore. Reuse working local patterns; do not introduce a general component library as a prerequisite.
2. For each async region, verify pending, genuine empty, loaded, refreshing/stale, and failed states. Keep the last valid data visible during refresh failures and provide a specific retry or recovery action.
3. Verify field labels, help and error associations, disabled-action explanations, live status announcements, non-color status cues, focus order, and focus return after submit/cancel/navigation.
4. Fix only evidenced gaps. Extract shared behavior only where at least two real workflows need it.

**Acceptance criteria:**

- [ ] Keyboard-only users can complete the primary review, import, categorization, and recovery paths without a keyboard trap or lost focus.
- [ ] Screen-reader names and status messages identify the active destination, operation state, validation problem, and available recovery action.
- [ ] Empty data is distinguishable from loading failure; refresh failure does not erase the last valid financial view.
- [ ] Disabled actions explain why they are unavailable; status is never communicated by color alone.
- [ ] Reduced-motion preferences suppress nonessential transitions while preserving state feedback.

**Tests and validation:** Extend `tests/playwright/keyboard-accessibility-smoke.spec.ts` and the affected workflow specs. Run keyboard, startup, import, and recovery Playwright specs; manually verify the primary paths with keyboard navigation and a screen reader before launch. Run `npm run verify:no-network` if shared flow wiring changes.

**Dependencies and guardrails:** This is a gap-closing pass, not a redesign of completed Slice 1 or 2 behavior. Do not add animation in this rank.

### Rank 8: Decorative Motion, Charts, And Visual Polish

**Outcome:** Keep low-benefit polish out of the launch critical path unless observed task evidence changes its value.

**Implementation entry points:** None for pre-launch. If separately approved after launch, identify the owning workspace and existing design constraints before creating implementation entry points.

**Sequence:**

1. Do not implement this rank as part of launch readiness.
2. Reopen it only when usability feedback identifies a specific comprehension or task issue that motion, a chart, or polish could solve.
3. Define the task-level success measure and a static/accessibility alternative before prototyping. Use synthetic values for comparison and preserve exact financial figures alongside any visualization.
4. Create a separate scoped issue and test plan if the evidence supports proceeding.

**Acceptance criteria if later scheduled:**

- [ ] The proposed treatment addresses a documented user task or comprehension problem, not a preference for novelty.
- [ ] Users can still access exact values and complete the task without motion or chart interpretation.
- [ ] Reduced-motion, keyboard, contrast, and performance behavior are validated.
- [ ] No external service or new network dependency processes transaction content.

**Validation:** None for the current launch plan. A later implementation must use the relevant visual, accessibility, performance, and no-network checks from its approved issue.

### P0 Release Gates

- [ ] A first-run user can create the local household and at least one account, understand where data is stored, and reach a useful empty state without seeing synthetic household transactions as personal data.
- [ ] Review opens on the current local calendar month; manual entry starts with today's local date. Empty months explain that no activity is recorded and offer a relevant next action.
- [ ] A user can complete setup, import a synthetic CSV or supported digital PDF, resolve validation and duplicate decisions, confirm once, and reach the resulting ledger or categorization queue without losing context.
- [ ] Backup, export, and restore each explain the selected source or destination, completion result, and recovery path. Restore consequences are clear before data changes.
- [ ] Unit/integration coverage protects new setup and date behavior; Playwright covers first-run to first reviewed import and the critical recovery path. All test data is synthetic.

### P1 Before General Availability

- [ ] At 390px and common desktop window sizes, users can reach and interpret every required ledger field without hidden values or an undiscoverable horizontal-scroll dependency.
- [ ] A keyboard-only user can reach every destination and complete import, categorization, and recovery actions with visible focus and predictable focus return.
- [ ] Pending, empty, stale, success, and failure states distinguish real zero activity from unavailable data and retain the last valid financial view during refresh failures.
- [ ] Compare the incumbent visual system with at least one replacement concept using the same representative review, import, and recovery tasks at desktop and compact sizes. Choose based on task clarity and user outcomes; total replacement of the visual identity and layout is allowed.

### P2 Defer Unless Evidence Changes

- [ ] Add decorative animation, extra charting, or brand-only polish only when usability evidence shows a meaningful improvement. Do not make these release gates.

## Direction

### Structural Thesis

Treat the current four-destination shell as a proven incumbent, not a locked layout. Keep or replace it after the comparative task evaluation above. If retained, its destinations are:

1. **Review**: monthly totals, exceptions, targets, category context, and forecast.
2. **Transactions**: searchable ledger plus the categorization review queue.
3. **Import**: manual entry and guided CSV or PDF import.
4. **Data safety**: backup snapshot, restore, and export.

Any selected structure must keep destinations findable at desktop and compact widths. Navigation state must not alter domain or persistence behavior. Switching destinations must not silently discard unsaved or pending work: preserve in-memory view state for the current session, or explain the discard and obtain confirmation before navigating away. Completion and error feedback for submitted operations must remain available after returning.

### Monthly Review Thesis

- Keep one month selector in a stable review toolbar and default it to the current local calendar month.
- Put income, expenses, and net first, followed immediately by actionable exceptions such as uncategorized transactions and categories over target. Exception wording and its destination must agree about whether the work is month-scoped or queue-wide.
- Treat category and forecast sections as supporting analysis, not equal-priority panels.
- Keep target creation near target-versus-actual results, but keep the form collapsed until the user chooses to add or edit a target.
- Preserve the current information hierarchy and interaction strengths unless comparative task testing supports replacing them. A new palette, typography system, visual identity, or composition is allowed as part of a coherent full redesign.

### Boundaries

- Keep renderer components focused on presentation and interaction; filtering, sorting, pagination, import, categorization, and persistence rules remain in application or domain services.
- Keep all transaction content on-device and add no telemetry, analytics, cloud sync, or background network access.
- Preserve existing import and recovery behavior while changing presentation and navigation.
- Design and validate for typical Windows desktop windows and compact windows; compact layouts must not hide financial values or essential actions.
- Keep transaction content local and use synthetic fixtures for demonstrations and tests. Do not add cloud processing, telemetry, analytics, or background network access.
- Do not add gamification or decorative charts without a demonstrated workflow benefit. A full visual or information-architecture overhaul is in scope when comparative evidence supports it.

## Existing Workflow Slices

The following slices preserve detailed requirements and recorded acceptance status from the earlier implementation plan. They are not the current launch ranking; use the scorecard above for remaining work. Do not reopen checked criteria without new evidence.

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
- Let users save, edit, apply, and delete named local CSV import profiles containing an explicit account and column mapping.
- Identify duplicate candidates before confirmation using source references or transaction fingerprints; show the matching ledger transaction and allow an explicit per-row skip or import decision.
- Retain local import-job history and support a confirmed, carefully scoped undo that preserves later categorization corrections and unrelated transactions.
- For statements with 10,000 or more source rows, provide cancellable asynchronous preflight with progress, bounded preview rendering, aggregate counts, and a local row-level validation report.

Acceptance criteria:

- [x] The current import stage, completed stages, and next valid action are always clear.
- [x] No transaction is persisted before explicit confirmation.
- [x] Disabled confirmation has a visible, accessible reason.
- [x] Validation identifies affected rows and preserves valid preview context.
- [x] Success reports imported and skipped duplicate counts and offers the next relevant action.
- [x] CSV and PDF share interaction vocabulary without hiding format-specific validation.
- [x] Users can create, edit, apply, and delete named local CSV profiles that survive restart and store an explicit account and column mapping; applying a profile never silently changes the import destination and requires a new explicit account selection if its account is unavailable.
- [x] Preview identifies duplicate candidates by source reference or transaction fingerprint, shows the matching ledger transaction and match basis, and lets the user explicitly skip or import each candidate before final confirmation; result counts reflect those decisions.
- [x] Local import-job history identifies each run by format, source, time, account, and outcome counts; confirmed undo removes only unchanged transactions created by that job, preserves later category corrections, categorization rules, and unrelated transactions, and reports removed and retained counts.
- [x] For CSV or PDF statements with 10,000 or more source rows, preflight runs asynchronously with visible progress and cancellation; preview displays at most 100 rows at a time with complete aggregate counts and navigable pages, and a local report identifies each invalid row, field, and reason. Cancellation persists no transactions or completed import job and invalidates the preview.

Dependencies:

- Existing preview identifiers, duplicate reporting, and source-aware parser adapters.
- File-dialog IPC support for CSV and PDF selection if not already shared.
- A local SQLite import-profile store with additive migrations and validation that profiles reference an available household account.
- A ledger query for duplicate candidates using source references and transaction fingerprints, with enough provenance to explain each match.
- Import-job provenance that identifies rows created by a job and detects transactions changed after import before undo.
- An asynchronous, cancellable import worker/service contract with progress events, bounded preview pages, and local validation-report generation.

Risks:

- Duplicate matching can produce false positives; never skip a candidate without an explicit user decision, and make the match basis visible.
- Undo must not overwrite or remove work performed after import. Changed or categorized rows must be retained and reported rather than silently reverted.
- CSV parsing and PDF extraction currently run through main-process import workflows; large-file cancellation and progress require an asynchronous service boundary, not renderer-side parsing or a blocking IPC handler.

Out of scope:

- OCR for scanned or image-only statements, bank APIs, cloud sync, and remote import-profile storage.
- Blanket rollback of later transaction edits, category corrections, categorization rules, or unrelated ledger changes.

Validation commands, run from the repository root:

- `npm run typecheck`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e:playwright`
- `npm run verify:no-network`

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

- [x] Backup, export, and restore use consistent labels, action hierarchy, pending behavior, and completion feedback.
- [x] Restore identifies the selected snapshot and consequences before data changes.
- [x] Shared controls expose complete keyboard and semantic states with no color-only status communication.
- [x] No supported window size causes clipped controls, overlapping text, or inaccessible table content.
- [x] Reduced-motion preferences remove nonessential transitions while preserving state feedback.

Dependencies:

- Snapshot metadata contract and restore safety behavior.
- Shared renderer component patterns established in Slice 1.

## Issue Decomposition

Create or update planning issues only after this launch scope is accepted and work is ready to schedule. Keep implementation and test work separate. The issue catalog currently has no household/account onboarding entry; add and validate the correct Epic > Feature > Story/Enabler > Test relationships in `docs/ways-of-work/plan/budget-planner/issue-catalog.json` before creating issues. Derive parent relationships from the catalog rather than hand-authoring issue chains.

- Epic alignment: E4 Dashboard, budgeting, and forecasting; E2 Transaction ingestion and normalization; E3 Categorization and correction workflow; E5 Privacy, backup, export, and release quality.
- Proposed feature scopes: first-use household/account setup and real-data initialization; current-month review context; first-import-to-ledger activation; data-safety onboarding; compact-window access and interaction-state consistency.
- Proposed stories: household and account setup; no-data first-run state; live review-month and manual-entry dates; import-to-review handoff; compact ledger value access; keyboard and status-state completion. Retain existing ledger, categorization, import, and recovery stories only where the ranked launch criteria remain unmet.
- Proposed enablers: local household/account creation and persistence contract; safe first-run database initialization; renderer IPC and validation for setup; responsive table presentation where needed.
- Proposed test issues: first-run setup and relaunch persistence; no sample financial data presented as user data; current-month and local-date defaults; first import from an empty ledger; recovery after backup/restore; compact-window table access; comparative task evaluation for any full redesign.

## Test Strategy

### Unit

- Pure view-model transformations for exception summaries and destination-state decisions, NOK-to-minor-unit filter conversion, display-label sorting, filter chips, pagination state, and review queue ordering.
- Quick-filter composition, dynamic current-month resolution, inclusive amount ranges, NOK parsing, pending-filter debounce state, and saved-view validation.
- CSV import-profile validation, explicit account availability, duplicate-candidate classification and decisions, and import-job undo eligibility for unchanged versus later-corrected transactions.
- Large-statement progress/cancellation state and bounded preview paging for deterministic 10,000-row synthetic inputs.
- No unit tests for static styling or implementation details.

### Integration

- SQLite-backed paged and sorted ledger queries, total counts, account metadata for empty results, and targeted uncategorized queue ordering.
- Local SQLite saved-view create/list/delete persistence and query counts for combined draft criteria.
- Navigation view-state preservation for selected month, ledger filters, and unsaved form input across destination changes; submitted operations retain an observable completion or error outcome.
- Destination data-state contracts distinguish pending, empty, stale, and failed results without allowing a Review load failure to gate unrelated destinations.
- Import stage transitions, validation summaries, and post-import next actions.
- Local SQLite import-profile create/list/update/delete persistence, restart durability, and explicit account mapping.
- Duplicate candidates matched by source reference or fingerprint, user-selected skip/import outcomes, and final imported/skipped counts.
- Import-job history and undo that removes only unchanged rows from the selected job and preserves later categorization corrections, rules, and unrelated transactions.
- Cancellable 10,000-row preflight, progress events, bounded preview-page queries, complete aggregate counts, validation-report contents, and no persistence after cancellation.
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
- CSV profile create/edit/apply/delete across an Electron restart, with explicit account selection and unavailable-account recovery.
- Duplicate candidate inspection and per-row skip/import decisions before confirmation, including the resulting count summary.
- Import-history inspection and undo confirmation, verifying corrected and unrelated transactions remain unchanged.
- Large CSV/PDF preflight progress and cancellation, bounded 100-row preview pages, full aggregate counts, local row-level validation report, and no persisted work after cancellation.
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
- Gamification, decorative dashboard charts, and visual changes without a workflow benefit. A full redesign remains allowed through Rank 6's explicit comparison and selection gate.
- Mixed-merchant batch categorization. Same-merchant correction propagation remains in its separately groomed story until preview, selection, confirmation, and undo behavior are specified.

## Exit Criteria

- A fresh production install offers real household/account setup, does not present sample financial data as user data, and preserves existing ledgers on upgrade.
- Review and manual entry use live local date context and correctly represent a month with no activity.
- A first-time user can complete an import, understand its result, and reach the resulting transactions or categorization work.
- Local storage, backup, export, and restore behavior are understandable and validated without network access.
- The selected month's financial status and actionable exceptions are visible in the desktop first viewport.
- Ledger, import, categorization, and recovery workflows meet their slice acceptance criteria.
- Compact windows preserve access to all required financial values and actions; keyboard and screen-reader checks find no launch-blocking interaction gaps.
- The visual identity decision is recorded; if a redesign is chosen, its direction is user-selected and its finish/documentation requirements are complete.
- Automated coverage exists at the appropriate unit, integration, and Playwright layers.
- Desktop and compact-window visual baselines are reviewed, accessibility checks pass, and no-network verification remains green.
