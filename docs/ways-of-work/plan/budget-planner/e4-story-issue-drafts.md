# E4 Story Issue Drafts

Use these drafts to create execution-sized story issues under E4.

How to use:

- Create one GitHub issue per story using `.github/ISSUE_TEMPLATE/story.yml`.
- Copy the corresponding section below into the form fields.
- Replace all `#TBD` test references with real issue numbers.

## Story 1: [F4.1-S1] Monthly totals data contract

Suggested title: Story: Monthly totals data contract
Parent Epic Issue: #22
Parent Feature Issue: #23

Story Statement:

As a household user, I want reliable monthly income, expense, and net totals so that I can quickly assess my financial position.

Acceptance Criteria:

- [ ] AC-1: Monthly totals API returns income, expense, and net values for a requested month.
- [ ] AC-2: Returned totals are deterministic for the same fixture input.
- [ ] AC-3: Empty-month requests return explicit zero totals instead of null/undefined fields.

Technical Tasks:

- [ ] Implement monthly totals query/service contract in aggregation layer.
- [ ] Expose totals through dashboard-facing API surface.
- [ ] Add deterministic fixture-based integration coverage.

Testing Requirements:

- [ ] Unit: Aggregation arithmetic helper cases.
- [ ] Integration: Monthly totals contract test for fixture months.
- [ ] E2E: Optional smoke verification through dashboard flow.

Linked Enabler Issues:

- #36 Enabler: Aggregation and forecast query layer

Linked Test Issues:

- #73 Test: Monthly totals contract integration

Dependencies:

Blocked by:

- #36

Related to:

- #23

Estimate: 3 points

## Story 2: [F4.1-S2] Category breakdown data contract

Suggested title: Story: Category breakdown data contract
Parent Epic Issue: #22
Parent Feature Issue: #23

Story Statement:

As a household user, I want category-level monthly spending totals so that I can see where my money goes.

Acceptance Criteria:

- [ ] AC-1: Category totals API returns category amount rows for a requested month.
- [ ] AC-2: Category rows are deterministically ordered for stable UI output.
- [ ] AC-3: Uncategorized transactions are represented in a predictable bucket.

Technical Tasks:

- [ ] Implement category grouping query/service logic.
- [ ] Define API contract fields for category totals.
- [ ] Add integration tests for categorized and uncategorized fixture rows.

Testing Requirements:

- [ ] Unit: Category grouping edge cases.
- [ ] Integration: Category totals API contract tests.
- [ ] E2E: Optional smoke rendering of category list.

Linked Enabler Issues:

- #36 Enabler: Aggregation and forecast query layer

Linked Test Issues:

- #74 Test: Category breakdown contract integration

Dependencies:

Blocked by:

- #36

Related to:

- #23

Estimate: 3 points

## Story 3: [F4.1-S3] Monthly dashboard view and month switch

Suggested title: Story: Monthly dashboard view and month switch
Parent Epic Issue: #22
Parent Feature Issue: #23

Story Statement:

As a household user, I want a monthly dashboard view with month switching so that I can compare periods quickly.

Acceptance Criteria:

- [ ] AC-1: Dashboard renders totals and category breakdown for selected month without runtime errors.
- [ ] AC-2: Changing month triggers data refresh and updates rendered values.
- [ ] AC-3: Loading and empty states are handled explicitly in the dashboard view.

Technical Tasks:

- [ ] Add minimal dashboard page/components under `src/renderer/dashboard/`.
- [ ] Wire month selector to totals/category APIs.
- [ ] Add smoke/integration coverage for month switch flow.

Testing Requirements:

- [ ] Unit: Component state transitions for loading/error/empty.
- [ ] Integration: API-to-render contract tests.
- [ ] E2E: Month switch happy path.

Linked Enabler Issues:

- #36 Enabler: Aggregation and forecast query layer

Linked Test Issues:

- #75 Test: Dashboard render and month-switch smoke

Dependencies:

Blocked by:

- #36

Related to:

- #23

Estimate: 5 points

## Story 4: [F4.2-S1] Category target CRUD and persistence

Suggested title: Story: Category target CRUD and persistence
Parent Epic Issue: #22
Parent Feature Issue: #24

Story Statement:

As a household user, I want to set and persist monthly category targets so that I can manage my budget goals.

Acceptance Criteria:

- [ ] AC-1: API supports create, update, and read of monthly category targets.
- [ ] AC-2: Saved targets persist across app reload.
- [ ] AC-3: Invalid target inputs are rejected with consistent validation behavior.

