---
applyTo: "docs/ways-of-work/plan/**/*.md"
description: "Use when creating or editing planning documentation under docs/ways-of-work/plan."
---

# Planning Documentation Rules

- Keep planning docs aligned with Epic > Feature > Story or Enabler > Test structure.
- Express acceptance criteria as concrete checklists when the document drives implementation.
- Record dependencies, risks, out-of-scope items, and validation commands explicitly.
- A Story that owns its implementation may declare `- None - <concrete rationale>` under `### Linked Enabler Issues`. Otherwise link only real same-feature Enablers; never create placeholders to satisfy validation.
- Structural validity is separate from semantic readiness. Preserve `needs-grooming` until the readiness checks pass, and resolve validator/policy conflicts through tested governance changes rather than invented links.
- Keep repository paths relative and avoid machine-specific absolute paths.
- Reference only sanitized or synthetic financial artifacts.
