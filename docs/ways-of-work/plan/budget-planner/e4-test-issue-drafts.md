# E4 Test Issue Drafts

These drafts are designed for `.github/ISSUE_TEMPLATE/test.yml`.

How to use:

- Create one GitHub issue per draft using the Test issue form.
- Copy each section into the form fields.
- Parent and related issue references are already populated with real issue numbers.

Important sequencing:

- Create story issues first, then keep `Parent Story Or Enabler Issue` aligned with the actual story/enabler issue number.
- Keep at least one feature-scoped test issue per feature (`#23`, `#24`, `#25`) to satisfy feature traceability.

## Test 1: [T4-S1] Monthly totals contract integration

Suggested title: Test: Monthly totals contract integration
Parent Epic Issue: #22
Test Scope Type: Story or Enabler
Parent Feature Issue: #23
Parent Story Or Enabler Issue: #66

Related Planning Issues:

- #66 Story: Monthly totals data contract
- #23 Feature: Monthly dashboard

Parent AC IDs Covered:

- AC-1 (from Story F4.1-S1)
- AC-2 (from Story F4.1-S1)
- AC-3 (from Story F4.1-S1)

Test Level: Integration

Test Objective:

Validate monthly totals API contract returns deterministic income, expense, and net values, including empty-month behavior.

Fixture Requirements:

- Fixture type: Synthetic monthly transaction fixture
- Source and sanitization note: `tests/fixtures/synthetic/*`, sanitized/synthetic only

Test Scenarios:

- [ ] Scenario 1: Requested month returns expected income, expense, and net values
- [ ] Scenario 2: Repeated identical request returns identical response
- [ ] Scenario 3: Empty month returns zero totals with stable schema

Pass Criteria:

- [ ] AC-1: Contract fields and values match expected snapshot
- [ ] AC-2: Determinism check passes across repeated runs
- [ ] AC-3: Empty-month behavior conforms to spec

Regression Guard:

- [ ] This issue includes or references regression coverage for previously observed failures where applicable.

## Test 2: [T4-S2] Category breakdown contract integration

Suggested title: Test: Category breakdown contract integration
Parent Epic Issue: #22
Test Scope Type: Story or Enabler
Parent Feature Issue: #23
Parent Story Or Enabler Issue: #67

Related Planning Issues:

- #67 Story: Category breakdown data contract
- #23 Feature: Monthly dashboard

Parent AC IDs Covered:

- AC-1 (from Story F4.1-S2)
- AC-2 (from Story F4.1-S2)
- AC-3 (from Story F4.1-S2)

Test Level: Integration

Test Objective:

Verify category-level totals contract, deterministic ordering, and uncategorized handling.

Fixture Requirements:

- Fixture type: Synthetic categorized and uncategorized transaction fixtures
- Source and sanitization note: `tests/fixtures/synthetic/*`, no real financial data

Test Scenarios:

- [ ] Scenario 1: Category totals returned for selected month
- [ ] Scenario 2: Ordering is deterministic across runs
- [ ] Scenario 3: Uncategorized bucket appears as defined

Pass Criteria:

- [ ] AC-1: Category totals align with expected aggregate calculations
- [ ] AC-2: Stable ordering check passes
- [ ] AC-3: Uncategorized policy is enforced

Regression Guard:

- [ ] This issue includes or references regression coverage for previously observed failures where applicable.

## Test 3: [T4-S3] Dashboard render and month-switch smoke

Suggested title: Test: Dashboard render and month-switch smoke
Parent Epic Issue: #22
Test Scope Type: Story or Enabler
Parent Feature Issue: #23
Parent Story Or Enabler Issue: #68

Related Planning Issues:

- #68 Story: Monthly dashboard view and month switch
- #23 Feature: Monthly dashboard

Parent AC IDs Covered:

- AC-1 (from Story F4.1-S3)
- AC-2 (from Story F4.1-S3)
- AC-3 (from Story F4.1-S3)

