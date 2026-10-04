---
name: issue-planning-governor
description: Use when creating, updating, validating, or resolving scope, hierarchy, grooming, and readiness issues for GitHub Feature, Story, Enabler, or Test issues in the budget repository.
compatibility: Requires GitHub MCP issue tools and repository planning rules in .github/copilot-instructions.md. Do not use gh; Actions validation may require an authorized human through GitHub UI.
metadata:
  owner: budget-repo
  workflow: issue-planning
  version: "1.4"
---

# Issue Planning Governor

Govern Feature, Story, Enabler, and Test planning, not implementation. Handle one issue at a time; process batches sequentially and stop on any stop condition. Epics are read-only hierarchy context.

## Rules

- Never delete; close only for completed criteria or a linked successor.
- `planning-invalid` blocks readiness. Repair only after a fresh failure, at most twice. Timeout, unresolved blockers, or permission failures stop the run.
- Use GitHub MCP, never `gh`; MCP cannot dispatch or inspect Actions runs.
- Keep transaction content local; do not add cloud processing, telemetry, or analytics.
- Use `- #NUMBER` for structured references; ban uncertainty in tasks, criteria, and validation commands.
- A workflow pass proves structure only. Preserve `needs-grooming` until G1-G9 pass with quoted evidence.
- Apply R16/G9 to visible UI; non-renderer work is exempt. Impeccable is opt-in.

## Issue Batch Work

- Follow the user's requested issue scope and desired outcome already established in the conversation. Ask only for a decision that blocks truthful, scoped issue work; do not make the user repeat context.
- Updating or creating GitHub issue records through GitHub MCP does not require a PR. A PR is required only when changing repository files such as the issue catalog, templates, validation workflow, or code. Do not make a repository-file change or require its PR to proceed with unrelated authorized issue-record work.
- For an explicitly requested set, read every requested issue and the relevant same-feature parents, children, and catalog keys before writing. Build an issue identity map of issue number, exact title/type/key, Parent Epic, Parent Feature, and current links; never infer issue type or hierarchy from the numeric issue number or catalog key alone. Reuse existing real Stories and Tests; do not infer that no Story exists from an Enabler's current `Stories Enabled` list or from a placeholder Story alone.
- Preserve distinct user-approved outcomes as distinct Stories when their behavior and workflow differ. When an existing traceability-only placeholder corresponds to a newly approved real outcome, repurpose that issue in place by replacing its title/body and assigning the next unambiguous key under the correct Feature. Do not create a duplicate Story by default, merge separate outcomes into a neighboring Story, or close an issue as superseded by a Story with a different outcome.
- When moving an issue between Features or Enablers, update both ends of every relationship: remove the old link from its source, add the new link to its destination, and recheck parent, blocker, enabled-story, related-issue, and test references across the affected set.
- Derive Enabler links from the approved capability and data flow. If a Story consumes a persisted local merchant rule and the Enabler owns merchant-rule persistence, link that Story as enabled by the Enabler and record the dependency on the Story; do not make the parent Feature blocked by its own child Enabler.
- Plan the set as dependency-ordered issue updates. A conflict blocks that issue and its dependents, not unrelated issues in the requested set. Preserve the blocked issue as `needs-grooming`, explain the exact conflict, and continue the remaining authorized work unless a global stop condition applies.
- When moving an Enabler under a Feature, remove any `Blocked by` reference from that parent Feature to its own child Enabler; put the dependency on only the Stories that require the capability. Recheck the resulting hierarchy for cycles.
- Use the catalog for seeded keys and hierarchy. For an explicitly approved new Story not yet in the catalog, assign the next unambiguous key under its owning Feature using `storyKeyPattern`; do not require a catalog-file edit or PR before creating/updating the GitHub issue record. Ask one focused question only when the owning Feature or next key is ambiguous. Report catalog-file follow-up separately if repository-file changes are outside the user's scope.
- After the requested issue updates are complete, provide the validation set as bare comma-separated issue numbers in the order expected by the planning workflow, for example `19,21,34,54,296`. Include every issue record actually edited whose structure needs validation; do not include untouched or deferred related issues. The workflow accepts this batch through `workflow_dispatch.issue_numbers`; do not require a separate user confirmation or validation cycle after every issue body.
- A fresh validation result proves structure only. It never proves G1-G9 readiness or authorizes assignment by itself.
- If an issue write returns `awaiting_user_submission`, read the issue before taking another action. If the requested change is present, continue from the saved state. If it is absent, report that the pending form was not submitted and request that submission; do not claim success or blindly repeat the same write.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "One issue has a blocker, so stop the entire requested batch." | Block that issue and its dependents; continue unrelated authorized issues. |
| "The catalog lacks this approved Story key, so issue-only planning cannot continue." | Use the next unambiguous key from the owning Feature's `storyKeyPattern`; a GitHub issue update does not require a catalog-file PR. |
| "These Stories are related, so combine future suggestions with existing-ledger propagation." | Keep distinct user outcomes and workflows in distinct Stories. |
| "The validator requires an Enabler, so link any Enabler or create a placeholder." | Require a real same-feature implementation dependency; report validator conflicts without fabricating hierarchy. |
| "The MCP write is probably done because the user said continue." | Read the issue and report only its observed state. |

