# Branch Protection Setup

This repository includes a baseline ruleset at [.github/branch-protection/main-ruleset.json](.github/branch-protection/main-ruleset.json).

## What This Protects

- blocks direct force pushes and branch deletion on main
- requires pull requests with at least one approval
- requires conversation resolution before merge
- requires passing checks:
  - CI Fast
  - CI Full
  - PR Guardrails
- Enforce DoR / DoD

## Apply In GitHub UI

1. Open repository settings.
2. Go to Rules, then Rulesets.
3. Create a new branch ruleset for main.
4. Copy values from [.github/branch-protection/main-ruleset.json](.github/branch-protection/main-ruleset.json).
5. Ensure required checks match workflow job names exactly.

## Notes

- Run one successful CI workflow first so required check contexts exist in GitHub.
- Keep check names synchronized with [.github/workflows/ci.yml](.github/workflows/ci.yml) if job names change.
