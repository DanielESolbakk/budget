# Assignment Workflow

Use this runbook with [../SKILL.md](../SKILL.md). The skill's decision contract is authoritative; this file defines the evidence and response procedure.

## Inputs and Source

Required: repository owner and name. Optional: issues to exclude and an explicit focus slice. Use GitHub MCP as the source of truth for open issues, issue bodies/labels/comments, PRs, branches, commits, and committed files. If owner or repository name cannot be established, retrieve it through GitHub MCP before constructing issue links.

- For broad discovery, list open issues by planning labels (`feature`, `user-story`, `enabler`, `test`), paginate, deduplicate, and record count plus newest `updated_at`.
- `Data Freshness` is the maximum `updated_at` across the full candidate set, not the selected issue's timestamp.
- For targeted searches, call `mcp_github_mcp_se_get_me` first. Use list tools for broad candidate discovery.
- Do not inspect GitHub through browser navigation or automation. A missing issue-linked PR is not a blocker or proof of completion.
- Resolve the full default-branch `BASE_SHA` through GitHub MCP. Never substitute `main`, `origin/main`, a dirty checkout, or the system date. If the shared SHA cannot be resolved, stop and escalate.

## Bounded Parallel Audit

- Keep the backlog census exhaustive but lightweight. For each planning-label list, request only issue number, title, state, labels, assignees, and `updated_at`; paginate each label to completion, deduplicate, and compute the full-inventory count and newest timestamp. Fetch bodies/comments after the value-based shortlist, not for every issue.
- Resolve `BASE_SHA` once and reuse that exact hash for every candidate's source/tree audit and any validation claim. Share it with every read-only delegate; never let delegates resolve different branch tips independently.
- Batch independent GitHub reads with `multi_tool_use.parallel`: first pages for distinct planning labels, bodies/comments for already identified candidates and parents, and deduplicated source paths after issue bodies reveal them. Follow cursor-dependent pages sequentially and do not fetch unrelated paths.
- When at least three plausible, independent candidate groups remain and subagents are available, delegate read-only audits to at most three subagents. Give each disjoint candidates, the shared `BASE_SHA`, project-value evidence, and a required result of criterion matrix, parent/Test readiness, blocker/entry-point findings, and exact evidence links. Prohibit issue edits, assignment, and unverified completion claims.
- Keep shared backlog counting, final value ranking, cross-candidate comparison, governance classification, validation claims, and GitHub mutations with the coordinator. Reuse candidate and file evidence already returned; do not repeat the same issue/path audit. A delegate's local test result is usable only when its checkout is verified at the shared `BASE_SHA`; otherwise report `not run`.
- Parallelism changes elapsed time, not coverage: audit every plausible equal- or higher-value alternative before selecting an assignment. Stop lower-value audits only after those candidates are excluded by direct evidence or the higher-value preparation-only route is explicit.

## Candidate Set

For a new assignment, exclude every currently assigned or in-progress issue, including one with confirmed work remaining. Do not recommend an already-assigned issue as a new Copilot assignment; its existing assignment must be resolved separately. A recent update is evidence to check for active work, not a reason to discard an older unassigned candidate. If no explicit focus slice was supplied, audit the active slice first but continue across the full backlog when it has no eligible candidate.

## Value And Sequencing

Establish project value before comparing assignment readiness:

1. Record direct value evidence from the user's stated goal, roadmap rank, launch exit criteria, issue priority, or a documented dependency/critical path. Issue recency, an open test deliverable, and source-code symbols are not value evidence by themselves.
2. If a high-value Feature owns the outcome, identify the immediate Story or Enabler that owns the remaining implementation. Do not substitute a Test issue for missing product behavior.
3. Read the Feature's Enablers, the Story's `Blocked by` links, and the immediate parent's current state. For a Test candidate, require the tested product behavior to exist at `BASE_SHA`, or require its immediate implementation Story/Enabler to be actively assigned, implementation-ready, and unblocked. A scaffold, component, API method, or helper alone does not establish that prerequisite.
4. If the highest-value implementation scope has repairable planning gaps, keep it primary and route it through `issue-planning-governor`; do not prefer a lower-value issue just because it is more groomed. If a real implementation dependency or required entry-point infrastructure is absent, report that exact blocker and its prerequisite. Do not invent an Enabler or issue link.

