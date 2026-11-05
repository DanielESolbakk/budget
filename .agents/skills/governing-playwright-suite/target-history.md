# Target Selection and Local History

Run the bundled helper through `npx --no-install tsx`, from the repository root.
It uses installed TypeScript to inspect source declarations locally, without
network access, Electron execution or LLM workers. History is stored at
`local/playwright-review-history.json`, already gitignored, and created only
when a review starts. Suggestions never mark anything reviewed.

## Suggest

```text
npx --no-install tsx .agents\skills\governing-playwright-suite\review-targets.ts suggest
```

Output contains at most three candidates, three unchanged recorded findings,
and three `limitations`, with `limitedScopes` counting all limitations.
Report limitations explicitly: no candidates alongside unresolved limitations
is not a no-findings result.
Present a recorded finding as a known action candidate instead of rediscovering
it. Otherwise recommend one review target. Signals include fixed
waits, CSS/geometry checks, repeated static titles and short cases. Rank uses
signal density within the proposed scope, not file-wide totals. Sections begin
at a signal-bearing case and contain at most 200 lines and five source cases
(ten for files with at most ten declarations). Whole files also require at most
200 lines. A source case larger than this limit produces a limitation, not an
automatic review scope; consult its history and agree on an explicit bounded
assertion section. These are hypotheses:
short assertions can protect important behavior and repeated titles can be
parameter variants. `declaredCases` counts source declarations, not expanded
Playwright executions. Alias-based registrations may need explicit inspection.
Cached timing evidence can inform a recommendation; do not collect CI history
just to select a file.

Completed, unchanged scopes are excluded using spec and known-dependency hashes.
Review order is start order in the append-only history. Complete reviews are
considered newest-first: stale overlapping evidence blocks reuse of older
records. An older full-case review remains reusable only when newer overlapping
reviews are also unchanged. A subsection alone cannot certify an enclosing case.
Newer completed scopes supersede old findings even if their own evidence later
becomes stale; never fall back to an obsolete proposal. Fully superseded findings
are omitted, disjoint findings remain, and partial supersession produces a
limitation requiring confirmation of any remaining actions. Records are retained.
Missing or changed dependencies invalidate reuse. Old dates alone do not prove
staleness; hashes alone cannot
certify unknown dependencies or changed requirements. Existing unrecorded
reviews are unknown, not proof the file was never inspected. Do not import
earlier "all done" claims as completed records.

## Start after scope approval

Save a request JSON in ignored/session scratch, using the approved selector
scope or explicit bounded scope:

```json
{
  "file": "tests/playwright/example.spec.ts",
  "scope": { "label": "correction display cases", "startLine": 20, "endLine": 85 }
}
```

```text
npx --no-install tsx .agents\skills\governing-playwright-suite\review-targets.ts start <request.json>
```

Keep the returned ID. The helper records UTC start time, exact scope, spec hash
and the shared Electron fixture hash when present, with `in-progress` status.
A cancelled session therefore leaves visible unfinished work.

## Finish and stop

Save a finalization request:

```json
{
  "id": "ID returned by start",
  "status": "complete",
  "outcome": "no-change",
  "summary": "Inspected selected assertions; no justified reduction.",
  "dependencies": ["src/renderer/example.tsx"],
  "validation": ["Source review only; no test bodies executed."]
}
```

```text
npx --no-install tsx .agents\skills\governing-playwright-suite\review-targets.ts finish <request.json>
```

Final statuses: `complete`, `partial`, `blocked`, `interrupted`.
Outcomes: `no-change`, `findings`, `unknown`; complete requires a known outcome.
Record actual inspected source/helper paths, not a speculative dependency graph,
and exact validation commands/results or omissions. Findings are not approval
to change coverage. Reuse recorded findings instead of rediscovering them.

Completion is rejected if the target or initially captured fixture changed
during review. Completed records cannot be overwritten by another finalization.
Atomic writes and an exclusive write lock protect history updates. Invalid
JSON/schema, missing sources and write conflicts produce explicit errors:
preserve history, report the affected operation, and stop rather than reset or
retry blindly. An abandoned lock needs owner inspection, not automatic removal.
