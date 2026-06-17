# Budget Planner

Windows-first, local-first budget planning software for a household user managing multiple accounts on one machine.

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
- Workflow validation note: planning issue checks now run only when explicitly requested.
- Workflow validation heartbeat: 2026-06-17T16:06Z

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
- `.github/skills/breakdown-plan/SKILL.md`

The docs tree under `docs/ways-of-work/plan/` will hold the feature PRD, technical breakdown, implementation plan, project plan, and issue checklist as those artifacts are created.
