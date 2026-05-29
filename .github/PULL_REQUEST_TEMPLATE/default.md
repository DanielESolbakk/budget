# Definition of Done Checklist

When closing a planning issue, include this checklist in the PR description so reviewers and CI can verify delivery:

- [ ] Unit tests: added and passing
- [ ] Integration tests: added and passing (or documented exception)
- [ ] CI: all relevant checks passed
- [ ] Docs: usage and examples updated (or linked)
- [ ] Local audit files (e.g. `local/sanitization-map.json`) are `.gitignored` and documented
- [ ] PR: links planning issue (e.g. `#123`) and includes verification artifacts when applicable
- [ ] Acceptance criteria are mapped to tests (AC → tests) and documented in the PR body
- [ ] If fixtures changed, attach verification artifacts (e.g., `verification-report.json`) or link the verification report in the PR

Tip: link the planning issue using `Closes #<issue-number>` or `Refs #<issue-number>` in the PR body so traceability is recorded automatically.