Test Level: End-to-end

Test Objective:

Confirm dashboard renders monthly data and month switching updates values without runtime failures.

Fixture Requirements:

- Fixture type: Synthetic monthly fixture with at least two months
- Source and sanitization note: Local synthetic fixtures only

Test Scenarios:

- [ ] Scenario 1: Dashboard first render shows totals and categories
- [ ] Scenario 2: Month switch updates displayed values
- [ ] Scenario 3: Loading and empty states render correctly

Pass Criteria:

- [ ] AC-1: Initial render contains expected sections without errors
- [ ] AC-2: Month switch updates data and UI
- [ ] AC-3: Empty/loading behavior follows UX contract

Regression Guard:

- [ ] This issue includes or references regression coverage for previously observed failures where applicable.

## Test 4: [T4-S4] Category target CRUD and persistence integration

Suggested title: Test: Category target CRUD and persistence integration
Parent Epic Issue: #22
Test Scope Type: Story or Enabler
Parent Feature Issue: #24
Parent Story Or Enabler Issue: #69

Related Planning Issues:

- #69 Story: Category target CRUD and persistence
- #24 Feature: Monthly category targets

Parent AC IDs Covered:

- AC-1 (from Story F4.2-S1)
- AC-2 (from Story F4.2-S1)
- AC-3 (from Story F4.2-S1)

Test Level: Integration

Test Objective:

Validate target create/update/read API and persisted reload behavior including validation failures.

Fixture Requirements:

- Fixture type: Synthetic categories and target payloads
- Source and sanitization note: Synthetic only, no personal data

Test Scenarios:

- [ ] Scenario 1: Create and read target succeeds
- [ ] Scenario 2: Update target persists and reload confirms value
- [ ] Scenario 3: Invalid input rejected with stable error contract

Pass Criteria:

- [ ] AC-1: CRUD API contract passes integration tests
- [ ] AC-2: Persistence across reload verified
- [ ] AC-3: Validation behavior consistent and documented

Regression Guard:

- [ ] This issue includes or references regression coverage for previously observed failures where applicable.

## Test 5: [T4-S5] Target-vs-actual integration and refresh

Suggested title: Test: Target-vs-actual integration and refresh
Parent Epic Issue: #22
Test Scope Type: Story or Enabler
Parent Feature Issue: #24
Parent Story Or Enabler Issue: #70

Related Planning Issues:

- #70 Story: Target-vs-actual dashboard integration
- #24 Feature: Monthly category targets

Parent AC IDs Covered:

- AC-1 (from Story F4.2-S2)
- AC-2 (from Story F4.2-S2)
- AC-3 (from Story F4.2-S2)

Test Level: Integration

Test Objective:

Ensure dashboard contracts include target/actual/delta and refresh reflects target updates without stale values.

Fixture Requirements:

- Fixture type: Synthetic target + transaction fixtures
- Source and sanitization note: Synthetic fixtures only

Test Scenarios:

- [ ] Scenario 1: Contract returns target, actual, delta per category
- [ ] Scenario 2: Target update reflected after refresh
- [ ] Scenario 3: No-target categories follow defined null/zero policy

Pass Criteria:

- [ ] AC-1: Contract fields and values validated
- [ ] AC-2: Refresh consistency check passes
- [ ] AC-3: No-target behavior validated

Regression Guard:

- [ ] This issue includes or references regression coverage for previously observed failures where applicable.

## Test 6: [T4-S6] Forecast algorithm unit edge cases

Suggested title: Test: Forecast algorithm unit edge cases
Parent Epic Issue: #22
Test Scope Type: Story or Enabler
Parent Feature Issue: #25
Parent Story Or Enabler Issue: #71

Related Planning Issues:

- #71 Story: Deterministic simple forecast module
- #25 Feature: Simple forward forecast

Parent AC IDs Covered:

- AC-1 (from Story F4.3-S1)
- AC-2 (from Story F4.3-S1)
- AC-3 (from Story F4.3-S1)

