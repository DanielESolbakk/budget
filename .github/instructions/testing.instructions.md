---
applyTo: "tests/**/*.ts"
description: "Use when creating or editing unit, integration, e2e, or nonetwork tests."
---

# Testing Rules

- Add or update tests alongside behavior changes when practical.
- Bug fixes require a regression test that reproduces the failure before the fix.
- Prefer deterministic fixtures over broad mocks for finance logic.
- Keep test naming aligned with acceptance criteria language where applicable.
- Do not remove or weaken tests to pass CI; isolate flaky behavior with a tracked follow-up issue.
