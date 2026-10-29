---
name: verification-loop
description: Check work before calling it done - build, typecheck, lint, tests, Theme Check, secrets scan and a diff review - then give a PASS/FAIL report. Use after finishing a feature or fix, before committing, before a pull request, and before any theme push or app deploy.
---

# Verification loop

## When to Use

- You are about to say "done".
- Before `git commit`, opening a pull request, `shopify theme push`, or `shopify app deploy`.
- After a refactor or a dependency update.

## How It Works

Run each phase that applies to the project. Stop at the first hard failure, fix it, and start
again from that phase. Use `set -o pipefail` when piping output through `head`/`tail` so the
real exit code is kept.

### 1. Build

| Project | Command |
|---|---|
| Node / app | `npm run build` (if the script exists) |
| Shopify app | `shopify app build` |
| Function (Rust) | `cargo build --target wasm32-wasip1 --release` |
| Python | `python -m compileall -q .` |

### 2. Types

`npx tsc --noEmit` (TypeScript), `pyright` or `mypy` (Python, if configured).

### 3. Lint and format

`npm run lint`, `ruff check .`, `cargo clippy`. For themes: `shopify theme check`.

### 4. Tests

The project's test command (see `tdd-workflow`). Report passed/failed/total and coverage if
measured.

### 5. Secrets and personal data

```bash
git diff --cached --name-only    # what will be committed
git diff | grep -nE 'shp(at|ss|ca|pa)_[a-fA-F0-9]{32}|sk_live_|BEGIN .*PRIVATE KEY' || echo "no secrets found"
```

Also check new test fixtures and logs for real customer names, emails or addresses.

### 6. Diff review

`git diff --stat` then read every changed hunk: unintended changes, leftover debug output
(`console.log`, `print`, `{{ product | json }}`), missing error handling, TODOs.

### 7. Store safety (Shopify work)

- Theme changes were previewed on an unpublished theme or `shopify theme dev`.
- Scripts that change data were dry-run and a backup exists.
- Nothing was pushed live or deployed without the user's explicit yes.

## Examples

Report format:

```text
VERIFICATION
Build:     PASS
Types:     PASS
Lint:      PASS (2 warnings, unchanged files)
Tests:     PASS 41/41, coverage 86%
Theme:     n/a
Secrets:   PASS
Diff:      5 files, no stray debug output
Store:     previewed on "Dev – new header" (unpublished)

Overall:   READY to commit
Not checked: mobile Safari layout (no device available)
```

Say clearly what was **not** checked rather than implying everything was.