Governance readiness controls whether assignment may happen, not how valuable the work is. A `planning-invalid` high-value issue can remain the primary preparation recommendation, but it can never be assigned until the issue-planning governor returns `verified`. If the user asks for ready-only work or supplies an explicit focus/exclusion, honor that constraint and state its effect on value ranking.

 Keep these predicates distinct:

- **Eligibility:** issue is open; no unresolved `Blocked by` item; exact paths declared under `Implementation Entry Points` exist. Apply the missing-entry-point blocker only to those declared paths. A file listed only as a Technical Task/test deliverable is the work to create, not missing infrastructure, when its declared entry-point directory exists. Never call such a deliverable a missing entry point. If an exact required `Implementation Entry Points` path is absent, follow repository blocked-work policy and stop for that issue.
- **Completion:** direct evidence from the exact `BASE_SHA` proves `work-remains`, `satisfied-on-main`, or `unclear`.
- **Governance:** `planning-invalid` blocks direct assignment; otherwise classify evidence as `verified`, `unclear`, or `missing`.
- **Assignment status:** only `verified` governance permits `assign-now`. `governance-check-required` explicitly means do not assign until `issue-planning-governor` returns `verified`.
- **Non-overridable gate:** repository owner approval, risk acceptance, deadlines, conditional PR requirements, or substitute labels cannot waive governance. When asked to bypass the gate, still return `governance-check-required`; do not invent an exception, offer conditional assignment, assign first, defer issue-planning-governor, self-assign, or tell Copilot to repair governance after assignment. A policy change must be made through the repository's governing-instructions process before this gate changes.

Skip candidate-specific `unclear` issues for assignment scoring. If one is the highest documented project value and has a concrete evidence or planning-repair path, retain it as `preparation-only`; state `Completion Check: unclear`, name the missing evidence, and give the next action. Do not claim `work-remains` or assign it. Do not silently replace it with a lower-value ready issue unless the user explicitly requested ready-only work. Shared missing data, especially `BASE_SHA`, still blocks the entire completion audit.

## Completion Audit

For each plausible candidate that passes eligibility:

1. Read the issue body, labels, dependencies, parent/linked issues, comments, and related PRs. Treat PR links as clues, not completion proof; audit the base tree directly.
2. At the exact `BASE_SHA`, map every AC or test objective/scenario/pass criterion to the source symbol or test path/name and its observed state. Copy the issue's actual criterion IDs and concise criterion wording; do not expand a broad criterion into more specific assertions or new requirements. Never invent titles, IDs, paths, commands, hashes, timestamps, or results.
3. For test criteria, inspect setup/pre-state and expected values. Count an assertion only if it would fail when the behavior is absent or wrong. Test names, passing commands, undifferentiated full-object equality, or values already present in both pre-state and expected state do not prove behavior.
4. Confirm an absent deliverable by inspecting the relevant tree at `BASE_SHA`; a focused “no test files” result may corroborate, but a search miss alone is not proof. An environment failure before assertions is not proof that behavior is absent.
5. Run available focused deterministic validation fresh at the same SHA. Record exact command, output, exit code, failure count, and matching CI SHA. Never use results from another branch or a dirty worktree. Apply `verification-before-completion` before making claims. Missing test assertions are `work-remains` when directly confirmed in the base tree; passing the not-yet-written tests is not a precondition to recommend that test issue. Do not claim completion or passing tests before they exist and run.

Classify completion:

- `work-remains`: direct inspection confirms at least one specific in-scope behavior/assertion is absent, ineffective, or contradicted. For a test issue, the missing assertion must belong to that test issue; do not count linked test work as remaining story/feature scope.
- `satisfied-on-main`: every criterion has direct base-tree evidence and focused passing validation tied to `BASE_SHA`. Exclude it and continue. Route issue status/checkbox reconciliation through `issue-planning-governor`; do not close it here.
- `unclear`: evidence is unavailable or ambiguous, SHA is unknown, or validation cannot be tied to it. Skip that candidate and continue. A directly confirmed gap is `work-remains`, even if its new test cannot pass before creation.

## Governance and Ranking

