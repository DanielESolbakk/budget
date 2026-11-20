# SIFO Reference Budget Implementation Handoff

## Scope And Planning Authority

The approved scope compares a household's recorded expenditure and income with
an offline SIFO reference budget, then offers a separate reference forecast
scenario. It belongs to E4 (#22) > F4.3 (#25), as identified by
[the issue catalog](issue-catalog.json). The linked Stories own product behavior;
their Test issues own verification, not missing product implementation.

This handoff records source interpretation and delivery boundaries. It does not
claim product implementation, passing product tests, or complete synchronization
of the wider planning documents. The two roadmap proposals below are not approved
implementation scope and do not expand the existing acceptance criteria.

## Delivery Order And Immediate Owners

| Order | Product Story | Unit Test | Integration Test | Playwright Test | Product blockers |
| --- | --- | --- | --- | --- | --- |
| 1 | [S4.3.11: Configure an offline household SIFO reference budget (#604)](https://github.com/DanielESolbakk/budget/issues/604) | [T4.3.11.1 (#608)](https://github.com/DanielESolbakk/budget/issues/608) | [T4.3.11.2 (#609)](https://github.com/DanielESolbakk/budget/issues/609) | [T4.3.11.3 (#610)](https://github.com/DanielESolbakk/budget/issues/610) | None; owns its implementation |
| 2 | [S4.3.12: Compare household spending and income with SIFO (#605)](https://github.com/DanielESolbakk/budget/issues/605) | [T4.3.12.1 (#611)](https://github.com/DanielESolbakk/budget/issues/611) | [T4.3.12.2 (#612)](https://github.com/DanielESolbakk/budget/issues/612) | [T4.3.12.3 (#613)](https://github.com/DanielESolbakk/budget/issues/613) | #604 |
| 3 | [S4.3.13: Model a separate SIFO reference forecast scenario (#607)](https://github.com/DanielESolbakk/budget/issues/607) | [T4.3.13.1 (#614)](https://github.com/DanielESolbakk/budget/issues/614) | [T4.3.13.2 (#615)](https://github.com/DanielESolbakk/budget/issues/615) | [T4.3.13.3 (#616)](https://github.com/DanielESolbakk/budget/issues/616) | #604 and #605 |

Before broad implementation, #604 owns synchronization of the
[PRD](budget-planner.md), [technical breakdown](technical-breakdown.md),
[implementation plan](implementation-plan.md), [project plan](project-plan.md),
[issue checklist](issues-checklist.md), [catalog](issue-catalog.json), and
[glossary](domain-glossary.md). The new Story/Test keys above still need catalog
entries; use their approved keys and parent relationships rather than inventing
another hierarchy. Reconcile this handoff with those documents in that task.

At assignment time, read live issue bodies, labels and validation results; verify
each `Blocked by` state and existing implementation entry point. Stop on an open
blocker, `planning-invalid`, or missing entry-point infrastructure. Planned new
files are creation tasks, not existing entry points. Tests can accompany their
parent implementation through TDD, but standalone Test assignment requires
delivered product/runtime prerequisites. Deferred Test grooming-label cleanup
does not make a blocked Test assignable.

## Acceptance Criteria And Implementation Boundaries

### Profile And Reference: #604

- [ ] AC-1: Produce itemized original SIFO and separately locally adjusted NOK
  references with inspectable source provenance, rounding, discrepancies and
  childcare charged-month, annual and annualized-monthly amounts.
- [ ] AC-2: Identify missing, unsupported or invalid selections; zero is not
  unknown, and unresolved inputs cannot produce a complete affected reference.
- [ ] AC-3: Persist household-isolated profiles and local adjustments through
  restart and compatible backup/restore. Cancel and failed saves preserve prior
  settings, transactions, budget targets and the incumbent forecast.
- [ ] AC-4: Explain national coverage, local-price assumptions, long-term
  provisioning and exclusions in keyboard-accessible setup before reference use.

Save calculation age bands and explicit source-table selections, not names,
exact birth dates, inferred demographics or guessed income-tier eligibility.
Use additive persistence and preserve legacy snapshots without SIFO settings.

### Actual Expenditure And Income: #605

Use the live Story's ACs and Test mappings as the delivery checklist:

- Map stable category IDs to SIFO consumption, other expenditure, income, or
  excluded transfers/refunds. Do not infer financial meaning from category names.
- Count allocations once and conserve transaction amounts. Show positive
  consumption credits separately rather than silently netting them from gross
  debit spending; not every credit is income.
- Reuse dated local FX conversion and coverage evidence. Missing FX, coverage or
  unresolved amounts prevent a complete overall indicative reference remainder.
- Initially compare calendar months only, without changing the saved payday
  reporting preference or silently prorating reference amounts.
- Indicative reference remainder is classified booked income minus selected
  reference consumption minus classified other expenditure. It is not verified
  salary, a complete household budget or guaranteed spendable cash.

### Separate Reference Scenario: #607

Use the live Story's ACs and Test mappings as the delivery checklist:

- Preserve the existing three-month horizon and fix the selected reference
  edition, profile and original/adjusted basis for that scenario.
- Replace comparable consumption once. Explicit income and other costs remain
  separate; do not subtract both a reference provision and an overlapping cost.
- Identify obligation overlap by identity/evidence, not matching amounts alone.
  Ambiguous overlap or an undecomposable baseline makes the result incomplete.
- Do not invent dated cash events or opening balances from monthly provisions,
  or automatically apply birthdays, inflation or household changes.
- Keep actuals, saved profile/adjustments/mappings, commitments, loan evidence,
  checkpoints, budget targets and baseline read-only.

Reuse delivered cashflow composition from #374. Future mortgage planning
#553/#569 and refund linking #369 are not prerequisites for this scope.

## Authoritative Source And Arithmetic

Use the [official 2026 publication](https://hdl.handle.net/11250/5517284) and its
[Norwegian workbook](https://api.nva.unit.no/publication/file/01a1fad8d353-bf88915a-c8bc-4b1c-b900-6cb4ae3d5aa6),
`Referansebudsjettet_2026_Norsk.xlsx`, attributed to SIFO / OsloMet under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

- Research inspection date: 2026-11-20; worksheet XML inspected without executing
  macros. SHA256:
  `961bb09dfa58e2fbcfb1c16bc894ec4065ee1e3a1fbefd32fc7a3ef0695335c8`.
- Treat `Individspes. utgifter 2026` and `Husholdsspes. utgifter 2026` as rate
  authority. Preserve conflicts in `Eksempelfamilie 2026` as discrepancy records;
  do not change rates to force example-sheet parity.
- #604 must complete and verify numeric extraction, recording edition, source
  URL, license/attribution, checksum, extraction date and cell/table provenance.
  Bundle the verified dataset locally; no runtime website/calculator or downloads.
- Round each source rate displayed as whole NOK half-up to NOK before multiplying
  by 100: `1119.8 -> 1120`, `1140.1600000000001 -> 1140`,
  `5104.7700000000004 -> 5105`. Use safe integer minor-unit arithmetic thereafter.
- Respect category-specific age/sex bands, household articles/furniture counting
  from age three, and published person counts 1-7. Do not silently extrapolate.
  The food-only 12% economy requires an explicitly eligible couple with more than
  two children; household count alone is insufficient.
- Childcare uses an explicit tier/local charge and integer paid-month count
  0-12. Calculate annual charge first, then divide by 12 and round half-up to
  minor units only at the monthly-result boundary. `1200 * 11 = 13200` per year
  gives a monthly provision of `1100`, not twelve charged months.
- Keep original SIFO and separately labeled local transport/childcare references.
  Local amounts replace selected components, never add to those same originals.
  Identify Oslo/Ruter assumptions without portraying SIFO as Oslo-only or
  inferring prices/eligibility from a household's location or income.

Reconciliation example: woman/man 30-50, girl 11, boy 5, two adult transit passes
and one fossil car produce individual `28543` plus shared `8895` =
`37438 NOK/month` before childcare. The example sheet instead says `37358`
because its clothing values conflict with rate tables. With `1200 * 11`
childcare, the reference is `38538/month` and `462456/year`. Retain both the
verified result and the source discrepancy in synthetic test evidence.

## Coverage Caveats That Affect Implementation

SIFO is a national acceptable-consumption reference for established households,
not average spending, an income benchmark, poverty threshold or spending ceiling.
Its long-term monthly provisions do not prove money has actually been saved.

- Excluded: housing/electricity/maintenance, alcohol/tobacco, holidays/nightlife,
  expensive equipment-intensive hobbies, and healthcare beyond included annual
  GP/dentist consultations.
- Car provisions include operating costs, insurance and tolls, but not purchase
  loans or depreciation. Published assumptions use 10000 km/year for 1-4 persons
  and 15000 for 5-7, with public transport for commuting. Avoid double-counted
  insurance/tolls and total-ownership-cost claims.
- Household media/leisure includes contents insurance, internet, TV and streaming.
  Contents insurance is not automatically excluded as a generic housing cost.
- Infant basic equipment is provisioned over six months before birth, attributed
  by the source to the pregnant mother; supplementary equipment over the first
  year. Verify explicit source selections, not inferred due dates or cash events.
- Furniture covers movable furniture/inventory, not fixed installations.
- Linked explanatory articles can retain older figures/rules despite newer
  timestamps or tables. Rate tables remain calculation authority.

## Architecture, UX And Verification Handoff

Keep the [existing stack/runtime boundary](adr-001-stack-and-runtime-boundaries.md).
Shared contracts belong in `src/shared/sifoContracts.ts`; deterministic reference,
comparison and scenario calculation belong in `src/domain/`. Planned modules are
`src/domain/budget/sifo2026.json`, `sifoReferenceBudget.ts`, `sifoComparison.ts`,
and `src/domain/forecast/sifoScenario.ts`. Application composition belongs in
`src/app/sifoComparisonService.ts` and `src/app/sifoScenarioService.ts`, with
profile persistence in `src/app/backup/sifoRepository.ts`.

Extend the existing reports IPC responsibility group, not `electron/main.ts`;
main retains service/database lifecycle ownership. Renderer sections present
results and own drafts, not calculations or persistence. Reuse shared logic in
the complete typed synthetic browser `BudgetApi`; do not build a second financial
engine or hide missing methods behind proxies/assertions.

Reuse existing cards, forms, amount formatting, disclosures and saving/error/focus
patterns. Keep source and completeness visible without red/green spending
judgment. Validate keyboard/focus/live-status behavior at 1280x800 and 390x844,
including 200% zoom without page-level horizontal overflow. Impeccable is opt-in;
Playwright remains functional-only under the canonical skill and core/ci/pom
guides, with no screenshot or pixel assertions.

The existing Test issues explicitly own creation of these files and commands:

| Owner | Planned validation command |
| --- | --- |
| #608 | `npm run test:unit -- tests/unit/sifo-reference-budget.test.ts` |
| #609 | `npm run test:integration -- tests/integration/sifo-profile-persistence.test.ts` |
| #610 | `npm run test:e2e:playwright -- tests/playwright/sifo-profile.spec.ts` |
| #611 | `npm run test:unit -- tests/unit/sifo-comparison.test.ts` |
| #612 | `npm run test:integration -- tests/integration/sifo-comparison-service.test.ts` |
| #613 | `npm run test:e2e:playwright -- tests/playwright/sifo-comparison.spec.ts` |
| #614 | `npm run test:unit -- tests/unit/sifo-scenario.test.ts` |
| #615 | `npm run test:integration -- tests/integration/sifo-scenario-composition.test.ts` |
| #616 | `npm run test:e2e:playwright -- tests/playwright/sifo-scenario.spec.ts` |

Also run `npm run typecheck` and `npm run verify:no-network` as applicable.
These future test-file commands are plans, not executed or passing evidence.
Use synthetic Norwegian-representative source cases, isolated SQLite databases,
legacy/current snapshots, and 10K+ transaction conservation/FX cases. Cover
boundaries, zero-versus-unknown, local replacements, cancel/failure and unchanged
baseline/actuals. Do not commit workbooks, private statements, databases or PII;
financial content must remain local, with no telemetry or external processing.

## Roadmap Proposals: Not Approved Or Assignable

Deliver the three approved Stories first. These two researched opportunities need
separate owner approval and concrete implementation/Test planning before work:

1. **Annual/rolling-12-month comparison.** Longer-period actuals would better
   contextualize lumpy furniture/equipment purchases against long-term provisions.
   Decide calendar-year versus rolling windows, partial coverage, edition/profile
   changes and any proration explicitly. This is beyond #605's monthly scope.
2. **Durable-purchase savings reserves.** Optional user-set replacement goals and
   starting balances could turn a reference allowance into a savings plan.
   Distinguish recommended provision from money actually saved, preserve recorded
   balances, and prevent double deductions with reference/scenario costs. This is
   beyond #607 and does not authorize automatic transfers or target changes.

No Story/Test hierarchy, reserved scenarios or implementation assignment is
created for either proposal by this document.

## Supporting Public Research

- [SIFO reference budget, category notes, tips and archive](https://www.oslomet.no/om/sifo/referansebudsjettet/)
- [2026 family-cost example](https://www.oslomet.no/forskning/forskningsnyheter/sifo-sitt-referansebudsjett-manadlege-utgifter-opp-med-610-kroner-for-smabarnsfamilien/)
- [Budgeting and long-term provisions](https://www.oslomet.no/forskning/forskningsnyheter/viktigere-enn-pa-lenge-a-sette-opp-budsjett/)
- [Life-stage examples; narrative explicitly undergoing revision](https://www.oslomet.no/forskning/forskningsnyheter/barna-koster-deg-ulike-livsfaser/)

Future historical-edition work must distinguish source date/version as well as
year: the archive contains multiple editions within some years. The 2026 changes
include basket revisions as well as repricing/CPI updates, so an edition difference
must not be described automatically as pure inflation.
