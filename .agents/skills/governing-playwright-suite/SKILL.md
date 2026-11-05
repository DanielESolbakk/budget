---
name: governing-playwright-suite
description: Use when planning, adding, extending, reviewing, merging, or pruning Playwright E2E tests across issues and PRs, or when duplicate coverage, flaky tests, or slow CI suggest suite growth is outpacing user value.
---

# Governing the Playwright Suite

Suggest one plausible target, review its agreed scope, remember the result,
and stop. Suite awareness means targeted comparison, not an automatic suite
audit. No worthwhile changes is a legitimate result.

**REQUIRED SUB-SKILL:** Use `playwright-skill` for review and edits. Read relevant
`core`, `pom`, and `ci` guides once when needed. Preserve privacy, planning,
and approval rules; never duplicate the technique contract here.

## 1. Suggest and agree on one target

With no specified file, run this local-only selector before investigating:

```text
npx --no-install tsx .agents\skills\governing-playwright-suite\review-targets.ts suggest
```

It scans static declarations and history locally. Present `knownFindings`
without rediscovery; otherwise recommend one candidate with signals and prior
review date/outcome. Rank is not proof of redundancy or savings. If nothing
stands out, say so.

Ask for approval before reviewing a suggested target. An explicit file request
already authorizes its bounded review. The selector proposes whole files only
up to ten source cases and 200 lines; otherwise propose a small section before
starting. Do not turn a large file into automatic batches or workers.

## 2. Review directly and keep context local

Record branch/HEAD and dirty scope; start scoped
[history](./target-history.md) before review.

Inspect selected assertions, setup/fixtures/POM, production paths and lower-layer
coverage. Apply [review decisions](./review-contract.md).
Check locators, waits, isolation, cleanup, assertion sensitivity and user value.
Inspect all parameter variants of a reviewed source
case before accepting its coverage.

Search other tests only for a concrete overlap or replacement hypothesis;
read counterparts only far enough to settle it. Reuse unchanged evidence.
Fetch [GitHub evidence](./evidence-acquisition.md) only when a decision needs
authority unavailable locally.

Default reviews use no subagents, repository-wide manifests, SQL ledgers,
CI-history collection or full-suite execution. Native listing, if needed,
targets this file/section only. Broader work requires explicit scope and budget;
do not infer it from "let's go" or an empty findings list.

## 3. Report, remember, stop

Lead with worthwhile findings, "No worthwhile changes found in this scope",
or a specific evidence limitation. Include exact scope, decisive citations,
proposed changes/trade-offs and commands actually run. Keep correctness fixes
separate from efficiency claims; never promise unmeasured savings.

Save actual scope, status, outcome, dependencies and validation in history.
Never mark interrupted work complete or certify a whole file from partial
scope. Source review is not runtime or requirement sign-off.

Return after this target. On a budget limit or unresolved blocker, save partial
progress and return; do not expand or keep trying until the suite is covered.
Another target requires further authorization.

Removals, migrations and merges losing standalone coverage require approval.
After authorized changes, run focused tests and affected lower layers; culls
or shared-harness changes additionally require routine selection and affected
lanes. Preserve teardown/no-network behavior. Optional audited accounting in
the review contract applies only when explicitly requested.
