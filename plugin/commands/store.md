---
description: How your store is doing - Shopify sales, Meta Ads spend, ROAS against break-even, and what to scale or kill
argument-hint: "[days, e.g. 14] | sync | report"
allowed-tools: Read, Glob, Grep, mcp__attentionos__dropship_store_performance, mcp__attentionos__dropship_sync_store, mcp__attentionos__dropship_store_report, mcp__attentionos__dropship_get_rules
---

# Store numbers

The owner's input: `$ARGUMENTS`

- `sync`: call `dropship_sync_store` and say fresh numbers are on the way.
- `report`: call `dropship_store_report`; the Store Analyst writes the full report and sends it.
- Otherwise call `dropship_store_performance` (with the number of days if given) and show:
  1. Store totals: revenue, orders, refunds, ad spend, and spend not matched to a product (tell them to put the
     product ref, like `pr-12`, in campaign names so it's matched).
  2. Per product: revenue, spend, ROAS vs break-even ROAS, CPA, CTR, net profit, and the call (scale, keep testing,
     kill, not enough data) with its reason.
  3. One line on what to do first.

If nothing is connected, explain how: `providers.commerce: "shopify"` and `providers.adsAnalytics: "meta"` in
`config/attentionos.config.ts`, and the keys in `.env` (see `docs/dropshipping.md`). Never invent a number.
