# Notices

## ECC (Everything Claude Code)

Parts of this project are adapted from [ECC](https://github.com/affaan-m/ecc) (v2.2.3), used
under the MIT License:

```text
MIT License

Copyright (c) 2026 Affaan Mustafa
```

Adapted from ECC (rewritten and shortened, with Shopify specifics added):

| This project | ECC source |
|---|---|
| `agents/planner.md` | `agents/planner.md` |
| `agents/tdd-guide.md` | `agents/tdd-guide.md` |
| `agents/code-reviewer.md` | `agents/code-reviewer.md` |
| `agents/build-fixer.md` | `agents/build-error-resolver.md` |
| `agents/shopify-security-reviewer.md` | `agents/security-reviewer.md` |
| `commands/plan-feature.md` | `commands/plan.md` |
| `commands/save-session.md`, `commands/resume-session.md` | `commands/save-session.md`, `commands/resume-session.md` |
| `skills/tdd-workflow/SKILL.md` | `skills/tdd-workflow/SKILL.md` |
| `skills/verification-loop/SKILL.md` | `skills/verification-loop/SKILL.md` |
| Hook profiles and `scripts/hooks/run-with-flags.js` design | `scripts/lib/hook-flags.js`, `scripts/hooks/run-with-flags.js` |
| `hooks/hooks.metadata.json` sidecar idea | `hooks/hooks.metadata.json` |
| Plugin manifest rules in `.claude/CLAUDE.md` | `.claude-plugin/PLUGIN_SCHEMA_NOTES.md` |

Everything else (Shopify agents, commands, skills and hooks, the session summary code, the
validators and tests) was written for this project.