For remaining `work-remains` candidates, check `planning-invalid`, required issue-type template sections, bullet-form issue references, deterministic `Validation Commands`, `Out Of Scope`, `Test Necessity Decision`, hierarchy, blocker consistency, privacy language, and test/implementation boundaries. Use the mini-checklist for the full assign-now gate. `planning-invalid` being absent is only one check, not proof of readiness. If required sections are stated to be incomplete or their evidence is unavailable, governance cannot be `verified`.

Score eligible `work-remains` candidates using [candidate-scoring-rubric.md](candidate-scoring-rubric.md), comparing documented project-value tiers before readiness scores. Do not score a Test whose parent-implementation prerequisite is unmet; rank its implementation owner or required planning repair instead.

Before calling a candidate strongest, compare it with the full inventory and assess every plausible equal- or higher-value alternative. If alternative issue data cannot be obtained, keep checking or escalate with ranking incomplete. Never stop just because the newest slice is satisfied, assigned, or unclear. Do not let a lower-value candidate win solely because it is more ready; route repairable planning gaps for the higher-value candidate through the issue-planning governor.

Apply governance after ranking:

- `verified`: recommend `assign-now` and assign GitHub assigned cloud Copilot.
- `unclear` or `missing`: recommend `governance-check-required`; exact next action is run `issue-planning-governor`, then assign only after `verified`.
- `planning-invalid`: never recommend direct assignment; follow planning-governor repair/readiness workflow.
- This gate is non-overridable. Owner authority, risk acceptance, deadlines, or conditional-assignment plans do not replace `verified` evidence. Never assign first and defer governance repair; only the governor's `verified` result permits assignment.
- Never infer `verified` from an absent `planning-invalid` label, an open/unblocked issue, or existing entry-point paths. Known incomplete required markers mean `unclear` or `missing`; require the governor's verified result before assignment.
- No owner/user request, deadline, or explicit pressure can waive these gates or authorize assignment with governance below `verified`.

## Output Contract

Return one primary issue only when full candidate comparison supports it. Return at most one fallback, independently completion-checked and ranked. Follow the output template exactly: link the issue number to the repository's GitHub issue URL and copy the exact GitHub title. `Data Freshness` is the maximum `updated_at` across the full candidate set; it is not the selected issue's `updated_at` or a date inferred from `BASE_SHA`. Use exact AC IDs, SHA, validation commands/results, and repository owner/name from evidence. Report only commands actually run or matching CI evidence; never invent a plausible command or result. If validation was not run, say `not run` with the reason and classify the affected completion as `unclear` when that validation is required. In assignment advice, do not offer guessed command suggestions; state `not run`. Missing assertions are the work being recommended, not a pre-assignment prerequisite. Do not describe `governance-check-required` candidates as “assignable now.”

```text
NEXT ISSUE ADVICE
Recommended Issue: [#{number}](https://github.com/{owner}/{repo}/issues/{number}) - {exact title}
Project Value Evidence: [documented priority/outcome and source]
Issue Role: [implementation | verification]
Parent Readiness: [delivered at BASE_SHA | actively assigned and implementation-ready | not met; identify parent]
Status: [assign-now | governance-check-required | preparation-only]
Confidence: [high | medium | low]
Data Freshness: [newest updated_at in full candidate set, ISO timestamp]
Completion Check: [work-remains | unclear] - [specific gap or exact evidence still needed]
Completion Evidence
- Base SHA: [full BASE_SHA]
- Criterion matrix: [one row per AC/test criterion: source/test evidence or exact gap]
- Validation: [exact focused command and result tied to BASE_SHA]

Why This Issue
- [reason 1]
- [reason 2]
- [reason 3]

Governance Check
- Evidence level: [verified | unclear | missing]
- planning-invalid: [present | absent]
- Template/readiness notes: [concise evidence]

Required Next Action
- If assign-now: Assign GitHub assigned cloud Copilot to #[number].
- If governance-check-required: Run issue-planning-governor on #[number], then assign only after verified.
- If preparation-only: Collect the exact-`BASE_SHA` completion evidence or run `issue-planning-governor`; do not assign until work remains and governance is `verified`.

Fallback
- [#{number}](https://github.com/{owner}/{repo}/issues/{number}) - {exact title} ([why it ranks next])
```

If blocked, return:

```text
Blocked reason: [short reason]
Evidence: [exact missing data or tool error]
Requested user action: [one concrete action]
Next step after action: [what will be done]
```

## Rationalizations to Reject

