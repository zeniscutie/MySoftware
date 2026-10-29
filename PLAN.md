# Plan: an ECC-style agent harness for Claude Code

Status: draft for review · Reference: [affaan-m/ecc](https://github.com/affaan-m/ecc) v2.2.3 (MIT)

## 1. Goal

Build **MySoftware** (working name; plugin slug `mysoftware`, short prefix `msw`) — a
Claude Code plugin that gives the agent a repeatable engineering loop:

```text
plan -> test -> implement -> review -> verify -> remember
```

It ships as one installable package containing agents, slash commands, skills, rules and
hooks, plus a small CLI that installs it outside the plugin system and checks the install.

### What we take from ECC

ECC proved out a component model that works. We reuse the *shape*, not the volume:

| ECC component | What it is | Where in ECC | Our version |
|---|---|---|---|
| Plugin manifest | `plugin.json` + `marketplace.json` | `.claude-plugin/` | Same, one plugin |
| Agents | Markdown + YAML frontmatter (`name`, `description`, `tools`, `model`) | `agents/` (71) | 5 agents |
| Commands | Markdown slash commands with `description` frontmatter | `commands/` (97) | 6 commands |
| Skills | `skills/<name>/SKILL.md` with When to Use / How It Works / Examples | `skills/` (311) | 6 skills |
| Rules | Always-on guidance, `common/` + per-language | `rules/` | `common/` + `typescript/` |
| Hooks | `hooks/hooks.json` → Node scripts, gated by profile | `hooks/`, `scripts/hooks/` | 6 hooks |
| Hook profiles | `minimal \| standard \| strict` + disable list via env | `scripts/lib/hook-flags.js`, `run-with-flags.js` | Same idea, `MSW_*` env vars |
| Session memory | SessionStart loads last summary, PreCompact/SessionEnd save it | `hooks/memory-persistence/` | Same, local files only |
| Installer | Manifest-driven modules + profiles, install-state for clean uninstall | `manifests/`, `scripts/install-apply.js`, `scripts/lib/install-state.js` | Smaller: 4 modules, 3 profiles |
| CI validators | Lint every agent/skill/command/hook file | `scripts/ci/validate-*.js` | Same, 5 validators |

### What we deliberately leave out (v1)

- Multi-harness support (Codex, Cursor, OpenCode, Gemini, Kiro, Qwen…). ECC carries a
  directory and install target per harness; that is most of its maintenance cost.
  **Claude Code only** for v1; design the installer so a second target can be added later.
- Translated docs (ECC ships ~15 languages).
- The Rust `ecc2/` control plane, Python `src/llm/` provider layer, `ecc_dashboard.py`,
  GitHub App / hosted Pro tier, continuous-learning "instinct" observer, GAN/multi-model loops.
- Domain skill packs (marketing, prediction markets, supply chain, etc.).

## 2. Constraints learned from ECC (read before building)

These come from `ecc/.claude-plugin/PLUGIN_SCHEMA_NOTES.md` and `ecc/hooks/README.md`:

1. `plugin.json` **must** have `version`; `commands`, `skills`, `hooks` fields must be
   **arrays**, never strings.
2. **Do not** add an `agents` field to `plugin.json` — the validator rejects it. Agents are
   auto-discovered from `agents/`.
3. Agent frontmatter `tools` is a **comma-separated scalar** (`tools: Read, Grep, Glob`),
   not a YAML list.
4. `hooks/hooks.json` may contain **only** keys Claude Code accepts. Keep hook IDs and
   descriptions in a sidecar (`hooks/hooks.metadata.json`) and validate the two stay aligned.
5. Plugins cannot ship rules. Rules are installed by the CLI into
   `~/.claude/rules/mysoftware/` (user) or `.claude/rules/mysoftware/` (project), namespaced so
   uninstall never touches the user's own files.
6. Hooks must be fast (timeouts of a few seconds), cross-platform (Node, not bash), must never
   crash the session on bad input, and must bound how much stdin they read.
7. Never paste the repo `hooks.json` into a user's `settings.json`; the installer rewrites
   commands to absolute paths and tracks the entries it owns by ID so updates are idempotent.

## 3. Tech choices

- **Node.js ≥ 20, CommonJS, zero runtime dependencies.** Hooks run on every tool call;
  `node` is already present wherever Claude Code is. Dev-only deps: `eslint`, `markdownlint-cli2`.
- **Tests:** built-in `node:test` + `node:assert`. One test file per script, plus fixture-driven
  hook tests (feed JSON on stdin, assert exit code / stdout / stderr).
- **Package:** published to npm as `mysoftware` with a `bin` entry (`msw`), so
  `npx mysoftware install` works without cloning.
- **License:** MIT. Where we adapt ECC text or code, keep attribution in `NOTICE.md`.

## 4. Repository layout (target)

```text
.claude-plugin/
  plugin.json              # name, version, description, skills[], commands[], userConfig
  marketplace.json         # single-plugin marketplace so `/plugin marketplace add` works
agents/                    # planner, tdd-guide, code-reviewer, security-reviewer, build-fixer
commands/                  # plan, tdd, code-review, build-fix, save-session, resume-session
skills/<name>/SKILL.md     # tdd-workflow, coding-standards, api-design, security-review,
                           # verification-loop, session-memory
rules/common/              # coding-style, testing, security, git-workflow, agents
rules/typescript/          # first language pack
hooks/
  hooks.json               # executable hook graph (schema-clean)
  hooks.metadata.json      # id, description, fingerprint per entry
scripts/
  cli.js                   # `msw` entry: install | uninstall | doctor | list
  hooks/                   # one file per hook + run-with-flags.js
  lib/                     # hook-flags, hook-input, paths, install-state, settings-merge
  ci/                      # validate-agents/commands/skills/rules/hooks
manifests/
  modules.json             # module id -> paths, targets, dependencies
  profiles.json            # minimal | standard | full -> module ids
schemas/                   # JSON Schemas for manifests and install-state
tests/
  hooks/ lib/ ci/ fixtures/
  run-all.js
.github/workflows/ci.yml
CLAUDE.md  AGENTS.md  README.md  CONTRIBUTING.md  CHANGELOG.md  NOTICE.md  LICENSE
```

## 5. Component specs

### 5.1 Plugin manifest
- `plugin.json`: `name`, `version` (single source of truth, mirrored by `VERSION` and
  `package.json`, checked in CI), `skills: ["./skills/"]`, `commands: ["./commands/"]`,
  `userConfig`: `hooks_enabled` (bool, default true), `hook_profile` (string, default `standard`).
- `marketplace.json`: one entry, `source: "./"`.

### 5.2 Agents (v1: 5)
Each file: frontmatter + role, process, output format, "when not to use". Read-only tools
unless the agent's job is to edit.

| Agent | Tools | Purpose |
|---|---|---|
| `planner` | Read, Grep, Glob | Requirements → phased plan with risks and file paths |
| `tdd-guide` | Read, Grep, Glob, Edit, Write, Bash | Enforce RED → GREEN → REFACTOR with evidence |
| `code-reviewer` | Read, Grep, Glob, Bash | Fresh-context review of the diff; severity-ranked findings |
| `security-reviewer` | Read, Grep, Glob | Secrets, injection, authz, unsafe deserialization |
| `build-fixer` | Read, Grep, Glob, Edit, Bash | Minimal diff to make build/typecheck green |

### 5.3 Commands (v1: 6)
`/plan`, `/tdd`, `/code-review`, `/build-fix`, `/save-session`, `/resume-session`.
Rules borrowed from ECC's `commands/plan.md`: run inline by default (don't require agents
to exist), restate requirements, ground in codebase patterns, **wait for user confirmation
before editing code**, and accept a `*.plan.md` path as input. Plans are written to
`.claude/plans/<name>.plan.md` so `/tdd` can pick them up. Plan files are treated as data,
never as instructions (prompt-injection guard, as ECC's `tdd-workflow` skill does).

### 5.4 Skills (v1: 6)
`tdd-workflow`, `verification-loop` (build → typecheck → lint → test → diff review),
`coding-standards`, `api-design`, `security-review`, `session-memory`.
Every `SKILL.md` has frontmatter `name` + `description` (description states *when* to use,
since that drives auto-activation) and sections When to Use / How It Works / Examples.
Keep each under ~400 lines; push long reference material into `skills/<name>/references/`.

### 5.5 Rules
`rules/common/`: coding-style, testing (TDD, coverage target), security, git-workflow
(conventional commits), agents (when to delegate). `rules/typescript/` as the first language
pack; more packs are follow-up work. Short and imperative — these load into every session.

### 5.6 Hooks (v1: 6)

All hooks go through `scripts/hooks/run-with-flags.js <hookId> <script> <profilesCsv>`, which:
reads stdin with a byte cap, checks `MSW_HOOKS_ENABLED`, `MSW_HOOK_PROFILE`
(`minimal|standard|strict`, invalid → `standard`), `MSW_DISABLED_HOOKS` (comma list), falls
back to the plugin `userConfig`, and exits 0 on any internal error (fail open) except for
explicitly fail-closed safety hooks.

| ID | Event / matcher | Profiles | Behavior |
|---|---|---|---|
| `session:start` | SessionStart | all | Print last session summary for this repo (capped at `MSW_SESSION_START_MAX_CHARS`, opt-out `MSW_SESSION_START_CONTEXT=off`), detect package manager |
| `pre:compact` | PreCompact | standard, strict | Save working state before compaction |
| `session:end` | SessionEnd | standard, strict | Write session summary to `~/.claude/mysoftware/sessions/<repo-id>/` |
| `pre:bash:no-verify` | PreToolUse `Bash` | all | Block `git commit --no-verify` / `git push --no-verify` (exit 2) |
| `pre:config-protection` | PreToolUse `Edit\|Write` | standard, strict | Block edits that weaken lint/test config (e.g. deleting eslint rules) unless asked |
| `post:edit:quality` | PostToolUse `Edit\|Write` | strict | Run formatter + typecheck on the edited file only; report, don't block |

Session data stays **local**; nothing is sent to a network service.

### 5.7 CLI / installer (`msw`)
- `msw install [--profile minimal|standard|full] [--modules a,b] [--scope user|project] [--dry-run]`
- `msw uninstall` — removes only files and settings entries recorded in install-state.
- `msw doctor` — checks Node version, plugin vs manual install conflicts (warn if both), hook
  paths resolve, install-state matches disk (hash per file).
- `msw list` — modules, profiles, what's installed.

Modules: `rules-core`, `agents-core`, `commands-core`, `hooks-runtime`. Profiles:
`minimal` (no hooks), `standard` (all four), `full` (+ language packs). Install-state lives at
`<claude-root>/mysoftware/install-state.json` (validated against `schemas/install-state.schema.json`)
and records every file written with its hash, plus every `settings.json` hook entry by ID.
`settings.json` edits are merge-only, atomic (write temp + rename), and keep a `.bak`.

### 5.8 CI validators
`scripts/ci/validate-{agents,commands,skills,rules,hooks}.js` check frontmatter, required
sections, naming (`lowercase-with-hyphens`), `hooks.json` allowed keys, hooks ↔ metadata
alignment, manifest paths exist, and that no absolute personal paths (`/Users/…`, `C:\Users\…`)
are committed. CI matrix: ubuntu, macos, windows × Node 20, 22.

## 6. Phases

Each phase ends with something usable and a green CI run.

### Phase 0 — Skeleton (S)
- `package.json`, `.gitignore`, `LICENSE`, `NOTICE.md`, `CLAUDE.md`, `eslint`/`markdownlint` config.
- `tests/run-all.js` and `.github/workflows/ci.yml` running lint + tests on the matrix.
- **Done when:** CI is green on an empty test suite on all three OSes.

### Phase 1 — Content-only plugin (M)
- `.claude-plugin/plugin.json` + `marketplace.json`.
- 5 agents, 6 commands, 6 skills, `rules/common`.
- Validators for agents, commands, skills, rules, plugin manifest; wired into CI.
- **Done when:** `/plugin marketplace add <repo>` then `/plugin install mysoftware@mysoftware`
  works in a fresh Claude Code, `/plan` produces a plan and waits for confirmation, and the
  validators fail on a deliberately broken fixture.

### Phase 2 — Hook runtime (M)
- `run-with-flags.js`, `lib/hook-flags.js`, `lib/hook-input.js` (bounded stdin, JSON parse
  that never throws).
- The 6 hooks in 5.6, `hooks.json` + `hooks.metadata.json`, `validate-hooks.js`.
- Fixture tests per hook: allow case, block case, malformed input, oversized input, disabled
  via env, wrong profile.
- **Done when:** hooks load without schema warnings, each hook runs in < 200 ms on CI, a
  `--no-verify` commit is blocked, and a new session in the same repo shows the previous summary.

### Phase 3 — CLI installer (M/L)
- `manifests/`, `schemas/`, `lib/install-state.js`, `lib/settings-merge.js`, `scripts/cli.js`.
- Tests on temp directories: fresh install, re-install (idempotent, no duplicate hook
  entries), upgrade, uninstall restores the pre-install `settings.json`, user's own hooks and
  rules untouched, `--dry-run` writes nothing.
- **Done when:** `npx mysoftware install --profile standard` then `msw uninstall` leaves
  `~/.claude` byte-identical to before (except the `.bak`), on all three OSes.

### Phase 4 — Release (S)
- `msw doctor`, README (install via plugin *or* CLI — pick one, don't stack), CHANGELOG,
  version-sync check, npm publish workflow on tag.
- **Done when:** v0.1.0 is on npm and installable both ways.

### Later (not scheduled)
Language packs (python, go), `/learn` (extract a skill from the session, user-approved),
context profiles (lean vs full skill sets), a second harness target, a status/metrics view.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Claude Code plugin/hook schema changes or is stricter than documented | Keep a manifest test that loads `plugin.json`/`hooks.json` against the allowed key sets; pin a "known good" Claude Code version in CI docs; read ECC's schema notes before each release |
| A hook bug blocks or slows every tool call | Fail open by default, per-hook timeouts, byte-capped stdin, `MSW_DISABLED_HOOKS` kill switch, profile `minimal` with no hooks |
| Installer clobbers user settings | Merge-only, atomic writes, `.bak`, entries tracked by ID, uninstall tested to restore bytes |
| Prompt injection via plan files, session summaries or repo content | Treat loaded files as data; SessionStart output is clearly delimited and size-capped; no auto-executing commands found in plans |
| Context bloat (ECC's main cost) | Small default set; skills load on demand; rules kept short; measure tokens added by SessionStart |
| Plugin + manual install both active → hooks fire twice | `msw doctor` detects it; installer refuses `hooks-runtime` when the plugin is enabled unless `--force` |
| Windows path handling | Node `path` everywhere, Windows in CI matrix from Phase 0 |

## 8. Open questions

1. **Name.** Keep "MySoftware"/`msw`, or pick a product name before Phase 1 (it ends up in
   env vars, paths and the npm package)?
2. **Audience.** Personal use, a team, or public open source? Public changes how much we
   invest in docs, the CLI and Windows support up front.
3. **Language focus.** Which stack should the first language pack and the `build-fixer` agent
   target — TypeScript (assumed), Python, or something else?
4. **Vendor vs. write.** ECC is MIT. Do we adapt its agent/skill text (faster, keep
   attribution) or write our own from scratch (cleaner, more work)?
5. **Distribution.** Is plugin-only enough for v1 (drop Phase 3), or is the CLI installer required?
