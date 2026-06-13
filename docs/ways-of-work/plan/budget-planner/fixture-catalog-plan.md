# Fixture Catalog Plan

## Objective

Create a machine-readable catalog of sanitized and synthetic fixtures so Copilot and human contributors can select the correct fixture quickly and validate expected outcomes consistently.

## Why This Matters For Copilot

Copilot cloud agent can search the repository, but it performs better when fixture intent is explicit rather than inferred from filenames alone.

A fixture catalog reduces uncertainty around:

- which fixture belongs to which story or test issue
- whether a fixture is synthetic or sanitized
- which command validates the fixture
- what high-level outcomes are expected

## Proposed Artifact

Create a file such as `tests/fixtures/fixture-catalog.json` with one entry per committed fixture.

Suggested schema:

```json
{
  "fixtures": [
    {
      "id": "rogaland-2026-05-synthetic",
      "path": "tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv",
      "sourceType": "csv",
      "classification": "synthetic",
      "usedBy": ["T4-S1", "T4-S2", "T4-S3"],
      "validationCommand": "npm run verify-fixture -- --input tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv",
      "expectedSignals": {
        "rowCountMin": 1,
        "hasNonNokRow": true,
        "hasReservedRows": true,
        "hasTransferRows": true,
        "hasKidReferences": true
      },
      "notes": "Synthetic dashboard and import coverage fixture."
    }
  ]
}
```

## Scope

In scope for the first version:

- CSV fixtures already committed to the repository
- synthetic versus sanitized classification
- expected validation command
- expected high-level signals used by tests and verification
- links to planning keys or test issue keys where useful

Out of scope for the first version:

- external registry services
- generated documentation sites
- dynamic fixture discovery in CI beyond reading one catalog file

## Acceptance Criteria

- [ ] Every committed fixture under `tests/fixtures/` has one catalog entry.
- [ ] Each entry states whether the fixture is synthetic or sanitized.
- [ ] Each entry provides a canonical validation command.
- [ ] Each entry includes enough expected signals to help a contributor detect obvious misuse.
- [ ] Repository instructions can reference the catalog as the first place to look for fixture selection.

## Suggested Implementation Order

1. Create `tests/fixtures/fixture-catalog.json`.
2. Seed the existing synthetic CSV fixture.
3. Update fixture-related issues and test docs to reference the catalog.
4. Optionally teach the fixture verification script to read expected signals from the catalog later.

## Risks

- A catalog that is not maintained will become misleading quickly.
- Over-specifying fixture expectations will make normal fixture evolution painful.
- Mixing private local fixture references into the committed catalog would violate the repository privacy model.

## Issue Seed

Use this plan to open a focused maintenance issue for “fixture catalog bootstrap” once the user wants it tracked in GitHub.
