# Budget Planner Agent Entry Point

This file is a short execution-time guide for GitHub Copilot cloud agent.

Repository-wide rules live in `.github/copilot-instructions.md`.
Path-specific rules live in `.github/instructions/**/*.instructions.md`.

## Start Here

- Keep changes small and local to the assigned issue.
- Prefer the issue body, linked planning issue, and linked test issue as the primary task context.
- Before writing any code, check the issue for open `Blocked by` dependencies. If any are still open, post a comment listing the blockers and stop - do not implement a partial subset silently.
- Before writing any code, verify that every path listed under `Implementation Entry Points` exists in the workspace. If a required path is missing (e.g., `src/renderer/` does not exist), post a comment explaining what infrastructure is absent and stop. Do not silently implement only the feasible subset.
- For AC mapping in PR bodies, treat the primary planning issue as the default source of AC IDs; only aggregate additional planning issues when explicitly requested.
- Planning validation does not trigger on issue edits. To validate an issue, add the `validate-planning` label; it is removed automatically after processing. Use `workflow_dispatch` on Planning Issue Validation to validate a batch.
- PRs must satisfy `check-dor-dod` (required gate): map each AC ID with strict evidence rows `AC-ID | test-level | test-id | test-file-path`. Workflow names are invalid AC evidence and missing rows block merge.
- Run the narrowest validation command that matches the touched slice before widening scope.
- For planning issues, use template headings exactly and bullet refs as `- #NUMBER` in reference sections.
- Keep enablers feature-scoped under current lint rules: one `Parent Feature Issue` and matching `Stories Enabled` parents.
- If feature/story triangle coverage defers a layer, include an explicit follow-up issue reference in the same line.
- If the agent can comment but cannot edit issue/PR body fields, post a single concise owner action checklist and stop retrying the same operation.
- Avoid remediation loops: do not repeat near-identical comments unless new evidence, permissions, or validation output changed.
- Do not add networked features, telemetry, cloud sync, or external data processing.
- Do not commit raw bank data, local databases, backups, or unsanitized fixtures.

## Build And Test Commands

- Install: `npm install`
- Typecheck: `npm run typecheck`
- Unit tests: `npm run test:unit`
- Integration tests: `npm run test:integration`
- End-to-end tests: `npm run test:e2e`
- No-network verification: `npm run verify:no-network`
- Fixture verification: `npm run verify-fixture -- --input tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv`

## Architecture Map

- `src/domain/types.ts`: shared domain types.
- `src/domain/import/`: import-specific pure logic such as transaction fingerprinting.
- `src/domain/merchant/`: merchant normalization and later categorization support.
- `src/app/`: thin application-level workflows that compose domain modules.
- `scripts/`: command-line entrypoints only; keep reusable logic in `src/`.
- `tests/unit/`: pure logic tests.
- `tests/integration/`: fixture and cross-module contract tests.
- `tests/e2e/`: critical workflow smoke coverage.
- `tests/nonetwork/`: privacy and no-network enforcement.

## Issue Handoff Expectations

For a story issue to be implementation-ready, it should identify:

- likely files to change
- validation command(s)
- linked test issue(s)
- explicit unit, integration, and Playwright coverage intent
- explicit out-of-scope items

If the issue is missing those details, prefer a planning update before broad implementation.
