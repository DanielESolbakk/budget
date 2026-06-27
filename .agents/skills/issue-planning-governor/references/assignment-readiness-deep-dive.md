# Assignment-Readiness Deep Dive Checklist

Use this checklist during Step 1 Preflight and Step 4 Readiness Gate to verify that issues are truly safe for Copilot assignment. This goes beyond template compliance to ensure implementation clarity.

## Universal Checks (All Issue Types)

### Operationalization: ACs Are Testable, Not Vague

- [ ] Each AC can be tested with a validation command (npm run X, manual step, or assertion).
- [ ] Vague terms are operationalized:
  - "deterministic" → "identical inputs always produce identical outputs regardless of order"
  - "edge cases" → explicitly list (e.g., "missing months, zero values, cross-year transitions")
  - "compatible" → specify the contract or type (e.g., "output type matches MonthSeries interface from #98")
- [ ] Each AC has one clear success criterion, not a list of sub-tasks.

### Test Coverage: Files and Paths Are Real or Explicitly Created

- [ ] Test file paths referenced in "Acceptance Criteria To Test Mapping" either exist OR are listed in Technical Tasks.
- [ ] If test files are new, they are explicitly listed: `- [ ] Create tests/unit/buildMonthBuckets.test.ts`
- [ ] No new test files are listed as Implementation Entry Points (only existing directories/modules).

### Integration Boundary: Output/Input Clearly Specified

- [ ] If the issue produces output, document where it goes (e.g., "output feeds into #100 adapter").
- [ ] If the issue depends on another issue's output, state what format is expected (e.g., "requires MonthSeries type from #98").
- [ ] Cross-issue dependencies in "Blocked by" include current status (e.g., "Blocked by #98 (READY as of 2026-06-21)").

### Blockers Are Current and Non-Circular

- [ ] All blockers in "Blocked by" section are explicitly listed with `- #NUMBER` format.
- [ ] Each blocker is open and relevant (not closed or superseded).
- [ ] No circular blocker chains (A blocks B, B blocks A).
- [ ] Blocker status is current; if blocker was resolved, update the issue immediately.

### Validation Commands Are Sufficient

- [ ] Validation commands are specific and reproducible (not "run all tests" without narrowing).
- [ ] Each AC maps to at least one validation command.
- [ ] Commands will pass only when all ACs are satisfied.

### Test Necessity Decision Is Explicit And Justified

- [ ] The issue explicitly records whether a dedicated test issue is required now.
- [ ] The decision is based on changed functionality, contract, or runtime behavior (not preference).
- [ ] If test issue is required, linked test issue verifies created functionality at the correct pyramid layer.
- [ ] If test issue is not required, issue body contains no placeholder/conditional test language.
- [ ] Decision avoids "tests for tests sake" by tying verification to concrete risk.

---

## Enabler-Specific Checks

### Technical Tasks Are Concrete, Not Requirements

- [ ] "Technical Tasks" section exists (not optional for enablers).
- [ ] Each task is a concrete implementation step:
  - ✅ "Create src/domain/forecast/aggregationAdapter.ts"
  - ✅ "Implement buildMonthBuckets(transactions[]) function"
  - ✅ "Add unit tests for determinism, missing months, zero values"
  - ❌ "Implement aggregation logic" (too vague)
  - ❌ "Output must be deterministic" (this is a requirement, not a task)
- [ ] Each task references a specific file or module.
- [ ] No task contains uncertainty wording ("if needed", "where applicable", "as needed", "or equivalent").

### Stories Enabled Are Feature-Scoped

- [ ] All stories in "Stories Enabled" have the same Parent Feature Issue as this enabler.
- [ ] Related enablers/stories are linked in "Related Planning Issues" (not Dependencies).

---

## Story/Test-Specific Checks

### Test Scenarios Are Explicit

- [ ] "Test Scenarios" section exists with at least 2 concrete scenarios (for Story/Test).
- [ ] Each scenario is a specific, reproducible test case:
  - ✅ "Scenario 1: buildMonthBuckets([tx1_Jan, tx2_Jan, tx3_Feb]) returns {Jan: [tx1, tx2], Feb: [tx3]}"
  - ❌ "Scenario 1: Test with multiple transactions" (too vague)

### Implementation Is Not Left to Inference

- [ ] Technical Tasks (for stories) do not rely on the assignee to infer file creation.
- [ ] If a Story creates a new module, it explicitly lists: `- [ ] Create src/domain/forecast/buildMonthBuckets.ts`

---

## Usage in Skill Workflow

### Step 1 Preflight

Load this checklist for the identified issue type. Review first 3 sections (Universal + type-specific) to identify pre-mutation gaps. If gaps exist, escalate or repair before Step 2.

### Step 4 Readiness Gate

After template validation passes, run the full deep-dive checklist.

**Evidence capture protocol (mandatory):**

- For each deep-dive item marked PASS, include:
  - section heading where evidence appears
  - exact quoted snippet from issue body
  - one-line rationale connecting snippet to the checklist item
- Do not report PASS with generic statements like "looks good" or "is clear" without quoted proof.
- If quoted proof is missing for any item, that item is FAIL and the gate is not complete.

**Gate decision logic:**

- All items checked ✓ → Proceed to Step 5 (FINALIZE)
- Any item unchecked or failed ✗ → Return to Step 2 (REWRITE) or Step 3a (REPAIR)

Do not proceed to finalization if any deep-dive item is unresolved.

## Example: Applying Deep Dive to Issue #99

**Pre-Mutation Gap Detection (Step 1):**

- ✗ Technical Tasks section missing → Needs repair before assignment
- ✗ Test file paths inferred, not created → Repair Step 2
- ✗ "deterministic" not operationalized → Clarify in AC or Tasks

**Post-Mutation Readiness (Step 4):**

- ✓ Technical Tasks added with buildMonthBuckets step and test file creation
- ✓ Test file creation explicitly listed: "Create tests/unit/buildMonthBuckets.test.ts"
- ✓ "deterministic" operationalized: "Same input always produces same output, regardless of transaction order"
- ✓ Integration boundary clear: "Output feeds into #100 adapter"
- ✓ All ACs testable via npm run test:unit

Result: Issue is now safe for Copilot assignment.
