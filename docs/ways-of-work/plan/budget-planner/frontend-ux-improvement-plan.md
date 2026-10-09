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
- All acceptance criteria in the former app-shell/review, transaction workspace, import workspace, and data-safety slices are checked. Treat those workflows as the established baseline; the eight ranked packets below describe only remaining launch gaps or explicit decisions.
- Production startup checks whether setup is required and routes an unconfigured database to `HouseholdSetup`. Sample household, account, and transaction data is passed as seed data only in the test environment. The first-run slice still needs acceptance validation for transactional household/account creation, restart behavior, and use of the active household/account across import and manual-entry flows.
- Monthly review defaults to the current local year-month, and manual entry defaults to today's local date. These are live defaults; historical fixture dates should remain unchanged, and date-only behavior still needs boundary validation.
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

## Out Of Scope

- Cloud sync, bank APIs, telemetry, analytics, and remote processing of transaction content.
- OCR for scanned/image-only statements or ML-based categorization.
- New budgeting or forecast calculations, multiple household users, multi-device sync, or native mobile support.
- Mixed-merchant batch categorization. Same-merchant correction propagation remains in its separately groomed story until preview, selection, confirmation, and undo behavior are specified.

## Launch Exit

- Ranks 1-4 meet their P0 acceptance criteria, including fresh-install setup, first import, correct date context, and local-data recovery.
- Ranks 5 and 7 meet their P1 acceptance criteria at supported desktop and compact sizes, with no launch-blocking accessibility or data-visibility defects.
- Rank 6 has a recorded decision; any selected replacement direction has user approval and its required finish review and design documentation.
- Relevant unit, integration, and Playwright checks pass; no-network verification remains green. Rank 8 is deferred unless separately justified by user evidence.