Test Level: Unit

Test Objective:

Verify deterministic forecast algorithm behavior and edge-case handling for sparse/zero/missing-month data.

Fixture Requirements:

- Fixture type: Synthetic in-memory forecast input arrays
- Source and sanitization note: Synthetic values only

Test Scenarios:

- [ ] Scenario 1: Baseline moving-average output for known inputs
- [ ] Scenario 2: Determinism across repeated runs
- [ ] Scenario 3: Sparse history and missing-month behavior
- [ ] Scenario 4: Zero-value sequences behavior

Pass Criteria:

- [ ] AC-1: Algorithm output matches documented method
- [ ] AC-2: Determinism assertions pass
- [ ] AC-3: Edge-case assertions pass

Regression Guard:

- [ ] This issue includes or references regression coverage for previously observed failures where applicable.

## Test 7: [T4-S7] Forecast API and dashboard contract integration

Suggested title: Test: Forecast API and dashboard contract integration
Parent Epic Issue: #22
Test Scope Type: Story or Enabler
Parent Feature Issue: #25
Parent Story Or Enabler Issue: #72

Related Planning Issues:

- #72 Story: Forecast API and dashboard integration
- #25 Feature: Simple forward forecast

Parent AC IDs Covered:

- AC-1 (from Story F4.3-S2)
- AC-2 (from Story F4.3-S2)
- AC-3 (from Story F4.3-S2)

Test Level: Integration

Test Objective:

Validate forecast API contract and dashboard integration behavior, including fallback paths.

Fixture Requirements:

- Fixture type: Synthetic multi-month fixture including sparse cases
- Source and sanitization note: Synthetic only

Test Scenarios:

- [ ] Scenario 1: Forecast fields present in API contract
- [ ] Scenario 2: Dashboard consumes forecast contract without breaking existing totals
- [ ] Scenario 3: Missing-data fallback is explicit and stable

Pass Criteria:

- [ ] AC-1: Forecast contract fields and schema validated
- [ ] AC-2: Integration preserves existing dashboard paths
- [ ] AC-3: Fallback behavior validated

Regression Guard:

- [ ] This issue includes or references regression coverage for previously observed failures where applicable.

## Test 8: [T4-F1] Feature-level dashboard integration pack

Suggested title: Test: Feature-level dashboard integration pack
Parent Epic Issue: #22
Test Scope Type: Feature
Parent Feature Issue: #23
Parent Story Or Enabler Issue: _None_

Related Planning Issues:

- #23 Feature: Monthly dashboard

Parent AC IDs Covered:

- AC-1 (from Feature F4.1)
- AC-2 (from Feature F4.1)
- AC-3 (from Feature F4.1)
- AC-4 (from Feature F4.1)

Test Level: Integration

Test Objective:

Provide feature-scoped integration coverage across monthly totals, category breakdown, and month switching data contracts.

Fixture Requirements:

- Fixture type: Synthetic monthly fixtures with category distribution
- Source and sanitization note: Synthetic only

Test Scenarios:

- [ ] Scenario 1: Totals and categories available for selected month
- [ ] Scenario 2: Month switch updates feature contract outputs
- [ ] Scenario 3: Endpoints are resilient to empty month data

Pass Criteria:

- [ ] AC-1: Feature contract totals pass
- [ ] AC-2: Feature category output pass
- [ ] AC-3: Render-path support validated
- [ ] AC-4: Month switch behavior validated

Regression Guard:

- [ ] This issue includes or references regression coverage for previously observed failures where applicable.

## Test 9: [T4-F2] Feature-level category target integration pack

Suggested title: Test: Feature-level category target integration pack
Parent Epic Issue: #22
Test Scope Type: Feature
Parent Feature Issue: #24
Parent Story Or Enabler Issue: _None_

Related Planning Issues:

- #24 Feature: Monthly category targets

Parent AC IDs Covered:

