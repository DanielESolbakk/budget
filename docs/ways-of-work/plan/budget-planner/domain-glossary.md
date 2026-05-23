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
