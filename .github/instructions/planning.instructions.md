---
applyTo: "docs/ways-of-work/plan/**/*.md"
description: "Use when creating or editing planning documentation under docs/ways-of-work/plan."
---

# Planning Documentation Rules

- Keep planning docs aligned with Epic > Feature > Story or Enabler > Test structure.
- Express acceptance criteria as concrete checklists when the document drives implementation.
- Record dependencies, risks, out-of-scope items, and validation commands explicitly.
- A Story that owns its implementation may declare `- None - <concrete rationale>` under `### Linked Enabler Issues`. Otherwise link only real same-feature Enablers; never create placeholders to satisfy validation.
- Structural validity, semantic planning completeness, and assignment readiness are separate. Preserve `needs-grooming` until the planning checks pass; an open blocker alone does not require that label but still blocks assignment. Resolve validator/policy conflicts through tested governance changes rather than invented links.
- Plan concrete, test-only issues alongside approved implementation Stories/Enablers before product code exists. Require parent ACs, one layer, expected scenarios, fixtures, test-file tasks, scoped commands, and explicit product blockers. Missing implementation blocks assignment, not planning; coverage anchors and empty placeholders remain prohibited.
- Keep repository paths relative and avoid machine-specific absolute paths.
- Reference only sanitized or synthetic financial artifacts.