- AC-1 (from Feature F4.2)
- AC-2 (from Feature F4.2)
- AC-3 (from Feature F4.2)
- AC-4 (from Feature F4.2)

Test Level: Integration

Test Objective:

Provide feature-scoped integration coverage for target CRUD, persistence, and target-vs-actual dashboard outputs.

Fixture Requirements:

- Fixture type: Synthetic target + transaction fixtures
- Source and sanitization note: Synthetic only

Test Scenarios:

- [ ] Scenario 1: Target CRUD and reload behavior
- [ ] Scenario 2: Target update reflected in dashboard contract
- [ ] Scenario 3: No-target category handling behavior

Pass Criteria:

- [ ] AC-1: Feature CRUD contract passes
- [ ] AC-2: Persistence behavior passes
- [ ] AC-3: Dashboard target fields pass
- [ ] AC-4: Refresh update behavior passes

Regression Guard:

- [ ] This issue includes or references regression coverage for previously observed failures where applicable.

## Test 10: [T4-F3] Feature-level forecast integration pack

Suggested title: Test: Feature-level forecast integration pack
Parent Epic Issue: #22
Test Scope Type: Feature
Parent Feature Issue: #25
Parent Story Or Enabler Issue: _None_

Related Planning Issues:

- #25 Feature: Simple forward forecast

Parent AC IDs Covered:

- AC-1 (from Feature F4.3)
- AC-2 (from Feature F4.3)
- AC-3 (from Feature F4.3)
- AC-4 (from Feature F4.3)

Test Level: Integration

Test Objective:

Provide feature-scoped integration coverage for forecast algorithm output exposure and dashboard contract compatibility.

Fixture Requirements:

- Fixture type: Synthetic multi-month forecast fixtures
- Source and sanitization note: Synthetic only

Test Scenarios:

- [ ] Scenario 1: Forecast API exposes deterministic output
- [ ] Scenario 2: Forecast fields integrate with dashboard contract
- [ ] Scenario 3: Sparse-data fallback remains stable

Pass Criteria:

- [ ] AC-1: Forecast method exposure validated
- [ ] AC-2: Determinism in API-level outputs validated
- [ ] AC-3: Edge behavior validated
- [ ] AC-4: Dashboard compatibility validated

Regression Guard:

- [ ] This issue includes or references regression coverage for previously observed failures where applicable.

## Test 11: [T4-E1] Epic-wide dashboard and forecast end-to-end suite

Suggested title: Test: Epic-wide dashboard and forecast end-to-end suite
Parent Epic Issue: #22
Test Scope Type: Epic-wide or Cross-cutting
Parent Feature Issue: _None_
Parent Story Or Enabler Issue: _None_

Related Planning Issues:

- #23 Feature: Monthly dashboard
- #24 Feature: Monthly category targets
- #25 Feature: Simple forward forecast
- #37 Test: Epic-wide dashboard and forecast end-to-end suite

Parent AC IDs Covered:

- AC-1..AC-4 (Feature F4.1)
- AC-1..AC-4 (Feature F4.2)
- AC-1..AC-4 (Feature F4.3)

Test Level: End-to-end

Test Objective:

Validate cross-feature dashboard flow from monthly totals through targets and forecast in one end-to-end suite.

Fixture Requirements:

- Fixture type: Synthetic integrated fixture set spanning all dashboard modules
- Source and sanitization note: Synthetic only

Test Scenarios:

- [ ] Scenario 1: Totals + categories + targets render in one flow
- [ ] Scenario 2: Target update then refresh reflects new values
- [ ] Scenario 3: Forecast values display without breaking dashboard paths

Pass Criteria:

- [ ] AC-1: Cross-feature happy path passes
- [ ] AC-2: Update/refresh behavior passes end-to-end
- [ ] AC-3: Forecast integration path passes end-to-end

Regression Guard:

- [ ] This issue includes or references regression coverage for previously observed failures where applicable.
