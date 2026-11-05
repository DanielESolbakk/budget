# Evidence Acquisition and Tracing

Read this when a review decision needs GitHub or requirement/code evidence.
Start substantive test review first; obtain only the context that affects the
selected target and reuse it across cases. Acquisition is read-only unless
writes are separately authorized. Never send transaction content externally.

Normal reviews do not collect a repository-wide issue graph or CI history.
Read this reference only when a specific decision needs external authority or
logs. Reuse unchanged fetched context; do not repeat the same reads per case or
start another target while resolving this one. Missing live authority limits
the affected proposal, not independent source-backed findings.

## 1. Discover capabilities by operation

Respect the environment's GitHub tool preference, but determine actual
capabilities rather than assuming a provider's availability or authentication.
For deferred MCP tools, search for issue/PR reads, relationship/search operations,
and Actions jobs/artifacts as needed. Inspect returned schemas before calls;
provider names and signatures vary. Do not invent tool names or arguments.

Start with a small read against the known repository and relevant issue or PR.
Track issue reads, PR reads, job metadata, logs, and artifacts separately.
A successful public read proves that operation worked, not private access,
authenticated identity, write permission, or access to every GitHub service.
Likewise, an unauthenticated `gh` session says nothing about MCP credentials.

Record provider/operation, resource/ref, fetched time, observed result/error,
source citation, and affected claim once per shared source. Discovered or
planned calls are not verified reads. Never record credentials or sensitive
payloads.

### Bounded recovery

| Observed outcome | Action |
|---|---|
| Schema/argument mismatch before execution | Inspect schema and correct the call once; do not classify it as failed authentication. |
| Header/transport/provider failure | Do not invent header parameters or retry unchanged. Inspect the error and try one suitable already-authorized alternate read route if available. |
| 401/403 or restricted content | Record the affected resource and access limit. Do not bypass controls, extract credentials, change authentication, or try to defeat content exclusion. Continue independent authorized reads. |
| Missing tool or unsupported operation | Discover a suitable alternative capability once; otherwise mark that operation unavailable. |
| Empty/partial response | Check filters, pagination, and resource/version before interpreting absence as no evidence. |

Use at most one justified correction and one suitable alternate route for the
same failed operation. Stop unchanged retries. An Actions failure does not
establish that issue/PR reads fail: discover and probe those independently.
Report a precise owner action only when needed; never ask repeatedly for an
impossible sign-in/submission step. Local analysis continues where sufficient.

## 2. Collect the relevant issue/PR graph

Start from the audit scope, current issue/PR, test references, and the local
`docs/ways-of-work/plan/budget-planner/issue-catalog.json`.
Derive catalog relationships from keys and parent keys; resolve them to live
GitHub numbers. Neither a copied issue chain nor the catalog alone proves
current GitHub alignment. Record unresolved mappings rather than inventing IDs.

Resolve the owning Epic/Feature, relevant Stories/Enablers, linked Tests and
blockers as each reviewed journey needs them. Include siblings sharing that
journey or runtime seam. Inspect relevant linked/closing PR decisions and diffs;
compare merge/head ancestry with the audited checkout before claiming delivery.

Use targeted queries and small pages (normally 5-10 records); deduplicate by
repository and number. Include closed records when they explain existing tests.
Expand only references that affect a coverage/cost decision. Stop when those
relationships are resolved or explicitly marked unread/inaccessible, not after
the current issue alone or an arbitrary first page. Avoid crawling the backlog.

Keep a shared source index: catalog key, issue/PR URL, role, current state/labels,
relevant AC/decision, fetched/updated time, and live/cached/conflicting/unavailable
status. Check substantive validation/scope comments and blocker state when
relevant. Closed prerequisites do not establish runtime seam availability.

Fetch substantive comments when they contain validation or changed scope.
Do not treat closed issues/PRs as proof of passing tests or approval of every
current assertion. Preserve provenance for stale PR-body snippets and cached
issue text. Surface conflicts among live issues, catalog, approved plans/design,
merged changes, and code; implementation alone does not redefine intent.
Block only conclusions needing that unresolved authority or missing source.

## 3. Trace user goals through real implementation

For each audited journey and proposed coverage reduction, document:

**User goal and failure consequence -> authoritative requirement -> production
path -> test setup/assertion -> overlapping or replacement protection.**

Use available symbol/semantic tools, then narrow file searches. Follow the
actual implementation rather than issue-proposed paths that may be stale.
For Electron flows, inspect the relevant renderer state/event, preload contract,
main-process IPC validation, service/domain behavior, persistence boundary, and
durable readback where applicable. Mark genuinely absent boundaries not
applicable with a reason; do not invent HTTP APIs or require persistence for
pure presentation behavior.

Record source path/line/symbol plus audited commit or dirty-worktree scope for
each link. POMs and headings are supporting evidence, not proof of the complete
production path. Identify the concrete assertion that detects the user-visible
failure and explain the actual boundary exercised by lower-layer tests.
Compare state, source format, triggers, error paths, and persistence effects,
not titles or file naming.

For example, distinguish preview from Confirm, cancellation from submission,
and a parsed total from a persisted ledger result. If one issue promises
auto-save while current code and another Test require explicit Confirm, record
the conflict, inspect relevant live decisions/PRs, and defer that semantic
judgment. Independently verified defects can still be proposed.

## 4. Close with scoped evidence

Return citations to the shared source index, unresolved links and affected
claims, plus actual acquisition results. Use the governing skill's compact
group handoff; do not repeat the entire issue graph or every source field for
each expanded case.

Plans to retrieve evidence are not retrieval results. Missing retry artifacts
leave flakes and per-test costs unknown; they do not erase local source facts.
Conversely, accessible source code does not establish live issue state.
Do not declare a whole-suite requirement audit complete with unresolved
material requirement/code links. State the bounded reviewed scope instead.
