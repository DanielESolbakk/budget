# Budget Planner Agent Entry Point

This file is a short execution-time guide for GitHub Copilot cloud agent.

Repository-wide rules live in `.github/copilot-instructions.md`.
Path-specific rules live in `.github/instructions/**/*.instructions.md`.

## CRITICAL: No Git Push to Main

**NEVER run `git push origin main` or any git push to main.**

- All changes must go through pull requests (create with GitHub MCP tools)
- Create feature branches for all work
- Wait for human review and approval
- See `.github/copilot-instructions.md` for full git policy

## Start Here

- Keep changes small and local to the assigned issue.
- Prefer the issue body, linked planning issue, and linked test issue as the primary task context.
- Run the narrowest validation command that matches the touched slice before widening scope.
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
