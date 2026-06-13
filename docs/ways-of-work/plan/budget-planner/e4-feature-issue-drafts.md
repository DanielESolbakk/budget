    # E4 Feature Issue Drafts

    Use these as issue body updates for E4 features. They are AC-ID-first and written for Copilot execution.

    Notes:

    - `issue-traceability-lint` requires feature issues to include at least one test issue reference (for example `#123`) in `Test Issues In This Feature`.
    - Replace `#TBD` placeholders with real issue numbers before saving in GitHub.

        ## F4.1 / Issue #23: Monthly dashboard

        Catalog key: F4.1
        Type: Feature
        Source: docs/ways-of-work/plan/budget-planner/issue-catalog.json

        Parent Epic Issue:

        - #22

        Feature Description:

        Deliver a minimal but reliable monthly dashboard that shows household monthly totals and category-level spending breakdown, with month selection.

        User Stories In This Feature:

        - [ ] As a household user, I want to see total income, total expenses, and net cashflow for a selected month so that I can quickly assess my financial position.
        - [ ] As a household user, I want to see category-level spending for a selected month so that I can identify overspending areas.
        - [ ] As a household user, I want to switch between months so that I can compare how spending changes over time.

        Technical Enablers:

        - [ ] #36 Enabler: Aggregation and forecast query layer

        Test Issues In This Feature:

        - [ ] #73 Test: Monthly totals contract integration
        - [ ] #74 Test: Category breakdown contract integration
        - [ ] #75 Test: Dashboard render and month-switch smoke
        - [ ] #81 Test: Feature-level dashboard integration pack

        Dependencies:

        Blocks:

        - #24

        Blocked by:

        - #36

        Acceptance Criteria:

        - [ ] AC-1: Dashboard API returns monthly totals for income, expense, and net values for the selected month.
        - [ ] AC-2: Dashboard API returns category-level totals for the selected month with deterministic ordering.
        - [ ] AC-3: Renderer shows monthly totals and category breakdown without runtime errors for valid fixtures.
        - [ ] AC-4: Changing selected month refreshes totals and categories consistently.

        Acceptance Criteria To Test Mapping:

        - AC-1 -> Integration: dashboard totals contract test
        - AC-2 -> Integration: category aggregate contract test
        - AC-3 -> E2E/Smoke: dashboard page render test
        - AC-4 -> Integration/E2E: month switch refresh test

        Estimate:

        8 points

        Split Signal:

        Split this feature if charting or visualization complexity starts dominating backend contract delivery; keep v1 focused on data correctness and a minimal UI.

    ---

    ## F4.2 / Issue #24: Monthly category targets

    Catalog key: F4.2
    Type: Feature
    Source: docs/ways-of-work/plan/budget-planner/issue-catalog.json

    Parent Epic Issue:

    - #22

    Feature Description:

    Enable users to define and maintain monthly category targets, persist targets locally, and surface target-versus-actual values in dashboard data.

    User Stories In This Feature:

    - [ ] As a household user, I want to set a monthly target amount per category so that I can control planned spending.
    - [ ] As a household user, I want saved targets to persist between app sessions so that I do not need to re-enter budgets every month.
    - [ ] As a household user, I want to see actual-versus-target values in monthly dashboard data so that I can detect over or under budget categories.

    Technical Enablers:

    - [ ] #36 Enabler: Aggregation and forecast query layer

    Test Issues In This Feature:

    - [ ] #76 Test: Category target CRUD and persistence integration
    - [ ] #77 Test: Target-vs-actual integration and refresh
    - [ ] #82 Test: Feature-level category target integration pack

    Dependencies:

    Blocks:

    - #25

    Blocked by:

    - #36

    Acceptance Criteria:

    - [ ] AC-1: API allows create, update, and read for monthly category targets.
    - [ ] AC-2: Target updates persist locally and are returned after reload.
    - [ ] AC-3: Dashboard data includes target values and delta-to-target per category.
    - [ ] AC-4: Updating a target is reflected on refresh without inconsistent stale values.

    Acceptance Criteria To Test Mapping:

    - AC-1 -> Integration: target API contract test
    - AC-2 -> Integration: persistence and reload test
    - AC-3 -> Integration: dashboard target-value contract test
    - AC-4 -> E2E/Smoke: update target and refresh flow test

    Estimate:

    8 points

    Split Signal:

    Split this feature if target management needs advanced policy (for example rollover, carry-over, or target history) beyond basic monthly target CRUD.

    ---

    ## F4.3 / Issue #25: Simple forward forecast

    Catalog key: F4.3
    Type: Feature
    Source: docs/ways-of-work/plan/budget-planner/issue-catalog.json

    Parent Epic Issue:

    - #22

    Feature Description:

    Provide a deterministic near-term forecast (initially simple moving average approach) consumable by dashboard workflows.

    User Stories In This Feature:

    - [ ] As a household user, I want a simple 3-month forecast of spending and income trends so that I can anticipate near-term cashflow.
    - [ ] As a household user, I want forecast output to be deterministic for the same input data so that I can trust and reproduce results.
    - [ ] As a household user, I want forecast assumptions clearly documented so that I understand what the forecast means and does not mean.

    Technical Enablers:

    - [ ] #36 Enabler: Aggregation and forecast query layer

    Test Issues In This Feature:

    - [ ] #78 Test: Forecast algorithm unit edge cases
    - [ ] #79 Test: Forecast API and dashboard contract integration
    - [ ] #80 Test: Feature-level forecast integration pack

    Dependencies:

    Blocks:

    - None

    Blocked by:

    - #36

    Acceptance Criteria:

    - [ ] AC-1: `src/forecast/simpleForecast.ts` computes a documented deterministic forecast method (initially 3-month moving average).
    - [ ] AC-2: Forecast API returns reproducible values for identical fixtures.
    - [ ] AC-3: Unit tests cover sparse history, zero values, and missing-month edge cases.
    - [ ] AC-4: Dashboard data contract can include forecast values without breaking existing monthly totals paths.

    Acceptance Criteria To Test Mapping:

    - AC-1 -> Unit: simple forecast algorithm test suite
    - AC-2 -> Integration: API reproducibility test
    - AC-3 -> Unit: edge-case tests for sparse, zero, and missing-month inputs
    - AC-4 -> Integration/E2E: dashboard forecast contract smoke test

    Estimate:

    5 points

    Split Signal:

    Split this feature if forecasting expands into scenario planning, user-defined assumptions, or non-deterministic models.
