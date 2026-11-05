---
applyTo: "tests/playwright/**/*.ts"
description: "Use when creating or editing Playwright runtime tests."
---

# Playwright Rules

The detailed and authoritative contract is `.agents/skills/playwright-skill/SKILL.md`.

Before editing a Playwright test, load that skill and follow it. This file exists only to activate the path-specific instruction and route the agent to the single source of truth; do not add competing Playwright rules here.

For test planning, additions, reviews, or suite-efficiency work, also load `governing-playwright-suite` from `.agents/skills/governing-playwright-suite/SKILL.md` for existing-coverage checks and bounded reviews. An unspecified review starts with one local target recommendation, not a suite audit. The detailed Playwright technique contract remains `playwright-skill`; the governance skill does not replace it.
