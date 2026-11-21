# Budget Planner Domain Glossary

Use these terms consistently in planning docs, code, tests, and issue templates.

## Core Terms

| Term | Definition | Notes |
| --- | --- | --- |
| household | The local budgeting context managed by one user across one or more accounts. | First release supports one household user. |
| account | A source or destination ledger account such as checking, savings, or credit card. | Accounts belong to a household. |
| transaction | A dated financial record with amount, direction, account, and provenance. | Imported or manually entered. |
| category | A user-visible spending or income classification for transactions, identified independently of its editable display name. | Planned F3.4 management preserves stable IDs; merged categories remain inactive records resolving to their active destination. |
| merchant alias | A normalized merchant representation used to map raw merchant text to stable names. | Supports deterministic categorization. |
| categorization rule | A deterministic rule that maps transaction signals to categories and confidence. | Refined by user corrections. |
| import job | A tracked import execution for CSV, PDF, or manual batch activity. | Must include status and provenance metadata. |
| budget target | A planned amount for a category within a time period, typically monthly. | Compared against actuals. |
| forecast assumption | An explicit input used by forecasting logic, such as recurring amounts or growth assumptions. | Must remain auditable. |
| backup snapshot | A user-initiated exportable backup of local budgeting data for recovery. | Must avoid vendor lock-in. |

## Asset Registry Terms

| Term | Definition | Notes |
| --- | --- | --- |
| asset | Something recorded as value-bearing for the household, such as property or an investment holding. | Recording an asset does not establish legal ownership. |
| liability | An amount the household records as owed, such as a loan or mortgage. | Household responsibility is distinct from property ownership. |
| property | A locally labeled household asset whose value may be recorded over time. | A street address is not required; valuations are entered manually. |
| loan/mortgage | A liability record for a loan, including a mortgage secured against property. | Recording a loan does not imply legal attribution. |
| investment holding | An asset position, such as a fund, whose value may be recorded over time. | Cost basis and valuations are total amounts for the holding, not per-unit amounts. Holdings and their ownership shares are separate records. |
| valuation snapshot | An append-only manually entered amount and original currency for an asset at an effective date. | Also records when the snapshot was entered as an ISO timestamp. |
| valuation correction | An append-only record that supersedes or voids a prior valuation snapshot without deleting it. | References one active target valuation; a void record preserves its original date, amount, and currency. |

## Mortgage Evidence Terms

| Term | Definition | Notes |
| --- | --- | --- |
| mortgage import receipt | Local provenance for an imported mortgage document and its interpretation. | Records document role, digest, parser version, source dates or unknown status, import time, validation, and pairing evidence; it does not retain the full page by default. |
| bank-plan version | An immutable interpretation of a lender-supplied repayment plan. | It is projected bank evidence, not an actual balance history or a booked transaction. |
| mortgage schedule period | A source-defined monthly or annual interval with lender-supplied payment and balance evidence. | Monthly installments and annual summaries have distinct coverage and are never added as duplicate payments. |
| mortgage obligation | A stable identity for a projected payment occurrence across bank-plan versions. | It is not a ledger transaction; a newer plan version does not create another payable copy. |
| source-only loan | An explicitly incomplete loan record that can retain valid bank evidence while actual balance or other terms remain unknown. | Missing actuals are not replaced with zero, projected debt, or import time. |
| source-as-of date | The date a source document describes, when known. | Kept separate from import time, rate-effective date, planned-payment date, and transaction booking date. |

## Supporting Terms

| Term | Definition | Notes |
| --- | --- | --- |
| parser adapter | Source-specific parser implementation for a statement format. | Avoid one giant parser with mixed heuristics. |
| import provenance | Metadata that explains where a transaction came from and how it was ingested. | Required for traceability and debugging. |
| duplicate detection | Logic that prevents re-importing the same transaction as a new record. | Supports idempotent imports. |
| review queue | A list of low-confidence or ambiguous categorization results that need confirmation. | Must be visible to the user. |
| correction | A user action that changes an incorrect categorization result. | Should improve future rule behavior. |
| confidence score | A deterministic score that indicates categorization certainty. | Drives review queue behavior. |
| no-network verification | A test that confirms default workflows do not send transaction content externally. | Required in development and packaged builds. |
| SIFO household profile | Explicit household calculation bands and source-table selections used to compose a SIFO reference budget. | Does not require names, exact birth dates or inferred demographics. |
| SIFO reference budget | An itemized national acceptable-consumption reference composed from an explicitly selected SIFO edition and household profile. | A long-term supplementary reference, not average spending, an income benchmark, poverty threshold or complete budget; original and locally adjusted amounts remain distinguishable. |
| reference edition | A verified, attributed source version supplying reference-budget rates and assumptions. | Identify source date/version as well as year; basket revisions are not necessarily pure inflation. |
| indicative reference remainder | Classified booked income minus selected reference consumption minus classified other expenditure. | Withheld as a complete overall result when coverage, FX or relevant amounts are unresolved; not guaranteed spendable cash. |

## Naming Guidance

- Prefer these glossary terms over near-duplicates.
- Use household, account, transaction, category, merchant alias, categorization rule, import job, budget target, forecast assumption, and backup snapshot as canonical names.
- If a new domain term is introduced, add it here in the same change that introduces it.
