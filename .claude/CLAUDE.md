# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

MySoftware (`msw`) is a private Claude Code plugin for two people running a Shopify store.
It ships agents, slash commands, skills and hooks. See `PLAN.md` for the design and `README.md`
for install and settings. Parts are adapted from [ECC](https://github.com/affaan-m/ecc); list
any newly adapted file in `NOTICE.md`.

## Commands

```bash
npm ci --ignore-scripts   # install dev tools
npm run check             # lint + validators + tests (run before every commit)
npm run validate          # agents/commands/skills, manifest + hooks, secrets/personal-path scan
npm test                  # all tests (node:test)
MSW_TEST_ONLY=hooks npm test   # only test files whose path contains "hooks"
claude plugin validate --strict .   # Claude Code's own validator
claude --plugin-dir .     # try the plugin without installing it
```

## Layout

- `agents/*.md`, `commands/*.md`, `skills/<name>/SKILL.md` — plugin content.
- `rules/house-rules.md` — printed into context at session start (keep it under ~1.5 KB).
- `hooks/hooks.json` — hook wiring; every hook goes through
  `scripts/hooks/run-with-flags.js <id> <script.js> <profiles>`. Descriptions live in
  `hooks/hooks.metadata.json` (validated to match).
- `scripts/hooks/*.js` — each exports `run(input, context)` returning
  `{ exitCode, stdout, stderr }`; safety hooks also export `failClosed(raw)`.
- `scripts/lib/` — shared code, `scripts/ci/` — validators, `tests/` mirrors `scripts/`.

## Conventions

- Node >= 22, CommonJS, **no runtime dependencies**. Hooks must run with plain `node`.
- Works on macOS, Windows and Linux: use `path`, never hard-code `/` or home directories.
- File names: lowercase-with-hyphens.
- Agents: frontmatter `name` (= file name), `description` (when to use), `tools`
  (comma-separated scalar, not a YAML list), `model` (`inherit|sonnet|opus|haiku`).
- Skills: frontmatter `name` (= folder) + `description`; sections `## When to Use`,
  `## How It Works`, `## Examples`; under 500 lines.
- Commands: frontmatter `description` (+ `argument-hint`); use `$ARGUMENTS`.
- Tests build fake tokens at runtime (`'shp' + 'at_' + …`) so the repo scan stays clean.
- Version lives in `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
  and `CHANGELOG.md`; bump all four together.

## Plugin manifest rules

- `plugin.json` must have `version`; `commands` and `skills` are arrays.
- Never add `agents` or `hooks` to `plugin.json` (agents are auto-discovered; listing
  `hooks/hooks.json` loads it twice).
- `hooks/hooks.json` holds only `hooks`; hook commands use `${CLAUDE_PLUGIN_ROOT}`.

## Safety

- Never commit Shopify tokens (`shpat_`, `shpss_`, `shpca_`, `shppa_`) or `.env` files.
- Nothing here may push to a live theme or deploy an app without the user's explicit OK.
