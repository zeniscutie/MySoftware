---
description: Preview theme changes safely - Theme Check, then a local dev server or a push to an unpublished theme - and return the preview link. Never touches the live theme.
argument-hint: "[--store your-store.myshopify.com] [optional: theme name or id to push to]"
---

# Theme preview

Arguments: $ARGUMENTS

Follow the `shopify-theme` skill.

1. **Check the folder** is a theme (has `layout/theme.liquid`). If not, find the theme folder
   or ask.
2. **Check the CLI**: `shopify version`. If missing, tell the user to install the Shopify CLI
   and log in (`shopify theme list --store <store>` triggers login) and stop.
3. **Find the store**: from the argument, `shopify.theme.toml`, or ask. Never guess a store.
4. **Theme Check**: `shopify theme check`. Fix errors in files you changed; list the rest.
5. **Protect editor changes**: if `templates/*.json` or `config/settings_data.json` changed
   locally, warn that pushing them overwrites theme-editor customisations on the target
   theme. Ask whether to include them or add `--ignore` for those files.
6. **Preview**, one of:
   - Quick local preview: `shopify theme dev --store <store>` (run in the background; give
     the user the local URL and the shareable preview link it prints).
   - Shareable preview: `shopify theme push --unpublished --store <store>` (creates a new
     unpublished theme) or `shopify theme push --theme <id> --store <store>` for an existing
     **unpublished** theme. Run `shopify theme list --store <store>` first and refuse if the
     target is the live (`[live]`) theme.
7. **Report**: which theme was used (name, id), the preview link, Theme Check result, and
   what to look at on the preview (pages, devices).

Publishing the theme is a separate step that needs the user's explicit yes
(`shopify theme publish` is blocked by the MySoftware hook until then).
