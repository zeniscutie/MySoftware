---
description: Send the Product Scout to find new products (optionally in a niche), or have a product link you found analysed
argument-hint: "[focus, e.g. LED skincare] | [a product link]"
allowed-tools: Read, Glob, Grep, mcp__attentionos__dropship_get_rules, mcp__attentionos__dropship_hunt_products, mcp__attentionos__dropship_add_product
---

# Product hunt

The owner's input: `$ARGUMENTS`

- If the input is a link (an ad, a supplier listing or a store), add it with `dropship_add_product`: a short title for
  the product, the link, the niche, and the owner's note. It's analysed automatically and comes back for approval if
  it passes their rules. Tell them its ref.
- Otherwise start `dropship_hunt_products` with the input as the focus (none = the owner's usual niches). Tell them
  the Product Scout is on it, that the Product Analyst checks each find against their rules (read them with
  `dropship_get_rules` and quote the price range and markup), and that the good ones will appear in
  `/attention:products` and their approvals.

For a hunt in this session instead of the background, hand off to the `product-scout` subagent.