Technical Tasks:

- [ ] Add target persistence schema/repository operations.
- [ ] Implement target CRUD API handlers.
- [ ] Add integration tests for create/update/read/reload flows.

Testing Requirements:

- [ ] Unit: Validation and domain constraints for target amounts.
- [ ] Integration: Persistence and reload behavior.
- [ ] E2E: Optional target save smoke path.

Linked Enabler Issues:

- #36 Enabler: Aggregation and forecast query layer

Linked Test Issues:

- #76 Test: Category target CRUD and persistence integration

Dependencies:

Blocked by:

- #36

Related to:

- #24

Estimate: 5 points

## Story 5: [F4.2-S2] Target-vs-actual dashboard integration

Suggested title: Story: Target-vs-actual dashboard integration
Parent Epic Issue: #22
Parent Feature Issue: #24

Story Statement:

As a household user, I want to see actual versus target values per category so that I can detect over-budget categories.

Acceptance Criteria:

- [ ] AC-1: Dashboard data contract includes target value, actual value, and delta per category.
- [ ] AC-2: Updating a target is reflected after refresh without stale values.
- [ ] AC-3: Categories without targets are handled explicitly (for example null/zero target policy).

Technical Tasks:

- [ ] Extend dashboard aggregation response with target-vs-actual fields.
- [ ] Wire renderer display of target and delta values.
- [ ] Add integration coverage for update-and-refresh flow.

Testing Requirements:

- [ ] Unit: Delta calculation and null-target behavior.
- [ ] Integration: Target-vs-actual contract tests.
- [ ] E2E: Target update reflected in dashboard.

Linked Enabler Issues:

- #36 Enabler: Aggregation and forecast query layer

Linked Test Issues:

- #77 Test: Target-vs-actual integration and refresh

Dependencies:

Blocked by:

- #36

Related to:

- #24

Estimate: 5 points

## Story 6: [F4.3-S1] Deterministic simple forecast module

Suggested title: Story: Deterministic simple forecast module
Parent Epic Issue: #22
Parent Feature Issue: #25

Story Statement:

As a household user, I want a deterministic near-term forecast so that I can anticipate upcoming cashflow using reproducible logic.

Acceptance Criteria:

- [ ] AC-1: `src/forecast/simpleForecast.ts` implements a documented deterministic method (initially 3-month moving average).
- [ ] AC-2: Identical input fixtures produce identical forecast output.
- [ ] AC-3: Edge cases are handled for sparse history, zero values, and missing-month sequences.

Technical Tasks:

- [ ] Implement forecast module and input/output types.
- [ ] Add method documentation and assumptions.
- [ ] Add comprehensive unit test coverage for edge cases.

Testing Requirements:

- [ ] Unit: Algorithm correctness and edge cases.
- [ ] Integration: Optional API adapter test if module is wrapped.
- [ ] E2E: Not required in this story.

Linked Enabler Issues:

- #36 Enabler: Aggregation and forecast query layer

Linked Test Issues:

- #78 Test: Forecast algorithm unit edge cases

Dependencies:

Blocked by:

- #36

Related to:

- #25

Estimate: 3 points

## Story 7: [F4.3-S2] Forecast API and dashboard integration

Suggested title: Story: Forecast API and dashboard integration
Parent Epic Issue: #22
Parent Feature Issue: #25

Story Statement:

As a household user, I want forecast values surfaced in dashboard workflows so that I can view near-term trends with the same monthly context.

Acceptance Criteria:

- [ ] AC-1: Dashboard-facing API includes forecast output in a stable data contract.
- [ ] AC-2: Dashboard can render forecast values without breaking existing totals/category flows.
- [ ] AC-3: Missing-data situations are handled with explicit fallback behavior.

Technical Tasks:

- [ ] Expose forecast module output through dashboard API.
- [ ] Add renderer integration for forecast display.
- [ ] Add integration tests for forecast contract and fallback scenarios.

Testing Requirements:

- [ ] Unit: Forecast display transformer or adapter logic.
- [ ] Integration: Forecast contract and fallback behavior.
- [ ] E2E: Smoke path including forecast section render.

Linked Enabler Issues:

- #36 Enabler: Aggregation and forecast query layer

Linked Test Issues:

- #79 Test: Forecast API and dashboard contract integration

Dependencies:

Blocked by:

- #36

Related to:

- #25

Estimate: 5 points
