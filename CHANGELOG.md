# Changelog

## 0.1.0

First usable version.

- Plugin manifest and single-plugin marketplace (`mysoftware@mysoftware`).
- Agents: `planner`, `tdd-guide`, `code-reviewer`, `build-fixer`, `shopify-architect`,
  `liquid-reviewer`, `shopify-security-reviewer`.
- Commands: `/plan-feature`, `/tdd`, `/review-changes`, `/save-session`, `/resume-session`,
  `/theme-preview`, `/store-query`, `/shopify-review`.
- Skills: `tdd-workflow`, `verification-loop`, `session-memory`, `shopify-theme`, `shopify-app`,
  `shopify-admin-api`, `shopify-functions`, `shopify-webhooks`, `store-data-scripts`.
- Hooks: house rules + last session notes at start, session summaries on compact/end, blocks for
  `--no-verify`, live-store Shopify CLI commands and secrets in files, optional edit checks
  (strict profile).
- Shopify Dev MCP server bundled, with telemetry turned off.
- CI: lint, validators, tests on macOS, Windows and Linux; Claude Code plugin validation.
