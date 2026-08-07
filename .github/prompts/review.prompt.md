---
name: review
description: Perform a risk-first code review for this repository.
---

Review the current change with a risk-first mindset.

Focus on:

1. Behavioral regressions and correctness risks.
2. Privacy and architecture boundary drift.
3. Missing or weak tests for changed behavior.
4. Planning issue and acceptance-criteria alignment when available.

Output requirements:

- List findings first, ordered by severity (`High`, `Medium`, `Low`).
- Include file references for each finding.
- Add concise open questions/assumptions after findings.
- End with a brief summary.
- If no findings, state that explicitly and mention residual risk/testing gaps.