Red flags: pausing unrelated issue edits for one issue's grooming conflict; asking again for batch validation permission already given; linking a placeholder to appease the validator; merging distinct user outcomes to avoid issue creation; claiming an `awaiting_user_submission` write was saved without reading it.

## Issue Materialization Gate

- Keep unapproved unscheduled ideas roadmap-only; never create empty delivery/Test hierarchies for visibility.
- A user-approved outcome is real Story scope when it states a distinct user behavior. Search all existing same-feature Stories first; reuse a matching real Story or replace a traceability-only placeholder with the approved scope. Create a separate Story when the behavior is distinct, assigning the next unambiguous key from `storyKeyPattern`. Never invent acceptance criteria or a Story solely to satisfy validation.
- Create an Enabler only when real implementation work enables one or more real same-Feature Stories. Search all existing Stories in that feature before creating another. Link only Stories with matching Parent Feature Issues.
- Decide Test Necessity from changed behavior. Create or convert Tests only after an immediate Story/Enabler owns delivered or active implementation scope. A placeholder Test does not become justified merely because its parent Story is rewritten. Each Test owns one layer and executable scenarios/commands.
- Never create coverage anchors, reserved scenarios, placeholder commands, or Tests solely for traceability, triangle completeness, or validator success. Declare Unit, Integration, and Playwright intent on the parent; link concrete follow-ups only when justified.
- Close a placeholder only when a linked successor covers its actual user outcome and hierarchy; a related topic or neighboring Story is not sufficient. Otherwise repurpose it for explicit approved real scope or leave it open and `needs-grooming`.
- If a requested issue cannot pass this gate without invented scope or links, leave that issue `needs-grooming`, report the exact conflict, and skip only its dependent issues. Continue independent authorized items in the requested batch.

## Workflow

1. **Preflight the requested set:** Read bodies, labels, comments, same-feature hierarchy, blockers, and catalog keys for all requested issues. Confirm once per batch that an authorized human can trigger and verify fresh UI validation after the edits. Do not pause between issue bodies to ask for repeated permission.
2. **Resolve the plan:** Identify existing real Stories, Enablers, and Tests before proposing creation, reparenting, or closure. Preserve product boundaries and map each Story's ACs to necessary layer-specific Tests. Record issue-specific conflicts separately from global blockers.
3. **Update sequentially:** Use `references/templates.md`; update the highest-level relevant issue, then its dependent Stories and Tests. Existing entry points must be real; list new files as tasks. Keep writes within the user's authorized scope. When one issue is blocked, preserve its grooming state and continue unrelated batch items.
4. **Validate the batch:** After edits, give the user all affected issue numbers as one comma-separated `issue_numbers` value for a fresh human-triggered `planning-validation` run. Do not treat MCP writes or existing labels as validation. If a validation failure occurs, repair only the affected issue, then revalidate the affected set. Respect the 180-second timeout for a triggered validation run.
5. **Assess readiness:** Run G1-G9 from the deep-dive only after the planning structure has a fresh validation result. Quote evidence for every PASS; G9 is N/A only without renderer-visible work. Keep `needs-grooming` until all applicable readiness checks pass.
6. **Finalize:** Report which issue records changed, which were deferred and why, the comma-separated validation input, the observed validation result (or that it is pending), Test Necessity, layer ownership, blockers, and follow-ups. Never describe unvalidated or grooming issues as ready.

## References

Load `checklists.md` and `assignment-readiness-deep-dive.md`. Load `repair-playbooks.md` only after a fresh failure; use the runbook/evaluation references as needed.