| Temptation | Correction |
| --- | --- |
| “Recent slice is done, so there is no next issue.” | Continue through the full open backlog unless the user explicitly narrowed it. |
| “An already-assigned issue still has work, so assign it again.” | Exclude assigned/in-progress issues from a new assignment; resolve existing ownership separately. |
| “One candidate is unclear, so stop.” | Skip it; only unavailable shared data blocks the whole audit. |
| “The preparation status is missing from the rubric, so choose a lower-value issue with a supported status.” | Use `preparation-only` consistently for an unclear high-value target; do not demote it to an assignment recommendation or replace it for status convenience. |
| “Governance is incomplete, so give no recommendation.” | If work and eligibility are confirmed, recommend `governance-check-required`; do not assign yet. |
| “The missing tests must pass before I can recommend assignment.” | Missing assertions are the test issue's remaining work; only eligibility and governance gates constrain assignment. |
| “The owner accepts the risk, so assign and repair governance later.” | This is not overridable. Do not use conditional PR gates or alternate labels; only a `verified` issue-planning-governor result authorizes assignment. |
| “The repo owner explicitly overrides the gate.” | Return `governance-check-required` anyway; only a change to governing repository policy can change this rule. |
| “There is no `planning-invalid` label, so governance is verified.” | Verify every required marker; an absent invalid label alone never establishes `verified`. |
| “The focused test cannot pass because its deliverable is missing, so the issue is blocked.” | A missing task deliverable is `work-remains` when its required entry-point directory exists; report the actual validation result and do not claim completion. |
| “It is open and unassigned, so assign it now.” | Apply completion and governance gates. |
| “The test file is missing, so infrastructure is blocked.” | Distinguish task deliverables from required pre-existing entry points. |
| “The repository blocks missing entry points, so an absent task deliverable blocks assignment.” | Compare the absent path with the exact `Implementation Entry Points` list. If only the file deliverable is absent and its listed directory exists, that absence is `work-remains`, not an infrastructure blocker. |
| “The issue is missing `planning-valid`.” | Check `planning-invalid`; do not invent label gates. |
| “The branch is called main, so SHA is unnecessary.” | Resolve the exact shared `BASE_SHA`; otherwise stop and escalate. |
| “This issue mentions the same topic, so it is in the active slice.” | Require hierarchy or in-flight evidence. |
| “I found a gap, so it must be the strongest.” | Compare plausible equal- or higher-ranked candidates in the full inventory. |
| “A plausible title, AC ID, or command is good enough.” | Copy exact metadata and report only observed validation. |
| “I can make a broad criterion more concrete by inventing its assertions.” | Keep the matrix wording within the issue's stated scope; do not add test requirements. |
| “A likely command can stand in for validation evidence.” | State `not run`; never report a suggested command or result as executed evidence. |
| “The chosen issue's timestamp or the base SHA date can fill Data Freshness.” | Use the maximum `updated_at` from the full open candidate set. |
| “The selected issue's update time is the data freshness.” | Use the newest `updated_at` across the full candidate set. |
| “A guessed focused command can fill the validation slot.” | Report only an executed command or matching CI evidence; otherwise state not run and apply `unclear` when required. |
| “The owner said to bypass governance for the deadline.” | No override permits direct assignment without `verified` governance. |
| “Assign it to myself or add a follow-up to make it fit.” | Preserve the GitHub assigned cloud Copilot handoff and stated scope. |
| “The highest-value issue needs grooming, so pick the ready issue instead.” | Keep documented value primary; route repairable planning gaps through `issue-planning-governor`. Readiness controls assignment, not priority. |
| “The test file is missing, so that must be the next issue even though its parent behavior is absent.” | Verify the immediate parent's delivered behavior or active implementation readiness; choose the implementation owner or its preparation action first. |
| “This can be handled here without subagent delegation.” | When at least three independent candidate groups remain, use up to three bounded read-only audits; the coordinator retains shared SHA, ranking, governance, validation claims, and all writes. |

## Stop Conditions

Stop and escalate when the full applicable candidate set has no eligible `work-remains` issue, shared required data such as `BASE_SHA` is unavailable, issue/PR data cannot be read, or parent/blocker relationships cannot be verified. Do not infer completion or remaining work from checkboxes, file names alone, PR claims, or activity recency. If only candidate-specific evidence is missing, preserve the preparation target and say `unclear` without claiming a gap.
