---
description: See or (re)make the launch kit for an approved product - ad scripts, ad copy, posts, store names, brand and layout
argument-hint: "<pr-12> [content | brand | redo content | redo brand]"
allowed-tools: Read, Glob, Grep, mcp__attentionos__dropship_get_product, mcp__attentionos__dropship_list_assets, mcp__attentionos__dropship_launch_product, mcp__attentionos__dropship_list_stores
---

# Launch kit

The owner's input: `$ARGUMENTS`

1. Read the product with `dropship_get_product`. If it isn't approved, say so and point to its approval ref.
2. With `redo content` or `redo brand`, call `dropship_launch_product` with `only` set to that team and say it's on
   its way. With no instruction and nothing made yet, start both.
3. Otherwise show what's there (`dropship_list_assets`), grouped:
   - **Ads**: the angles; each script with its hooks and beats; ad copy per platform.
   - **Posts**: day, platform, hook and caption.
   - **Brand**: the store plan; store names with domain status ("taken" or "maybe free: check at a registrar");
     tagline, palette (hex codes), fonts, logo concepts; the Shopify layout; creative briefs.
   - Anything the code flagged (banned claims, unreadable colours) with its problem.
4. Offer next steps: pick a name and create the store (`brand-designer` subagent), tweak hooks (`ad-creator`
   subagent), or mark it live when it's selling.
