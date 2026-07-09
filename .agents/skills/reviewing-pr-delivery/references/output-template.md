# Findings-First Output Template

Use this structure for final review output.

## Findings

1. [Severity: High|Medium|Low] [Short title]

- Class: [anchor-issue violation|cross-issue semantic conflict|plan alignment gap|delivery hygiene gap]
- Confidence: [high|medium|low]
- Confidence basis: [one-line rationale tied to evidence quality]
- Why this matters: [risk or acceptance-criteria impact]
- Evidence: [file path/line, issue text, or command result]
- Recommendation: [specific fix or follow-up]

Repeat for each finding.

If no findings:

- No material findings identified against the requested scope.

## Coverage Summary

- Primary issue reviewed: #[number]
- AC coverage: [AC-by-AC status using satisfied/partially satisfied/unsatisfied/unproven]
- Plan alignment: [aligned|partial|not aligned] with one-sentence rationale
- Related issues reviewed: [source issue refs + PR additional planning refs]
- Related-issue overlap/gaps: [none|list]
- Additional planning issue status: [complete|ambiguous] with one-line justification

## Validation Evidence

- Commands run: [list]
- Result: [pass/fail]
- Baseline vs PR regression: [classification]
- If not run: [exact blocker]

## Claims Consistency Check

- PR narrative vs observed command output: [consistent|inconsistent]
- Checklist/DoD claims vs evidence: [consistent|inconsistent]
- Additional planning issue mapping/deferral status: [complete|ambiguous]
- Framework terminology vs repository toolchain evidence: [consistent|inconsistent]
- Framework-specific evidence terms used: [vitest e2e smoke|playwright runtime e2e|both|neither]
- Claim tiers used correctly for high-risk statements: [consistent|inconsistent]

## Residual Risks

- [Risk 1]
- [Risk 2]

## Reproducibility Context

- Branch: [name]
- Commit: [sha]
- Working tree: [clean|dirty + note]
- Evidence source: [local|CI|both]

## Issue Checkbox Sync

- Target issues updated: [list]
- Policy: [check-only|bidirectional]
- Updated checkboxes: [issue# + section + item]
- Left unchecked (insufficient/partial evidence): [issue# + section + item]
- Ambiguous items requiring human decision: [issue# + section + item]
- Post-update verification: [pass|fail] with one-line evidence
- PR mutation check: [no PR body edits, no PR comments]
- Issue comment check: [no issue comments posted for sync]
