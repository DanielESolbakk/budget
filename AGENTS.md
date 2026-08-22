# Budget Planner Agent Entry Point

This file is a short execution-time guide for GitHub Copilot cloud agent.

Repository-wide rules live in `.github/copilot-instructions.md`.
Path-specific rules live in `.github/instructions/**/*.instructions.md`.

## Start Here

- Keep changes small and local to the assigned issue.
- Prefer the issue body, linked planning issue, and linked test issue as the primary task context.
- Before writing code, enforce blocker discipline from `.github/copilot-instructions.md` (open `Blocked by` issues and missing `Implementation Entry Points` are stop conditions).
- Follow PR guardrails from `.github/copilot-instructions.md`: AC mapping, test evidence checkbox, and planning-validity checks.
- Follow planning formatting and hierarchy rules from `.github/copilot-instructions.md` and issue templates.
- Follow privacy and architecture constraints from `.github/copilot-instructions.md`; do not add cloud processing or telemetry for transaction content.
- For Playwright issues, treat `.agents/skills/playwright-skill/SKILL.md` as the only detailed implementation authority; `.github/instructions/playwright.instructions.md` is a pointer, not a competing rule set.
- If permissions prevent issue/PR body edits, post one concise owner action checklist and stop retry loops.

## Build And Test Commands

- Install: `npm install`
- Typecheck: `npm run typecheck`
- Unit tests: `npm run test:unit`
- Coverage thresholds signal: `npm run test:coverage:signal`
- Integration tests: `npm run test:integration`
- Vitest end-to-end smoke tests: `npm run test:e2e:vitest`
- Playwright runtime tests: `npm run test:e2e:playwright`
- No-network verification: `npm run verify:no-network`
- Harness eval (determinism + baseline drift): `npm run eval:skill`
- Fixture verification: `npm run verify-fixture -- --input tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv`

## Frontend Design Governance (Opt-In)

Impeccable is an opt-in design governance tool for frontend-relevant issues. Non-frontend issues (import, persistence, categorization, IPC, backup, export) do not require it.

### Prerequisite Check

```sh
node --version   # must be v22.12.0 or newer
```

### Installation

```sh
npx impeccable install   # run once from repository root
```

Alternative: enable the GitHub Copilot built-in Experimental setting for Impeccable (no installation required).

### Usage For Frontend Issues

1. Run `/impeccable init` before starting implementation on a frontend planning issue.
2. Run `npx impeccable check` to validate design governance after changes.
3. Do NOT commit generated files: `PRODUCT.md`, `DESIGN.md`, skill caches, credentials, or private financial artifacts.

**Privacy constraint:** Impeccable must not be used for cloud processing, telemetry, analytics, or network access to transaction content.

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
