# Review Decisions and Handoff

Read this before the first source-review batch. Review user value and test
implementation separately; uniqueness alone does not justify keeping a case.

## Review the behavior

For each source-test group, read the test and supporting production path,
fixtures, helpers/POMs, and relevant lower-layer assertions. Identify the user
goal, plausible regression, and assertion that detects it. Similar names or
different viewports do not prove equivalence or unique value.

Preserve renderer-only keyboard/accessibility, financial display,
confirmation/error, persistence/restart, recovery, and privacy risks where
required. A text assertion can protect amounts, signs, currency, warnings, or
accessible names; exact cosmetic constraints may instead be retirement
candidates. Trace obligations as described in the evidence guide.

| Decision | Evidence needed |
|---|---|
| Keep | Concrete user consequence and suitable layer/implementation; defend the strongest alternative. |
| Fix / streamline | Valuable behavior with defective waits/assertions/locators, wasted setup, poor cleanup/isolation, or unjustified fixture/POM complexity. Preserve the behavior. |
| Deduplicate / merge | Exact surviving assertion and equivalent state, format, trigger, viewport, and error/persistence path. Merge only one coherent behavior. |
| Move layer / lane | Equivalent lower-layer protection, or explicit reduced blocking coverage with an approved runnable alternative lane. Missing infrastructure blocks migration, not the audit. |
| Retire | Constraint intentionally no longer enforced; evidence of low value/obsolete intent and precise protection loss. No equivalent survivor is claimed or required. |
| Unresolved | Specific missing evidence or conflicting authority and next action, not permanent keep. |

Check active AC/design/accessibility requirements and historical regression
intent before retirement. Missing traceability is uncertainty, not proof of
no value. Retiring sole protection of an active obligation requires an approved
scope/design decision. Split mixed-purpose tests into assertion-level decisions.

For a defended keep, name a realistic regression the assertion would catch.
Current CSS or rendering code is not approval of an exact style constraint.
Different background colors do not prove prominence or contrast; a fixed gap
does not prove readable hierarchy. If only implementation constants support
the constraint, report an unresolved/conditional candidate rather than calling
it an active requirement. Preserve any independently valuable functional checks.

Use unit tests for deterministic logic, integration for import/persistence/IPC
contracts, and E2E for critical real desktop journeys. Do not invent HTTP APIs,
mock the application under test, or share mutable Electron/database state to
make tests cheaper. Verify source-format differences; binary PDF and text
statement fixtures/captions are not interchangeable.

## Single-target closeout

Default reviews are direct and bounded. Read this decision guidance once;
do not spawn workers or build a whole-suite ledger to fill the report.
Identify the approved file/section and actual inspected cases/variants.

Return:

1. Exact reviewed scope; partial/blocked work and concrete reasons.
2. Findings with decision, detecting assertion, decisive test/production
   citations, strongest alternative or loss, and confidence. Summarize defended
   keeps when no worthwhile change is found; no giant per-case record is needed.
3. Shared fixture/requirement references once; variant differences explicitly.
   Group only variants whose assertions/setup were inspected.
4. Commands actually run/results and omissions; separate listing from execution.

Example shape (IDs/citations are supplied by the actual assignment):

| Group | Decision | Evidence / consequence |
|---|---|---|
| G1 | Keep | Focus assertion protects Confirm access; numeric parsing does not. |
| G2 | Conditional retirement | Exact spacing constraint; requirement/history unresolved. |

Check assertions, evidence and alternatives before declaring source review
complete. Generic "no survivor", a title/location or claimed totals are
insufficient. Record the scoped outcome through the local history helper.
Source review does not approve a proposed change or certify runtime passing.

## Optional audited accounting

Only use this section when the user explicitly requests structured accounting.
Normal single-target reviews do not require manifests, accepted-review JSON or
SQL. Scope any requested ledger to the agreed selection; listing/assignment is
not reviewed evidence.

Persist accepted rows, including directly reviewed work, in session storage.
Use this shape (illustrative IDs and citations; replace with actual evidence):

