# Fixture Verification Report Contract

## Objective

Define the machine-readable JSON contract emitted by `npm run verify-fixture` and uploaded by `.github/workflows/verify-fixtures.yml`.

## Report Location

- Local CLI usage can write a report explicitly with `npm run verify-fixture -- --input tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv --report reports/fixture-verification/rogaland-2026-05-synthetic.verification-report.json`.
- CI writes one report per committed synthetic CSV fixture under `reports/fixture-verification/`.
- The committed example contract lives at `tests/fixtures/verification-reports/rogaland-2026-05-synthetic.verification-report.json`.

## JSON Shape

```json
{
  "ok": true,
  "errors": [],
  "warnings": [],
  "stats": {
    "rowCount": 10,
    "nonNokRowCount": 1,
    "reservedRowCount": 1,
    "holdRowCount": 0,
    "transferRowCount": 2,
    "fxRowCount": 1,
    "kidReferenceCount": 1,
    "uniqueMerchantCount": 9,
    "merchantTokenDistribution": {
      "MERCHANT": 8
    }
  }
}
```

## Field Semantics

- `ok`: `true` only when the verifier found no errors.
- `errors`: deterministic structural or data-validation failures such as wrong delimiters, malformed header order, mojibake, invalid dates, non-numeric amount fields, or missing FX coverage.
- `warnings`: deterministic non-fatal findings such as near-duplicate merchant variants or empty amount columns.
- `stats.rowCount`: number of transaction rows after the header row.
- `stats.nonNokRowCount`: rows whose `Valuta` is present and not `NOK`.
- `stats.reservedRowCount`: rows flagged as reserved through `Status`.
- `stats.holdRowCount`: rows flagged through hold-specific `Status` or `Undertype` signals.
- `stats.transferRowCount`: rows whose type or reference indicates a transfer or payment flow.
- `stats.fxRowCount`: rows signalling foreign-exchange coverage through non-`NOK` currency, foreign undertype, or `FX-` reference.
- `stats.kidReferenceCount`: rows whose reference field contains `KID` or invoice markers.
- `stats.uniqueMerchantCount`: count of normalized merchant keys after whitespace and punctuation normalization.
- `stats.merchantTokenDistribution`: normalized merchant-token frequency map sorted by token so repeated runs emit stable JSON.

## Determinism Rules

- Header validation uses the committed import-fixture column order.
- CSV files must use semicolon delimiters.
- Text must remain UTF-8 and free of common mojibake sequences.
- Date values must use `dd.MM.yyyy`.
- `Beløp inn` and `Beløp ut` must be numeric when populated.
- JSON field ordering follows the committed example report so fixture diffs stay reviewable.

## CI Failure Contract

- `.github/workflows/verify-fixtures.yml` must upload the generated report artifacts even when a fixture fails verification.
- The workflow must exit non-zero when any generated report has `ok: false`.
