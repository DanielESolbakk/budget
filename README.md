# Budget Planner

Windows-first, local-first budget planning software for a household user managing multiple accounts on one machine.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- npm (included with Node.js)

### Install dependencies

```bash
npm install
```

### Start the desktop application

```bash
npm start
```

This starts Electron in development mode and opens the desktop window. The ledger is stored locally under `data/local/`; transaction content is not sent to a server.

### Bring in transactions

Use **Import statement** in the application header from any workspace, or open **Activity** > **Import**, then use **New import**. Choose **Choose statement file** to select a local `.csv`, `.txt`, or digital `.pdf`; the app routes it to the matching import flow. Check the destination account and preview the dates, merchants, amounts, and any duplicate or excluded rows before confirming. Nothing is added from a statement until confirmation. The completion receipt names the source file and account and summarizes what was added or skipped. The original statement stays in its folder; the ledger stores imported rows and a history record, not a copy of the file.

While reviewing an unconfirmed statement, use **Hide preview** to fold the rows without losing duplicate choices or acknowledgements; **Show preview** restores them. **Cancel import** discards the unconfirmed statement and returns to file selection without saving transactions. During a long file check, **Cancel preview** stops that check.

Use **Import row review** to correct unresolved source rows into transactions or dismiss them with a reason. Correction drafts are saved on this device and restored after an app restart; draft data is temporary and is not included in backup snapshots. A changed file must be previewed again before confirmation. Use **Import history** to review completed jobs and undo an import. Undo removes only unchanged transactions from that import; transactions changed after import, or whose original values cannot be verified, are kept and listed with the reason. Categorization rules are not removed. Manual entry is a separate **Enter transaction manually** action, and uncategorized transactions appear in **Review what needs attention**.

The current text/PDF adapter reads Rogaland Sparebank statements, including binary digital PDFs. Scanned images and unknown bank layouts are not supported yet; more bank adapters can be added later. For a safe trial, use the synthetic fixtures in this repository:

- `tests/fixtures/synthetic/rogaland-2026-05-synthetic.csv`
- `tests/fixtures/synthetic/rogaland-2026-05-binary.pdf`
- `tests/fixtures/synthetic/rogaland-2026-05-statement.txt`

Repeat imports of an unchanged source are skipped, and import jobs retain local provenance. When statements overlap or contain indistinguishable rows without a stable bank reference, the app cannot prove that rows from different files are the same purchase; check the ledger after importing overlapping exports. Back up locally before restoring another snapshot, since restore replaces the current ledger and learned categorization rules.

When a preview finds possible duplicates, choose **Skip all duplicate candidates** or **Import all duplicate candidates**, then change any individual row that needs a different decision. Confirm the import only after reviewing those choices; importing a candidate may add a transaction already in your ledger.

The reconciliation receipt separates added, deliberately skipped, pending, and unresolved rows. Skipped duplicates and pending rows can explain a difference between the source and newly added transactions without requiring another correction. The signed totals remain visible; unresolved rows and unexplained differences still need review.

### Review categories, statement coverage, and currency

The main navigation groups daily work into **Review**, **Activity** (Transactions, Pending, and Import), **Accounts** (statement coverage), and **Household** (Properties, Loans, Exchange rates, and Data safety).

The daylight workspace uses the same controls and financial states throughout setup, review, imports, and household records. Monthly totals and checks appear before the detailed targets, categories, and forecast. On narrow windows, navigation becomes a compact top row and content stacks vertically; wide tables retain their own horizontal scrolling. Keyboard users can use the first **Skip to workspace** link to bypass navigation.

An empty category-review queue uses a compact confirmation; expand it for an explanation of what appears there. Secondary row actions stay visually quieter than statement import. Workspace descriptions sit below their titles, financial comparisons align amounts, and empty household registries group their message with the existing creation action.

Statement previews, duplicate comparisons, category review, the ledger, allocation summaries, and pending items display each transaction's recorded currency without converting its amount. Foreign amounts include an explicit currency code, so currencies such as SEK and DKK cannot be mistaken for NOK. Compact category corrections place the future-learning explanation, category selector, and save action in reading order. In-page navigation keeps local actions available without trusting another renderer document or window.