```json
{
  "snapshot": "audited-head-and-dirty-scope",
  "accepted_reviews": [{
    "group_id": "G1",
    "decision": "keep",
    "regression": "A saved correction disappears after restart.",
    "assertion": "After restart, the category control has the saved value.",
    "test": "tests/playwright/example.spec.ts:20",
    "production": "src/app/example.ts:30",
    "alternative": "Parsing units do not exercise renderer restart/readback.",
    "confidence": 8
  }]
}
```

Decisions: `keep`, `fix-streamline`, `deduplicate-merge`, `move-layer-lane`,
`retire`, `unresolved`. Shared evidence may be cited by a resolved source-index
reference. Use unresolved for a source-reviewed assertion awaiting specific
authority; unread assertions remain pending and never enter `accepted_reviews`.
Missing live issue access alone does not block a source-backed keep/fix decision.

The manifest has the same `snapshot` and a non-empty `groups` array, each with
`group_id` and non-empty `expanded_ids`, derived from verified native discovery.
Run the bundled [verifier](./verify-review.ts) from the repository root:

```text
npx --no-install tsx .agents/skills/governing-playwright-suite/verify-review.ts <manifest.json> <accepted-reviews.json>
```

It derives counts and pending IDs from accepted rows, rejecting duplicates,
unknown groups, mismatched snapshots and incomplete records. Exit 1 means
incomplete coverage or invalid input; inspect stdout/stderr. Do not replace it
with sums of assignments or manually entered reviewed totals. JSON field
presence cannot prove substantive reading: parent acceptance remains necessary.
`sourceReviewComplete` concerns source coverage only; `unresolvedGroups` still
preclude sign-off of the affected requirements.

## Optional runtime investigation

Collect runtime evidence only for an explicitly requested performance analysis
or a concrete failure needing logs. Reuse already available timings first;
normal target selection and source reviews do not fetch five CI runs.

Read available per-test/step durations and shared fixture launch/setup/teardown,
retry and artifact costs. Identify which costs actually affect wall time;
parallel durations cannot simply be summed. Start deeper efficiency review
with the largest attributable costs, not the easiest tests to merge.

Use five comparable successful CI runs when available; report sample size and
median/range. Compare environment, workers, filters, workload and retry policy.
Changing test counts provide historical context, not a controlled benchmark.
Compare approved edits before/after under controlled conditions.

For each recommendation state evidence, likely benefit, isolation/diagnostic
trade-offs and confidence. Call savings unknown when unmeasured; fewer cases
alone are not a performance improvement. Meaningful correctness fixes need no
speedup justification. Missing timings do not block source-backed proposals,
but do not turn weak overlap into a worthwhile efficiency recommendation.

## Approval and completion

Propose counted changes with risks, confidence, triangle impact, surviving or
relinquished protection, and measured/unknown savings. Await explicit approval
before removals, retirement, migration, merges that remove standalone cases,
or CI selection/reliability changes. Normal authorized additive work proceeds.
Missing timing does not prevent an otherwise supported proposal.

Add missing replacement protection before coverage-preserving reductions.
Never silently skip/quarantine, weaken assertions, or increase retries/timeouts
to manufacture success. Alternative lanes need runnable automation and
ownership; disclose reduced blocking coverage.

Before a no-findings verdict, account for the entire agreed target scope and
explain the strongest applicable deduplication, retirement, cheaper-layer,
reliability, and setup-cost candidates rejected. No finding quota applies.
For preserved protection, name the assertion that would fail for the relevant
regression; for retirement, name the accepted loss. Passing suites alone prove
neither equivalence nor necessity.
Do not expand the scope to find something else. Partial scope cannot support
a whole-file or whole-suite verdict.

Lead with "No high-value wins found" when supported, then briefly name the
strongest rejected candidates and why. Do not offer marginal changes or imply
another audit will reveal savings. If evidence is insufficient, state that
specific limitation instead of declaring either a clean suite or hidden wins.
