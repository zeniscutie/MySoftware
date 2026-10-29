---
description: Shopify-specific review of the current changes - theme review with Theme Check for theme files, security review for app, webhook, script and Function code.
argument-hint: "[optional: branch, commit range or path]"
---

# Shopify review

Scope: $ARGUMENTS

1. List changed files for the scope (default: uncommitted changes, else branch vs `main`).
2. Sort them:
   - Theme files (`layout/ templates/ sections/ blocks/ snippets/ assets/ config/ locales/`)
     → `liquid-reviewer` agent (runs Theme Check).
   - App, webhook, script, Function or config code → `shopify-security-reviewer` agent, plus
     `code-reviewer` for general correctness.
   - Shopify Functions also: run the function's tests and `shopify app function run` against
     its input fixtures if present.
3. Run the relevant reviewers (in parallel where possible) and merge their findings into one
   table sorted by severity.
4. Finish with:

```text
Theme Check: <result or n/a>
Security: <OK / FIX BEFORE MERGE>
Safe to preview: yes/no    Safe to go live: yes/no (needs your explicit yes either way)
```

Offer to fix findings; don't change code until the user says so.
