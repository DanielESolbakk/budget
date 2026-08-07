# Local Git Hooks (Optional)

This repository treats CI as the source of truth, but offers optional local hooks
for earlier feedback before pushing changes.

## Enable

From repository root:

```bash
git config core.hooksPath .github/hooks
chmod +x .github/hooks/pre-commit
```

## Disable

```bash
git config --unset core.hooksPath
```

## Included hooks

- `pre-commit`: runs lint and typecheck.

These hooks are intentionally minimal. If they create too much friction for a
local workflow, disable them and rely on CI checks.
