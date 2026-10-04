# Governance Check Mini Checklist

Use this checklist before returning `assign-now`.

## Required for assign-now

- Issue state is open.
- Resolve the exact `BASE_SHA`; exclude uncommitted or off-branch workspace changes from completion evidence.
- Record one evidence row per AC or test criterion: direct base-branch code/test reference or the exact confirmed gap.
- For test evidence, inspect fixture/pre-state and expected values; count only assertions that would fail if the claimed behavior were absent or wrong. Identical pre-state and expected values are not discriminating proof.
- Record focused validation output or matching CI evidence tied to `BASE_SHA`; an unrelated or absent issue-linked PR does not establish completion state.
- Apply required sub-skill `verification-before-completion`: inspect fresh focused-command output, exit code, and failures tied to `BASE_SHA` before claiming a completion status.
- `work-remains` requires a directly confirmed in-scope criterion gap. Classify `unclear` only when evidence is unavailable or ambiguous; uncertainty for one candidate does not stop evaluation of others.
- Completion claims require the full `BASE_SHA`; the branch name `main` alone is insufficient.
- `governance-check-required` is not assign-now; run `issue-planning-governor` first and assign only after evidence is `verified`.
- `planning-invalid` label is absent.
- Passing the open/blocker/entry-point precheck does not authorize direct assignment; `governance-check-required` means do not assign until governance is `verified`.
- Required issue template sections exist for the issue type.
- Structured issue references in heading sections use bullet format (`- #NUMBER`).
- `Validation Commands` section is explicit and deterministic.
- `Out Of Scope` section is present and excludes privacy-violating behavior.
- `Blocked by` references are resolved, `_None_`, or explicitly accepted for current scope.
- `Implementation Entry Points` paths exist in the repository when the issue is assignable now.
- Test/implementation boundary is clean:
  - story/feature does not absorb dedicated test execution scope when linked test issue exists.
  - test issue remains verification-only.
  - Test parent behavior is delivered at `BASE_SHA` or its immediate Story/Enabler is actively assigned, implementation-ready, and unblocked; partial source symbols are insufficient.
- Test Necessity decision is present and consistent with linked test issues.

## Governance Evidence Levels

- `verified`: all required checks pass.
- `unclear`: no `planning-invalid`, but one or more required checks are ambiguous.
- `missing`: required structure or evidence is absent.

Direct cloud-copilot assignment is permitted only for `verified`.