Monthly category checks include both uncategorized transactions and low-confidence category decisions for the selected month. **Open all-month queue** opens and focuses the full category-review queue, regardless of ledger filters. Saving a category also remembers it for future transactions matching that merchant; the form explains this before saving. Saving a budget target refreshes the selected month's comparison and checks. If that refresh fails, the saved target remains available and an explicit review error offers a retry.

In **Activity** > **Transactions**, use **Allocate categories** to split one booked transaction across categories. Allocation amounts keep the source transaction's sign and currency and must sum exactly to its amount. Category totals use the allocations; household cashflow and CSV export retain the source transaction once.

In **Review**, check the account-coverage summary before relying on monthly totals. This summary covers all recorded periods, not only the selected month; it is not proof that the month is complete. Open **Accounts** to record statement periods and dated opening/closing balances. A period remains **Unknown** until you confirm it. Empty periods, overlapping periods, late imports, stale or missing checkpoints, and reconciliation differences are shown as distinct states. Checkpoints and coverage history are stored locally and included in backups.

In **Household** > **Exchange rates**, record a foreign-currency rate as NOK per one unit of currency or import a local CSV with `currencyCode,rateNokPerUnit,effectiveDate,kind` columns. Reports keep native-currency subtotals and show the dated NOK conversion and rate provenance. Missing rates leave the NOK subtotal incomplete; they are never treated as zero or a 1:1 rate. Monthly reference rates are used only after explicit selection. Latest-rate restatement is an isolated scenario and does not change historical actual reports. The app does not fetch rates or send transaction data to a service.

In **Household** > **Properties**, create a local property label and add dated valuations in the currency you record. Valuation history preserves recorded timestamps and corrections.

In **Household** > **Loans**, add loan or mortgage terms and optionally link an existing property. Append dated actual balance snapshots as statements arrive; recorded timestamps and original currency are preserved in local storage and backups. These actual balances remain separate from forecast projections. The registry does not fetch or substitute exchange rates.

On each property, edit the household ownership share; on each loan, edit the household responsibility share separately. Enter a percentage from 0 to 100 with up to two decimal places (for example, `75.25` or `75,25`). Both default to 100% and are saved locally and in backup snapshots using exact whole basis points internally. Shares do not change recorded amounts or currencies and do not determine legal ownership or liability.

In **Household** > **Data safety**, create a local backup, export ledger data, or restore a saved backup snapshot.
Version 9 backups missing a property ownership share or loan responsibility share are rejected rather than restoring an incorrect share. Older backups without these shares restore them as 100%.

### Build for production

```bash
npm run build
```

Electron Vite writes the build to `out/` (`out/main`, `out/preload`, and `out/renderer`). This is a build artifact, not an installer.

### Run checks

```bash
# Type checking
npm run typecheck

# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# Vitest end-to-end smoke tests
npm run test:e2e:vitest

# Playwright runtime tests
npm run test:e2e:playwright

# No-network verification
npm run verify:no-network
```

## Mission

This project is building a desktop application that:

- runs locally with a graphical user interface
- keeps transaction content on-device by default
- supports digital PDF bank statements, CSV imports, and manual transaction entry
- categorizes transactions using merchant normalization and deterministic rules before any smarter local automation is introduced
- provides budgeting, forecasting, search, review, backup, and export workflows

## Current Direction

- Stack: Electron, React, TypeScript, and SQLite
- Scope: one local household user managing multiple accounts
- Import model: digital text PDFs, CSVs, and manual entry first
- Categorization strategy: rules-first with confidence scoring and review flows
- Privacy model: no bank APIs, no cloud processing of transaction content, no telemetry by default

## AI Oversight Snapshot

- We use AI to speed delivery, but every important change is checked by automated quality gates before merge.
  Learn more: [.github/workflows/ci.yml](.github/workflows/ci.yml), [.github/workflows/check-dor-dod.yml](.github/workflows/check-dor-dod.yml)
