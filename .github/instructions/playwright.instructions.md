---
applyTo: "tests/playwright/**/*.ts"
description: "Use when creating or editing Playwright runtime tests."
---

# Playwright Rules

- Follow the local skill contract in .agents/skills/playwright-skill/SKILL.md.
- Required packs for this repository are core, ci, and pom.
- Keep one behavior per test case and use role-first locators with web-first assertions.
- Avoid fixed timeout sleeps.
- Preserve CI artifacts for failures (traces, screenshots, report output).
- If required coverage cannot be implemented, stop and post a concise blocker instead of partial coverage.
