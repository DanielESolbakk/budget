# Activity Automation Plan

## Purpose And Approved Scope

Make Activity reduce repetitive transaction review through local, explainable
automation. Deliver five workstreams in order: category management, broader
merchant recognition, learning suggestions for unknown merchants, safe batch
review, and recurring-commitment suggestions. No bank adapters or external
transaction processing are included.

Category management is the first delivery scope, under E3 > F3.4 (#585).
Story S3.4.1 (#587) owns catalog creation and renaming; Story S3.4.2 (#588)
owns merging and depends on #587. The other four workstreams are approved
roadmap outcomes, not implementation-ready issue hierarchies.

## Product Requirements And Acceptance Criteria

- [ ] AA-1: Activity offers useful default categories and user-created categories,
  with create, rename, and preview/confirm merge actions.
- [ ] AA-2: Recognizable merchant aliases receive deterministic local category
  decisions with visible reasons; generic payment processors and conflicting
  matches remain reviewable.
- [ ] AA-3: Repeated unknown descriptions produce a proposed merchant identity
  and category rule that is saved only after user acceptance.
- [ ] AA-4: Batch category corrections show affected transactions, allow
  exclusions, require confirmation, and support audited undo.
- [ ] AA-5: Recurring activity produces a proposed commitment or update that
  requires user confirmation and cannot duplicate an existing commitment.
- [ ] AA-6: All decisions and data remain local. User corrections outrank seeded
  rules, raw merchant descriptions remain unchanged, and failures are visible.

## Delivery Breakdown

| Order | Workstream | Delivery boundary | Dependencies |
| --- | --- | --- | --- |
| 1 | Category management | Defaults, custom categories, rename, safe merge, migration, backup and Activity dialog | Existing ledger, category correction, allocation and target contracts |
| 2 | Merchant recognition | Curated offline aliases and evidence-based matching reasons; no generic processor guesses | Category catalog and active-category resolution |
| 3 | Unknown-merchant learning | Group repeated unknown descriptions; accept/dismiss a proposed identity and rule | Merchant recognition and existing correction/rule persistence |
| 4 | Safe batch review | Extend existing same-merchant preview/apply/undo instead of creating another batch engine | Category catalog, suggestion grouping, existing propagation history |
| 5 | Recurring suggestions | Propose existing supported commitment cadences using merchant, dates, account, currency and amounts | Merchant identity and existing commitment/payment-link services |

Only category management is materialized in this planning batch. Before each
later workstream starts, define concrete acceptance criteria, thresholds,
conflict/dismissal behavior, and immediate implementation-owned test plans.
Do not infer those decisions from a merchant name or add placeholder Test issues.

## First Workstream: Category Catalog And Management

### Create And Rename (#587)

- Preserve the six existing IDs and their financial meaning: `groceries`,
  `salary`, `housing`, `transport`, `utilities`, and `other`.
- Add default categories for dining, health, insurance, subscriptions, shopping,
  fuel, public transit, and fees. Do not automatically redistribute old
  transactions into the new categories.
- Assign stable IDs to custom categories. Trim and collapse whitespace in
  display names; reject empty names and case/whitespace-equivalent active names.
- Renaming changes a label, not identity, amounts, or historical references.
- Load one persisted household catalog for category review, ledger filters and
  labels, allocations, manual/import correction, and category targets.
- Seed defaults only when missing. Preserve renamed defaults and unknown legacy
  category IDs; never replace a customized label during startup.

### Preview And Merge (#588)

- Preview source/destination names, affected current transactions, allocations,
  merchant rules, and target changes without writing data.
- For colliding monthly targets, show source, destination, and proposed sum.
  The user approved summing these targets; reject unsafe minor-unit sums.
- Consolidate source/destination allocations inside each transaction while
  preserving its signed total and original currency.
- Confirm against the reviewed state. A relevant intervening edit invalidates
  the preview; repeated confirmation cannot apply the target sum twice.
- Commit current references, target changes, merged-category link, and audit
  record in one repository-owned transaction.
- Keep the source category as an inactive record resolving to the destination.
  Reject self merges, missing destinations, and cyclic links.
- Preserve original correction, propagation, and import-undo evidence.
  Resolve historical category IDs when an operation applies a current
  assignment; never silently reactivate an inactive category.
- Category merge undo and permanent deletion are excluded.

## Technical Boundaries And Migration

- Shared/domain contracts own category identity, name validation, active-category
  resolution, allocation consolidation, and safe target summation.
- Create `src/domain/categorization/categoryCatalog.ts`,
  `src/app/categoryService.ts`, and `src/app/backup/categoryRepository.ts` for
  catalog behavior. The merge Story adds
  `src/domain/categorization/categoryMerge.ts`.
- Add catalog schema and explicit backfill in
  `src/app/backup/ledgerSchema.ts`; retain connection ownership in
  `localLedgerSqlite.ts`. A failed migration rolls back rather than selecting a
  partial catalog.
- Add validated operations in `electron/ipc/categoryChannels.ts`, registered
  by main using declared context dependencies. Renderer code does not own
  persistence or merge calculations.
- Create `src/renderer/workspaces/CategoryManagementDialog.tsx`; existing
  category consumers load current labels and active IDs through the shared API.
- Extend snapshot types, validation, serialization, and restore for catalog
  records and merge evidence. Legacy snapshots register their existing IDs;
  new snapshots with missing references or cyclic merge links fail before
  replacement. Do not rewrite saved historical snapshots during rename/merge.
- Browser preview remains synthetic and limited. Decide explicitly which
  catalog reads it supports, reuse shared behavior, and reject desktop-only
  writes while preserving the complete typed API and cleanup contracts.

## Interaction And Accessibility

- Open **Manage categories** from Activity near category review. Preserve the
  existing ledger layout, Clear North tokens, native dialog, selectors,
  financial-value displays, status feedback, and focus patterns.
- Keep create/rename simple; put merge behind source/destination selection,
  read-only preview, and explicit confirmation.
- Preserve drafts after validation or persistence errors. Announce errors and
  successful writes separately from later refresh failures.
- Label controls, support keyboard navigation and cancellation, restore focus
  on close, and never convey financial meaning through color alone.
- At 1280x800 and 390x844, category names, target sums, and save/confirm/cancel
  controls remain reachable. Long previews scroll within the dialog.
- Validation is functional-only: visible labels, focus, control reachability,
  and financial amounts. Do not add screenshot or pixel-comparison assertions.

## Test Strategy And TDD

| Story | Unit | Integration | Playwright |
| --- | --- | --- | --- |
| #587 create/rename | #589: `tests/unit/domain/categorization/categoryCatalog.test.ts` | #590: `tests/integration/category-management.test.ts` | #591: `tests/playwright/category-management.spec.ts` |
| #588 merge | #592: `tests/unit/category-merge.test.ts` | #593: `tests/integration/category-merge.test.ts` | #594: `tests/playwright/category-merge.spec.ts` |

The named test files are creation tasks, not existing implementation entry
points. Each Test plan owns one layer and names its immediate Story ACs.
Standalone Test assignment is blocked on the parent product capability;
TDD authoring alongside implementation is permitted after planning gates pass.

Map #585 AC-1/AC-2 to #587 AC-1/AC-2 and #589/#590/#591.
Map #585 AC-3 to #587 AC-3 and #589/#590/#591.
Map #585 AC-4/AC-5 to #588 AC-1 through AC-5 and #592/#593/#594.
Map #585 AC-6 to #587 AC-5 and #588 AC-6 through #590/#591/#593/#594.
Map #585 AC-7 to #587 AC-6 and #588 AC-7 through #590/#593 plus no-network
verification. These are planned mappings, not passing implementation evidence.

For every new behavior: write a focused test, observe its intended failure,
implement minimally, verify green, and refactor only while green. Keep real
SQLite integration coverage separate from Electron user-journey assertions.

### Scoped Commands

Run affected validation sequentially:

```sh
npm run test:unit -- tests/unit/domain/categorization/categoryCatalog.test.ts
npm run test:integration -- tests/integration/category-management.test.ts
npm run test:e2e:playwright -- tests/playwright/category-management.spec.ts
npm run test:unit -- tests/unit/category-merge.test.ts
npm run test:integration -- tests/integration/category-merge.test.ts
npm run test:e2e:playwright -- tests/playwright/category-merge.spec.ts
npm run typecheck
npm run verify:no-network
```

Use synthetic Norwegian-representative descriptions, legacy category IDs,
NOK/SEK transactions, allocated purchases, rules and monthly targets. Add a
synthetic 10,000-transaction ledger for migration and merge conservation checks;
do not invent a new performance threshold without measuring the existing lane.
Product commands are not runnable evidence until their planned files and
capabilities have been implemented.

## Risks And Containment

- Migration or restore can orphan references: backfill all current and
  historical IDs, validate before replacement, and verify real round trips.
- Merge can alter financial meaning: show target sums, preserve transaction
  amounts/currencies, reject overflow, and commit atomically.
- Historical undo can restore obsolete IDs: retain evidence and resolve IDs at
  the operation boundary without silently reactivating merged categories.
- Fixed category lists can drift: replace directly affected consumers together
  and display catalog loading/refresh failures explicitly.
- Automation can overreach: keep guesses reviewable, never silently create
  categories/rules/commitments from suggestions, and keep all processing local.

## Readiness And Next Actions

1. Complete Feature/Story/Test cross-links and remove the duplicate #586 only
   after its pending closure is verified.
2. Align this plan and catalog through a planning PR.
3. Trigger fresh structural planning validation and then assess semantic
   planning completeness and assignment prerequisites separately.
4. Begin #587 with observed red-green tests only after those gates pass.
5. Deliver #588 after #587; plan later automation workstreams separately.

Planning records and this document do not claim product delivery, passing
tests, or assignment readiness. Retain `needs-grooming` until fresh validation
and semantic checks justify removing it.
