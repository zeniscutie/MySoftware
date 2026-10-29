# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

MySoftware (`msw`) is a private Claude Code plugin for two people running a Shopify store.
It ships agents, slash commands, skills and hooks. See `PLAN.md` for the full plan and phases.
Parts are adapted from [ECC](https://github.com/affaan-m/ecc); credit them in `NOTICE.md`.

## Commands

```bash
npm ci --ignore-scripts   # install dev tools
npm run lint              # eslint + markdownlint
npm test                  # all tests (node:test)
MSW_TEST_ONLY=hooks npm test   # only test files whose path contains "hooks"
```

## Conventions

- Node >= 22, CommonJS, **no runtime dependencies**. Hooks must run with plain `node`.
- Works on macOS, Windows and Linux: use `path`, never hard-code `/` or home directories.
- File names: lowercase-with-hyphens (`liquid-reviewer.md`, `shopify-theme/SKILL.md`).
- Tests: one `*.test.js` per script under `tests/`, mirroring the source folder.
- Agents: Markdown with frontmatter `name`, `description`, `tools` (comma-separated scalar,
  not a YAML list), `model`.
- Skills: `skills/<name>/SKILL.md` with frontmatter `name` + `description`, sections
  When to Use / How It Works / Examples.
- Commands: Markdown with `description` frontmatter.

## Plugin manifest rules (Claude Code rejects these silently or with vague errors)

- `.claude-plugin/plugin.json` must have `version`; `commands`, `skills`, `hooks` are arrays.
- Never add an `agents` field to `plugin.json`.
- `hooks/hooks.json` holds only keys Claude Code accepts; IDs and descriptions go in
  `hooks/hooks.metadata.json`.
- Hook commands use `${CLAUDE_PLUGIN_ROOT}`, never absolute paths.

## Safety

- Never commit Shopify tokens (`shpat_`, `shpss_`, `shpca_`, `shppa_`) or `.env` files.
- Nothing in this repo should push to a live Shopify theme or deploy an app without the
  user's explicit OK.
