# Budget Planner Domain Glossary

Use these terms consistently in planning docs, code, tests, and issue templates.

## Core Terms

| Term | Definition | Notes |
| --- | --- | --- |
| household | The local budgeting context managed by one user across one or more accounts. | First release supports one household user. |
| account | A source or destination ledger account such as checking, savings, or credit card. | Accounts belong to a household. |
| transaction | A dated financial record with amount, direction, account, and provenance. | Imported or manually entered. |
| category | A user-visible spending or income classification for transactions. | Default categories are editable. |
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
| investment holding | An asset position, such as a fund, whose value may be recorded over time. | Holdings and their ownership shares are separate records. |
| valuation snapshot | An append-only manually entered amount and original currency for an asset at an effective date. | Also records when the snapshot was entered as an ISO timestamp. |
| valuation correction | An append-only record that supersedes or voids a prior valuation snapshot without deleting it. | References one active target valuation; a void record preserves its original date, amount, and currency. |

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

## Naming Guidance

- Prefer these glossary terms over near-duplicates.
- Use household, account, transaction, category, merchant alias, categorization rule, import job, budget target, forecast assumption, and backup snapshot as canonical names.
- If a new domain term is introduced, add it here in the same change that introduces it.
