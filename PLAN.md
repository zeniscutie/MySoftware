# Plan: an ECC-style agent harness for running a Shopify store

Status: v0.1.0 built (Phases 0–2 done, Phase 3 is your first real use) · Reference: [affaan-m/ecc](https://github.com/affaan-m/ecc) v2.2.3 (MIT)

## 1. Goal

Build **MySoftware** (plugin slug `mysoftware`, short prefix `msw`) — a private Claude Code
plugin for two people running a Shopify store. It gives Claude a repeatable engineering loop:

```text
plan -> test -> implement -> review -> verify -> remember
```

and the Shopify know-how and guardrails the work needs: theme changes, store apps, discount
and checkout logic, and scripts that read or bulk-edit store data.

### Decisions

| Question | Decision |
|---|---|
| Name | **MySoftware** / `msw` |
| Audience | Private, two users (owner + business partner). No public docs, no npm package |
| Languages | Varies by task — see §3. Guidance is per *task type*, not one language |
| Reuse ECC text | **Yes** — adapt ECC agents/skills/commands, keep attribution in `NOTICE.md` |
| Distribution | **Plugin only**. No CLI installer (old Phase 3 dropped) |

### What we take from ECC

| ECC component | Where in ECC | Our version |
|---|---|---|
| Plugin manifest + marketplace | `.claude-plugin/` | Same, one plugin |
| Agents (Markdown + frontmatter) | `agents/` (71) | 4 general + 3 Shopify |
| Commands | `commands/` (97) | 5 general + 3 Shopify |
| Skills (`skills/<name>/SKILL.md`) | `skills/` (311) | 3 general + 6 Shopify |
| Rules | `rules/` | Short house rules injected at session start (see §2.5) |
| Hooks + `minimal\|standard\|strict` profiles | `hooks/`, `scripts/hooks/`, `scripts/lib/hook-flags.js` | Same idea, `MSW_*` env vars |
| Session memory | `hooks/memory-persistence/` | Same, local files only |
| CI validators | `scripts/ci/validate-*.js` | Same, 4 validators |

### Left out

Other AI tools (Cursor, Codex, OpenCode…), translations, ECC's Rust/Python side projects,
dashboard, hosted tier, learning "instinct" observer, the CLI installer, and all non-Shopify
domain packs.

## 2. Constraints learned from ECC

From `ecc/.claude-plugin/PLUGIN_SCHEMA_NOTES.md` and `ecc/hooks/README.md`:

1. `plugin.json` **must** have `version`; `commands`, `skills`, `hooks` must be **arrays**.
2. **No** `agents` field in `plugin.json` — it is rejected. Agents are found in `agents/`.
3. Agent `tools` frontmatter is a comma-separated scalar: `tools: Read, Grep, Glob`.
4. `hooks/hooks.json` holds **only** keys Claude Code accepts. IDs and descriptions live in
   `hooks/hooks.metadata.json`; a validator keeps the two aligned.
5. **Plugins cannot ship rules.** With no installer, house rules are a short file
   (`rules/house-rules.md`, kept under ~1.5 KB) that the `session:start` hook prints into
   context. Longer guidance lives in skills, which load only when relevant.
6. Hooks run on every tool call: fast, Node only (works on macOS/Windows/Linux), bounded
   stdin, never crash the session on bad input. Hook commands reference
   `${CLAUDE_PLUGIN_ROOT}` — no hard-coded paths.

## 3. Shopify task map

Which language and tooling each kind of work uses. Skills and the `shopify-architect` agent
use this table to pick an approach.

| Task | Language / tools | Skill |
|---|---|---|
| Theme edits (sections, blocks, templates, snippets) | Liquid, JSON templates, CSS, vanilla JS; Shopify CLI `shopify theme dev/pull/push`, Theme Check | `shopify-theme` |
| Custom/private app (admin UI, webhooks, background jobs) | TypeScript, Shopify app template (React Router), Polaris, App Bridge | `shopify-app` |
| Store data reads and bulk edits (products, inventory, orders, metafields) | GraphQL Admin API from Node or Python scripts; Bulk Operations for large jobs | `shopify-admin-api` |
| Discounts, delivery/payment customization, cart/checkout validation | Shopify Functions (JavaScript or Rust → WebAssembly) | `shopify-functions` |
| Webhooks and app security | HMAC verification, OAuth/session tokens, scopes | `shopify-webhooks` |
| Reports and one-off analysis (CSV exports, sales, stock) | Python (pandas) or Node | `store-data-scripts` |

Ground rules every Shopify skill repeats:

- Prefer the **GraphQL Admin API**; the REST Admin API is legacy. Pin an explicit API version
  and check Shopify's docs for the current one rather than trusting memory.
- Look up current API shapes with the Shopify Dev MCP server (`@shopify/dev-mcp`, shipped in
  the plugin's `.mcp.json`) before writing queries.
- Work against a **development store or unpublished theme first**. Changes to the live store
  happen only after the user says so.

## 4. Repository layout (target)

```text
.claude-plugin/
  plugin.json            # name, version, skills[], commands[], userConfig
  marketplace.json       # single-plugin marketplace
.mcp.json                # Shopify Dev MCP server (docs + schema lookup, no store access)
agents/
commands/
skills/<name>/SKILL.md   # + optional references/
rules/house-rules.md     # injected by session:start
hooks/
  hooks.json
  hooks.metadata.json
scripts/
  hooks/                 # one file per hook + run-with-flags.js
  lib/                   # hook-flags, hook-input, paths, secrets patterns
  ci/                    # validate-agents/commands/skills/hooks + manifest check
tests/
  hooks/ lib/ ci/ fixtures/
  run-all.js
.github/workflows/ci.yml
CLAUDE.md  README.md  CHANGELOG.md  NOTICE.md  LICENSE
```

## 5. Component specs

### 5.1 Plugin manifest

`plugin.json`: `name: mysoftware`, `version` (kept equal to `package.json`, checked in CI),
`skills: ["./skills/"]`, `commands: ["./commands/"]`, `userConfig`: `hooks_enabled` (default
true), `hook_profile` (default `standard`). `marketplace.json`: one entry, `source: "./"`.

Install (both partners, once):

```text
/plugin marketplace add zeniscutie/MySoftware
/plugin install mysoftware@mysoftware
```

The repo is private, so each person's git must be able to clone it (GitHub login or SSH key).

### 5.2 Agents (7)

| Agent | Tools | Purpose | Adapted from ECC |
|---|---|---|---|
| `planner` | Read, Grep, Glob | Requirements → phased plan with risks and file paths | `agents/planner.md` |
| `tdd-guide` | Read, Grep, Glob, Edit, Write, Bash | RED → GREEN → REFACTOR with evidence | `agents/tdd-guide.md` |
| `code-reviewer` | Read, Grep, Glob, Bash | Fresh-context review of the diff | `agents/code-reviewer.md` |
| `build-fixer` | Read, Grep, Glob, Edit, Bash | Smallest change to make build/typecheck green | `agents/build-error-resolver.md` |
| `shopify-architect` | Read, Grep, Glob | Picks theme vs app vs Function vs script for a request (§3) and plans it | new |
| `liquid-reviewer` | Read, Grep, Glob, Bash | Reviews theme changes: Theme Check, performance (image sizes, render-blocking JS), accessibility, OS 2.0 section/block schema | new |
| `shopify-security-reviewer` | Read, Grep, Glob | Tokens in code, webhook HMAC, OAuth scopes, customer data (PII) handling | `agents/security-reviewer.md` + Shopify specifics |

### 5.3 Commands (8)

General (adapted from ECC): `/plan-feature`, `/tdd`, `/review-changes`, `/save-session`, `/resume-session`.
(Named `/plan-feature` and `/review-changes` so they don't clash with Claude Code's built-in
planning and review commands.) `/plan-feature` keeps ECC's behaviour: runs inline, restates requirements, grounds in repo patterns,
**waits for confirmation before editing**, writes `.claude/plans/<name>.plan.md`.

Shopify:

- `/theme-preview` — pull the theme, make changes against an **unpublished** theme or
  `shopify theme dev`, give the preview link.
- `/store-query` — write and dry-run a GraphQL Admin query/mutation; mutations show a
  before/after sample and need confirmation before running against the store.
- `/shopify-review` — run `liquid-reviewer` or `shopify-security-reviewer` on the current diff
  depending on what changed.

### 5.4 Skills (9)

General: `tdd-workflow`, `verification-loop` (build → typecheck → lint → test → diff review),
`session-memory`. Shopify: the six in §3.
Each `SKILL.md`: frontmatter `name` + `description` (says *when* to use — that drives
auto-loading), sections When to Use / How It Works / Examples, under ~400 lines; long reference
material goes in `references/`.

### 5.5 House rules (`rules/house-rules.md`)

A short list, printed at session start: plan before multi-file changes; tests for logic;
no secrets in code; dev store / unpublished theme first; ask before anything that touches
the live store, sends customer emails, or changes prices/inventory in bulk.

### 5.6 Hooks (7)

All hooks go through `scripts/hooks/run-with-flags.js <hookId> <script> <profilesCsv>`:
bounded stdin, `MSW_HOOKS_ENABLED`, `MSW_HOOK_PROFILE` (`minimal|standard|strict`, invalid →
`standard`), `MSW_DISABLED_HOOKS` (comma list), plugin `userConfig` as fallback. Fails open on
internal errors, except the safety hooks marked *fail-closed*.

| ID | Event / matcher | Profiles | Behavior |
|---|---|---|---|
| `session:start` | SessionStart | all | Print house rules + last session summary for this repo (capped by `MSW_SESSION_START_MAX_CHARS`; opt out with `MSW_SESSION_START_CONTEXT=off`) |
| `pre:compact` | PreCompact | standard, strict | Save working state before compaction |
| `session:end` | SessionEnd | standard, strict | Write summary to `~/.claude/mysoftware/sessions/<repo-id>/` (local only) |
| `pre:bash:no-verify` | PreToolUse `Bash` | all | Block `git commit/push --no-verify` |
| `pre:bash:shopify-live` | PreToolUse `Bash` | all, *fail-closed* | Block `shopify theme push` / `publish` without `--unpublished` or an explicit `--theme`, `shopify theme push --allow-live`, and `shopify app deploy`, telling Claude to ask the user first |
| `pre:write:secrets` | PreToolUse `Edit\|Write` | all, *fail-closed* | Block writing Shopify tokens (`shpat_`, `shpss_`, `shpca_`, `shppa_`), API secrets or `.env` contents into tracked files |
| `post:edit:quality` | PostToolUse `Edit\|Write` | strict | Run the matching check on the edited file (Theme Check for Liquid, `tsc`/eslint for TS, `ruff` for Python if installed); report, don't block |

### 5.7 CI validators

`scripts/ci/validate-{agents,commands,skills,hooks}.js` + a manifest check: frontmatter,
required sections, lowercase-hyphen names, `hooks.json` allowed keys, hooks ↔ metadata
alignment, version sync, no personal absolute paths, no Shopify tokens committed. CI runs on
ubuntu, macos, windows × Node 22, 24.

## 6. Phases

Each phase ends with something usable and CI green.

### Phase 0 — Skeleton (S) · *done*

- `package.json` (no runtime deps; dev: eslint, markdownlint-cli2), `.gitignore`, `LICENSE`,
  `NOTICE.md`, `CLAUDE.md`, lint configs.
- `tests/run-all.js` + a smoke test; `.github/workflows/ci.yml` (lint + tests on the matrix).
- **Done when:** CI is green on all three OSes.

### Phase 1 — Content plugin (M) · *done*

- `.claude-plugin/` manifests, `.mcp.json` with Shopify Dev MCP.
- 7 agents, 8 commands, 9 skills, `rules/house-rules.md`.
- Validators for agents, commands, skills, manifest; wired into CI.
- **Done when:** both partners can install the plugin; `/plan-feature` asks a Shopify question the
  right way (picks theme vs app vs script, waits for confirmation); the validators fail on a
  deliberately broken fixture.

### Phase 2 — Hooks (M) · *done*

- `run-with-flags.js`, `lib/hook-flags.js`, `lib/hook-input.js`, the 7 hooks,
  `hooks.json` + `hooks.metadata.json`, `validate-hooks.js`.
- Fixture tests per hook: allow, block, malformed input, oversized input, disabled by env,
  wrong profile. For `pre:bash:shopify-live`: `theme push --unpublished` allowed,
  `theme push --allow-live` blocked, `theme publish` blocked, `theme dev` allowed.
- **Done when:** hooks load with no schema warnings, each runs in < 200 ms, a live theme push
  is stopped and Claude asks first, and a new session shows the previous summary.

### Phase 3 — First real use (S)

- Use it on one real theme change and one store-data script; fix what's awkward.
- `README.md` (install, profiles, how to turn a hook off), `CHANGELOG.md` · *done*.
- Verified: `claude plugin validate --strict` passes; installs from the marketplace; in a real
  headless session the house rules load, `shopify theme publish` is blocked and Claude asks
  first, and the session summary is saved.

### Later

`/learn` (save a session's lesson as a skill, user-approved), Hydrogen/headless skill if the
store ever goes headless, Shopify Flow recipes, a store-metrics report command.

## 7. Risks

| Risk | Mitigation |
|---|---|
| A change hits the live store by accident | `pre:bash:shopify-live` hook (fail-closed), house rule, `/theme-preview` defaults to unpublished themes, mutations need confirmation |
| Shopify tokens leak into git | `pre:write:secrets` hook, CI token scan, `.env` in `.gitignore` |
| Shopify API changes (quarterly versions) make skills stale | Skills say to check the Dev MCP / docs, pin versions explicitly, date each skill's "last checked" line |
| Claude Code plugin/hook schema is stricter than documented | Manifest + allowed-keys tests in CI; ECC's schema notes as the checklist |
| A hook bug blocks or slows every tool call | Fail open by default, timeouts, byte-capped stdin, `MSW_DISABLED_HOOKS` kill switch, `minimal` profile |
| Too much context loaded every session | House rules capped at ~1.5 KB, skills load on demand, session summary capped |
| Private repo can't be cloned by the plugin system | Both partners sign in to GitHub in git first; noted in README |
