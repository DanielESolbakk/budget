# Governance Check Mini Checklist

Use this checklist before returning `assign-now`.

## Required for assign-now

- Issue state is open.
- `planning-invalid` label is absent.
- Required issue template sections exist for the issue type.
- Structured issue references in heading sections use bullet format (`- #NUMBER`).
- `Validation Commands` section is explicit and deterministic.
- `Out Of Scope` section is present and excludes privacy-violating behavior.
- `Blocked by` references are resolved, `_None_`, or explicitly accepted for current scope.
- `Implementation Entry Points` paths exist in the repository when the issue is assignable now.
- Test/implementation boundary is clean:
  - story/feature does not absorb dedicated test execution scope when linked test issue exists.
  - test issue remains verification-only.
- Test Necessity decision is present and consistent with linked test issues.

## Governance Evidence Levels

- `verified`: all required checks pass.
- `unclear`: no `planning-invalid`, but one or more required checks are ambiguous.
- `missing`: required structure or evidence is absent.

Direct cloud-copilot assignment is permitted only for `verified`.