- A deterministic performance harness validates import and packaging behavior against a known baseline to catch drift early.
  Learn more: [scripts/run-skill-evals.ts](scripts/run-skill-evals.ts), [tests/fixtures/synthetic/backup-restore-performance-contract.json](tests/fixtures/synthetic/backup-restore-performance-contract.json)
- Coverage, mutation testing, and dependency risk are tracked as explicit CI signals so weak test quality and security risk stay visible.
  Learn more: [vitest.unit.config.ts](vitest.unit.config.ts), [stryker.config.json](stryker.config.json), [scripts/check-dependency-governance.ts](scripts/check-dependency-governance.ts)
- A consolidated AI failure feedback report summarizes unresolved failures and warnings into a single actionable checklist.
  Learn more: [scripts/ai-failure-feedback-loop.ts](scripts/ai-failure-feedback-loop.ts), [reports/ai-feedback/ai-failure-feedback.md](reports/ai-feedback/ai-failure-feedback.md)
- A skill pruning loop reviews AI skill packs and flags optional or stale packs to reduce maintenance overhead.
  Learn more: [scripts/ai-skill-pruning-loop.ts](scripts/ai-skill-pruning-loop.ts), [reports/ai-skill-pruning/ai-skill-pruning.md](reports/ai-skill-pruning/ai-skill-pruning.md)
- A high-risk judgment checkpoint classifies release risk and requires explicit tradeoff and rollback rationale for high-blast-radius changes.
  Learn more: [scripts/high-risk-judgment-checkpoint.ts](scripts/high-risk-judgment-checkpoint.ts), [reports/high-risk-checkpoint/high-risk-checkpoint.md](reports/high-risk-checkpoint/high-risk-checkpoint.md), [.github/PULL_REQUEST_TEMPLATE/default.md](.github/PULL_REQUEST_TEMPLATE/default.md)
- CI always uploads governance artifacts (coverage, mutation, dependency, AI feedback, skill pruning, and risk checkpoint) for transparent review.
  Learn more: [.github/workflows/ci.yml](.github/workflows/ci.yml)
- Planning and policy source of truth for AI work lives in plan and repository AI instructions.
  Learn more: [plan.md](plan.md), [.github/copilot-instructions.md](.github/copilot-instructions.md), [.github/instructions/style.instructions.md](.github/instructions/style.instructions.md), [.github/instructions/planning.instructions.md](.github/instructions/planning.instructions.md), [.github/instructions/testing.instructions.md](.github/instructions/testing.instructions.md), [.github/instructions/playwright.instructions.md](.github/instructions/playwright.instructions.md)

## Agent Readiness

- Universal entrypoint for agents: [AGENTS.md](AGENTS.md)
- Repo-wide policy: [.github/copilot-instructions.md](.github/copilot-instructions.md)
- Agent bootstrap workflow: [.github/workflows/copilot-setup-steps.yml](.github/workflows/copilot-setup-steps.yml)
- Path-scoped instruction packs: [.github/instructions](.github/instructions)
- Custom reviewer assets: [.github/agents/reviewer.agent.md](.github/agents/reviewer.agent.md), [.github/prompts/review.prompt.md](.github/prompts/review.prompt.md)
- Dependabot updates and alerts are managed in GitHub repository settings.
- Optional local hooks: [.github/hooks/README.md](.github/hooks/README.md)

## Public Repository Handling

This repository is public.

- Never commit secrets, tokens, credentials, private keys, or `.env` files with real values.
- Never commit raw bank statements, unsanitized financial exports, backups, or local databases.
- Only commit sanitized or synthetic fixtures that are safe for public distribution.
- Use repository-relative paths in committed documentation instead of machine-specific absolute paths.
- Keep sensitive local-only files in gitignored paths such as `local/`, `private/`, `data/local/`, `backups/local/`, and `fixtures/private/`.

## Planning Files

The planning work for this project is centered around:

- `plan.md`
- `.github/copilot-instructions.md`
- `.github/instructions/style.instructions.md`
- `.agents/skills/issue-planning-governor/SKILL.md`

The docs tree under `docs/ways-of-work/plan/` will hold the feature PRD, technical breakdown, implementation plan, project plan, and issue checklist as those artifacts are created.
