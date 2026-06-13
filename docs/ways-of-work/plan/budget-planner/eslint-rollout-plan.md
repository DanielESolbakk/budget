# ESLint Rollout Plan

## Objective

Add a real linting layer that catches common Copilot and contributor mistakes before review, without introducing avoidable style churn or broad refactors.

## Why This Matters For Copilot

Copilot performs better when the repository has fast, deterministic feedback for common correctness errors.

Today `npm run lint` in [package.json](../../../package.json) only runs TypeScript typechecking. That catches type-level mistakes but misses several high-frequency issues such as unhandled promises, unused imports, weak async control flow, and accidental layer boundary leaks.

## Scope

In scope for the first rollout:

- TypeScript linting for `src/**/*.ts`, `scripts/**/*.ts`, and `tests/**/*.ts`
- Correctness-oriented rules with low ambiguity
- One command surface: `npm run lint`
- CI enforcement through the existing CI workflow

Out of scope for the first rollout:

- Formatting debates or broad style normalization
- React-specific rules before renderer code exists
- Heavy architectural boundary plugins before Electron layers are real
- Auto-fixing large existing code surfaces in one change

## Phase Plan

### Phase 1: Baseline TypeScript ESLint

- Add ESLint with TypeScript support
- Keep the initial ruleset short and correctness-first
- Verify the config runs cleanly on the current repository

Recommended initial rules:

- `no-unused-vars` via TypeScript-aware replacement
- `no-floating-promises`
- `require-await`
- `no-misused-promises`
- `consistent-type-imports`
- `no-unnecessary-condition` when signal remains acceptable

### Phase 2: Repository-Specific Safeguards

- Add targeted import restrictions once renderer, Electron main, and persistence layers exist
- Prevent renderer code from importing persistence or file-system code directly
- Add test-specific overrides only where needed

### Phase 3: Task-Specific Expansions

- Add Playwright-specific or React-specific instructions and rules once those surfaces exist
- Expand only after concrete false-positive patterns are understood

## Acceptance Criteria

- [ ] `npm run lint` performs actual ESLint checks in addition to typechecking or replaces the current lint alias cleanly.
- [ ] The first ruleset catches correctness issues without creating broad style churn.
- [ ] CI fails when lint violations are introduced.
- [ ] Repository instructions and agent entrypoint mention the lint command as a required validation path.

## Suggested Implementation Order

1. Add ESLint dependencies and a minimal config.
2. Run lint on the current repository and fix only direct violations.
3. Update [package.json](../../../package.json) so `npm run lint` reflects the real lint surface.
4. Keep CI using the same command in [.github/workflows/ci.yml](../../../.github/workflows/ci.yml).
5. Add stricter boundary rules only after the application layers are present.

## Risks

- Too many style rules early will create noise and encourage unnecessary refactors.
- Boundary rules added before the renderer and main-process surfaces exist will be speculative.
- A slow lint stack reduces the chance that Copilot or contributors run it locally.

## Issue Seed

Use this plan to open a focused maintenance issue for “ESLint baseline rollout” under the foundations epic or as a cross-cutting enabler once the user wants it tracked in GitHub.
