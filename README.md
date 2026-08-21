# Budget Planner

Windows-first, local-first budget planning software for a household user managing multiple accounts on one machine.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- npm (included with Node.js)

### Install dependencies

```bash
npm install
```

### Start the desktop application

```bash
npm start
```

This command builds the renderer and main process and opens the Electron desktop window. The app runs entirely locally — no network connection is required.

### Import a digital text PDF statement

Use the PDF import flow in the desktop app to load a local text-based statement exported by a supported bank. The current adapter is focused on Rogaland Sparebank digital text statements that include the `ROGALAND SPAREBANK` header and a `Dato  Beskrivelse` transaction table.

Example local usage:

```bash
# Example fixture path in the repo
# tests/fixtures/synthetic/rogaland-2026-05-statement.txt
```

The app validates the file before import, rejects unsupported layouts without partial writes, and records the adapter identity in the import provenance metadata. All processing stays local by default and the no-network guard blocks outbound external requests during the import flow.

### Build for production

```bash
npm run build
```

The production-ready output is placed in `dist/`.

### Run checks

```bash
# Type checking
npm run typecheck

# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# Vitest end-to-end smoke tests
npm run test:e2e:vitest

# Playwright runtime tests
npm run test:e2e:playwright

# No-network verification
npm run verify:no-network
```

## Mission

This project is building a desktop application that:

- runs locally with a graphical user interface
- keeps transaction content on-device by default
- supports digital PDF bank statements, CSV imports, and manual transaction entry
- categorizes transactions using merchant normalization and deterministic rules before any smarter local automation is introduced
- provides budgeting, forecasting, search, review, backup, and export workflows

## Current Direction

- Stack: Electron, React, TypeScript, and SQLite
- Scope: one local household user managing multiple accounts
- Import model: digital text PDFs, CSVs, and manual entry first
- Categorization strategy: rules-first with confidence scoring and review flows
- Privacy model: no bank APIs, no cloud processing of transaction content, no telemetry by default

## AI Oversight Snapshot

- We use AI to speed delivery, but every important change is checked by automated quality gates before merge.
  Learn more: [.github/workflows/ci.yml](.github/workflows/ci.yml), [.github/workflows/check-dor-dod.yml](.github/workflows/check-dor-dod.yml)
- A deterministic performance harness validates import and packaging behavior against a known baseline to catch drift early.
  Learn more: [scripts/run-skill-evals.ts](scripts/run-skill-evals.ts), [tests/fixtures/synthetic/backup-restore-performance-contract.json](tests/fixtures/synthetic/backup-restore-performance-contract.json)
- Coverage, mutation testing, and dependency risk are tracked as explicit CI signals so weak test quality and security risk stay visible.
  Learn more: [vitest.unit.config.ts](vitest.unit.config.ts), [stryker.config.json](stryker.config.json), [scripts/check-dependency-governance.ts](scripts/check-dependency-governance.ts)
- A consolidated AI failure feedback report summarizes unresolved failures and warnings into a single actionable checklist.
  Learn more: [scripts/ai-failure-feedback-loop.ts](scripts/ai-failure-feedback-loop.ts), [reports/ai-feedback/ai-failure-feedback.md](reports/ai-feedback/ai-failure-feedback.md)
- A skill pruning loop reviews AI skill packs and flags optional or stale packs to reduce maintenance overhead.
  Learn more: [scripts/ai-skill-pruning-loop.ts](scripts/ai-skill-pruning-loop.ts), [reports/ai-skill-pruning/ai-skill-pruning.md](reports/ai-skill-pruning/ai-skill-pruning.md)
- A high-risk judgment checkpoint classifies release risk and requires explicit tradeoff and rollback rationale for high-blast-radius changes.
  Learn more: [scripts/high-risk-judgment-checkpoint.ts](scripts/high-risk-judgment-checkpoint.ts), [reports/high-risk-checkpoint/high-risk-checkpoint.md](reports/high-risk-checkpoint/high-risk-checkpoint.md), [.github/PULL_REQUEST_TEMPLATE/default.md](.github/PULL_REQUEST_TEMPLATE/default.md)
- CI always uploads governance artifacts (coverage, mutation, dependency, AI feedback, skill pruning, and risk checkpoint) for transparent review.
  Learn more: [.github/workflows/ci.yml](.github/workflows/ci.yml)
- Planning and policy source of truth for AI work lives in plan and repository AI instructions.
  Learn more: [plan.md](plan.md), [.github/copilot-instructions.md](.github/copilot-instructions.md), [.github/instructions/style.instructions.md](.github/instructions/style.instructions.md), [.github/instructions/planning.instructions.md](.github/instructions/planning.instructions.md), [.github/instructions/testing.instructions.md](.github/instructions/testing.instructions.md), [.github/instructions/playwright.instructions.md](.github/instructions/playwright.instructions.md)

## Agent Readiness

- Universal entrypoint for agents: [AGENTS.md](AGENTS.md)
- Repo-wide policy: [.github/copilot-instructions.md](.github/copilot-instructions.md)
- Agent bootstrap workflow: [.github/workflows/copilot-setup-steps.yml](.github/workflows/copilot-setup-steps.yml)
- Path-scoped instruction packs: [.github/instructions](.github/instructions)
- Custom reviewer assets: [.github/agents/reviewer.agent.md](.github/agents/reviewer.agent.md), [.github/prompts/review.prompt.md](.github/prompts/review.prompt.md)
- Dependabot updates and alerts are managed in GitHub repository settings.
- Optional local hooks: [.github/hooks/README.md](.github/hooks/README.md)

## Public Repository Handling

This repository is public.

- Never commit secrets, tokens, credentials, private keys, or `.env` files with real values.
- Never commit raw bank statements, unsanitized financial exports, backups, or local databases.
- Only commit sanitized or synthetic fixtures that are safe for public distribution.
- Use repository-relative paths in committed documentation instead of machine-specific absolute paths.
- Keep sensitive local-only files in gitignored paths such as `local/`, `private/`, `data/local/`, `backups/local/`, and `fixtures/private/`.

## Planning Files

The planning work for this project is centered around:

- `plan.md`
- `.github/copilot-instructions.md`
- `.github/instructions/style.instructions.md`
- `.agents/skills/issue-planning-governor/SKILL.md`

The docs tree under `docs/ways-of-work/plan/` will hold the feature PRD, technical breakdown, implementation plan, project plan, and issue checklist as those artifacts are created.
