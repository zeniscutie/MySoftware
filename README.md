# MySoftware

Private Claude Code plugin for running our Shopify store. It makes Claude plan before it
builds, test before it ships, review its own work, remember what happened last time, and
know its way around Shopify themes, apps, Functions and the Admin API — with guardrails that
stop accidental changes to the live store.

Built on ideas and text from [ECC](https://github.com/affaan-m/ecc) (MIT, see `NOTICE.md`).
The full design is in [PLAN.md](PLAN.md).

## Install (each of us, once)

You need [Claude Code](https://claude.com/claude-code) 2.1.275 or later, Node.js 22 or later,
and git signed in to a GitHub account that can see this private repo (`gh auth login`, or an
SSH key).

In Claude Code:

```text
/plugin install mysoftware --marketplace zeniscutie/MySoftware
```

On older Claude Code versions, use the two-step form:

```text
/plugin marketplace add zeniscutie/MySoftware
/plugin install mysoftware@mysoftware
```

If it asks for the two plugin options (hooks on/off, hook profile), the defaults are fine
(`true`, `standard`).

Then restart Claude Code (or run `/reload-plugins`). Check it worked: start a session in any
project and you should see "MySoftware house rules" in the session context, and `/plan-feature`
should autocomplete.

**Update** to the latest version: `/plugin marketplace update mysoftware`, then
`/plugin update mysoftware@mysoftware`.

### For Shopify work

- Install the [Shopify CLI](https://shopify.dev/docs/api/shopify-cli) and log in once
  (`shopify theme list --store our-store.myshopify.com`).
- The plugin starts Shopify's **Dev MCP** server (docs, API schemas, GraphQL and theme
  validation) through `npx`, so Claude looks things up instead of guessing. Its telemetry is
  switched off. On Windows, if `/mcp` shows it failing to start, add it yourself with
  `claude mcp add shopify-dev-mcp -- cmd /c npx -y @shopify/dev-mcp@1`.
- For scripts that use the Admin API, put credentials in a `.env` file in that project (never
  commit it):

  ```text
  SHOPIFY_STORE_DOMAIN=our-store.myshopify.com
  # Either an existing admin-created custom app token…
  SHOPIFY_ADMIN_TOKEN=
  # …or a Dev Dashboard app (required for new apps since January 2026)
  SHOPIFY_CLIENT_ID=
  SHOPIFY_CLIENT_SECRET=
  ```

## What you get

| Command | What it does |
|---|---|
| `/plan-feature <what>` | Picks theme vs app vs Function vs script, writes a step-by-step plan, waits for your yes |
| `/tdd <behaviour>` | Builds it test-first and shows the failing → passing test runs |
| `/review-changes` | Fresh-eyes review of your changes: bugs, security, data-loss risks |
| `/shopify-review` | Theme review with Theme Check, or security review for app/script code |
| `/theme-preview` | Theme Check, then a preview on `theme dev` or an unpublished theme, with the link |
| `/store-query <what>` | Writes and checks an Admin API query; changes are dry-run, backed up and need your yes |
| `/save-session`, `/resume-session` | Save where you are; pick it up next time |

Agents (Claude uses them automatically or when you ask): `planner`, `shopify-architect`,
`tdd-guide`, `code-reviewer`, `liquid-reviewer`, `shopify-security-reviewer`, `build-fixer`.

Skills (loaded only when relevant): Shopify themes, apps, Admin API, Functions, webhooks,
store data scripts, test-driven workflow, verification loop, session memory.

## Guardrails

These hooks run automatically:

| Hook | What it does |
|---|---|
| Live-store guard | Blocks `shopify theme push --live` / `--allow-live` / with no target, `theme publish`, `theme delete`, `app deploy`, `app release`. Claude must ask you first. |
| Secrets guard | Blocks writing Shopify tokens, live Stripe keys, AWS keys or private keys into any file except `.env`. |
| No-verify guard | Blocks `git commit --no-verify`, `git commit -n`, `git push --no-verify`. |
| Session start | Shows the house rules and the last session's notes. |
| Session notes | Saves a short summary when the context is compacted and when a session ends. |
| Edit checks (strict only) | Runs Theme Check, ESLint or Ruff on each edited file. |

**When you approve a blocked live-store command,** Claude re-runs it as
`MSW_ALLOW_LIVE=1 shopify …`. Claude Code still shows you that command before it runs.
The guard only sees commands typed directly; a live push hidden inside an npm script
(`npm run deploy`) isn't caught, so keep deploy scripts explicit.

### Settings

Change these in `/plugin` → mysoftware → configure, or with environment variables
(environment variables win):

| Setting | Values | Default |
|---|---|---|
| Hook profile (`MSW_HOOK_PROFILE`) | `minimal` — guards only · `standard` — guards + session notes · `strict` — plus edit checks | `standard` |
| Hooks on/off (`MSW_HOOKS_ENABLED`) | `true` / `false` | `true` |
| `MSW_DISABLED_HOOKS` | comma list of hook IDs, e.g. `session:start,post:edit:quality` | none |
| `MSW_SESSION_START_CONTEXT` | `off` hides last-session notes at start | on |
| `MSW_SESSION_START_MAX_CHARS` | max characters added at session start | `6000` |
| `MSW_DATA_DIR` | where session notes are stored | `~/.claude/mysoftware` |

Hook IDs: `session:start`, `pre:bash:no-verify`, `pre:bash:shopify-live`, `pre:write:secrets`,
`post:edit:quality`, `pre:compact`, `session:end`.

Session notes are stored on each computer only (`~/.claude/mysoftware/sessions/<project>/`).
To hand work to each other, commit a note to the project or share the `/save-session` output.

## Developing this plugin

```bash
npm ci --ignore-scripts
npm run check        # lint + validators + tests
npx -y @anthropic-ai/claude-code@2.1.312 plugin validate --strict .
```

Try local changes without installing: `claude --plugin-dir /path/to/MySoftware`.

Layout: `agents/`, `commands/`, `skills/<name>/SKILL.md`, `hooks/hooks.json` (+ metadata),
`scripts/hooks/` (hook code), `scripts/lib/`, `scripts/ci/` (validators), `rules/house-rules.md`,
`tests/`. Conventions are in `.claude/CLAUDE.md`. Bump the version in `package.json`,
`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` and `CHANGELOG.md` together
(CI checks they match).
