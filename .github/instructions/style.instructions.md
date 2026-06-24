---
applyTo: "**/*.{md,ts,tsx,sql,json,yml,yaml}"
description: "Use when creating or editing planning docs, TypeScript application code, SQL schema files, or project configuration for the local budget planner. Enforces naming, layering, testing, and documentation conventions."
---

# Budget Planner Style Instructions

## General

- Keep changes small, local, and easy to review.
- Prefer explicit names from the product domain over generic names.
- Match the repository vocabulary from the repo-wide Copilot instructions.
- Avoid placeholder abstractions that are not yet justified by active requirements.

## Documentation

- Write planning documents in plain, direct language.
- Use headings that reflect decisions, scope, acceptance criteria, dependencies, and risks.
- Express acceptance criteria as checklists when the document is intended to drive implementation or issue creation.
- Keep planning docs consistent with the Epic > Feature > Story or Enabler > Test model.
- Use repository-relative paths in committed documentation. Do not include user-specific absolute paths from local machines.
- Treat the repository as public when writing docs. Only reference sanitized or synthetic financial artifacts in committed materials.

## TypeScript And React

- Use TypeScript-first designs with explicit types at module boundaries.
- Prefer discriminated unions, enums, and typed result objects over loose strings and ad hoc objects.
- Keep React components focused on rendering and user interaction.
- Keep business logic in services, repositories, parsers, or domain modules rather than inside components.
- Avoid broad shared state when feature-local state is sufficient.
- Do not couple renderer code directly to SQLite or raw file system access.

## Electron Boundaries

- Keep Electron IPC handlers thin.
- Validate inputs at the IPC boundary before invoking business logic.
- Put persistence, import, categorization, export, and forecast behavior in testable modules outside Electron wiring.

## Data And Schema

- Prefer additive schema evolution with explicit migrations.
- Keep import provenance, rule provenance, and correction history understandable from stored data.
- Normalize merchants deliberately; do not hide irreversible transformations.
- Keep raw financial samples, backups, and other sensitive local artifacts out of version control; use gitignored local-only directories for those files.

## Testing

- Add or update tests alongside behavior changes when practical.
- Prefer unit tests for pure logic, integration tests for persistence and import workflows, and end-to-end tests for critical user journeys.
- Use fixtures that reflect Norwegian merchant names, localized number formats, and realistic statement structures whenever available.
- For bug fixes, add a regression test that reproduces the failure before the fix.
- For feature changes, include an acceptance-criteria-to-test mapping in planning docs and keep test names aligned with that language.
- Keep implementation issues and test issues separate in planning material unless an issue is explicitly test-only; do not let a story or feature read as complete merely because test coverage was added.
- When drafting a story or feature issue, if validation work is needed, create or link a dedicated Test issue instead of folding the test work into the story issue.
- Avoid broad mocks for core finance logic when deterministic fixtures can validate behavior directly.
- Do not disable or delete tests to speed up delivery; fix the implementation or isolate flaky tests with a tracked follow-up.

## Comments And Formatting

- Keep comments rare and informative.
- Do not restate what the code already makes obvious.
- Favor readable control flow over clever compactness.
- Preserve existing formatting conventions in each file.
