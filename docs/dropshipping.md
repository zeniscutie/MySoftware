# Dropshipping

The `dropship` module adds five agents for running dropshipping stores. The Chief of Staff, the central brain you
chat with, routes your requests to them:

```
                      ┌──────────────── you approve ────────────────┐
 Product Scout ──► Product Analyst ──► approvals ──► Ad Creator       │
 (find products)   (profit, saturation,            (ad scripts, ad   │
                    viral, risk + your rules)       copy, posts)     │
                                                ──► Brand Designer   │
                                                   (names, logo,     │
                                                    colours, layout, │
                                                    creative briefs) │
 Store Analyst ◄── Shopify orders + Meta Ads spend ◄── you launch ────┘
 (profit, ROAS, scale or kill)
```

| Team | Agent | What it does |
|---|---|---|
| Research | Product Scout | Searches TikTok and Meta ads, supplier sites (AliExpress, CJdropshipping) and trend data for products that fit your rules |
| Research | Product Analyst | Checks each product's supplier cost and delivery, competitor prices, saturation, viral potential and risk. Products that pass your rules go to your approvals |
| Content | Ad Creator | For every product you approve: angles, video ad scripts with hooks to test, Meta and TikTok ad copy, a week of organic posts |
| Design | Brand Designer | Store plan (one-product store, niche store or one you have), store names with a domain check, tagline, palette, fonts, logo concepts, Shopify layout, creative briefs |
| Analytics | Store Analyst | Shopify sales and Meta Ads spend per product: ROAS against break-even, CPA, net profit, and a scale, keep testing or kill call |
| Brain | Chief of Staff | Your morning digest, chat, approvals, routing work to the right team, and lessons every agent follows |

## How a product moves

1. **Found.** The Product Scout adds it with links to where it was seen. The daily hunt runs at 06:00; press **Find
   products** in Studio, or say "find me products" in chat, to hunt any time.
2. **Analysed.** The Product Analyst opens the supplier page, the ads and competing stores. Every number needs the
   page it came from. A missing supplier cost marks the product **Needs data** instead of letting the analyst
   guess.
3. **Scored in code.** The profit maths, the four scores and your rule checks are plain code, so they're the same
   every time:
   - **Profit**: price, landed cost (product + shipping), payment fees, profit per sale, markup, margin, break-even
     ad cost per sale and break-even ROAS.
   - **Saturation** (lower is better): advertisers, stores, age of the oldest ad, marketplace copies, trend
     direction.
   - **Viral potential**: wow factor, problem solved, how easy it is to demo, impulse buy, broad appeal (the analyst's
     1–10 judgments; wow and demo count double).
   - **Risk** (lower is better): flagged risks plus supplier weaknesses against your rules.
   - **Overall** is a weighted mix, out of 100.
4. **Your OK.** Strong picks and borderline ones (marked) go to your approvals queue on the **Products** page,
   Home, chat (Telegram or Discord) and Claude Code. The rest are set aside with their reasons; you can re-analyse
   any of them.
5. **Launch.** Approving starts the Ad Creator and Brand Designer straight away. The product shows **Teams working**,
   then **Ready to launch** with everything on its page. Pick a store name and create the store, or add the product
   to a store you have.
6. **Live.** Mark it live. With Shopify and Meta Ads connected, the Store Analyst syncs every 3 hours and makes the
   scale, keep testing or kill call from your rules. The full report comes Monday mornings.

Nothing is ever posted, bought, published or changed in your store or ad account. AttentionOS reads Shopify and
Meta Ads only.

## Turn it on

New workspace: choose the `dropshipper` preset (`PRESET=dropshipper` in the stack's `.env` before the first start,
or `attentionos create my-store --preset dropshipper`). It turns the module on with these starting rules:

- Low-ticket: sell between $10 and $35, at least 4x markup, delivery within 15 days
- Beauty and health first, plus any niche with a clear winner
- TikTok and Meta ads, suppliers and trends as sources
- Niche stores and one-product stores
- Shopify and Meta Ads for numbers

Existing workspace: in `config/attentionos.config.ts`, set `modules.dropship.enabled` to `true`, then restart
(`./aos restart`) so the database tables are added.

## Customise it

There are three places to change things, all plain files in your workspace that you can keep in git.

### 1. The numbers: `config/attentionos.config.ts`

```ts
modules: {
  dropship: {
    enabled: true,
    schedules: {
      // When each team runs (cron, your time zone). "" switches a schedule off.
      // "dropship.product-hunt": "0 6 * * *",
      // "dropship.store-report": "0 8 * * 1",
    },
    settings: {
      storeModel: "both",                // "niche" | "single_product" | "both" | "general"
      rulesPreset: "low_ticket",         // "low_ticket" | "standard" | "high_ticket"
      rules: {                           // override any single number from the preset
        // minSellPrice: 10, maxSellPrice: 35, minMarkup: 4, minGrossMargin: 0.6,
        // maxShippingDays: 15, minSupplierRating: 4.6, minSupplierOrders: 100,
        // maxSaturation: 75, maxRisk: 60, paymentFeePct: 2.9, paymentFeeFixed: 0.3,
        // excludedCategories: ["weapons", "supplements and ingestibles", ...],
      },
      niches: { focus: ["beauty and health"], anyNiche: true, focusShare: 0.6 },
      sources: { tiktokAds: true, metaAds: true, suppliers: true, trends: true, competitorStores: false },
      scoring: {
        weights: { profit: 30, saturation: 20, viral: 30, risk: 20 },
        passAt: 65,            // strong pick from here
        borderlineAt: 50,      // borderline from here
        sendBorderline: true,  // also send borderline products for approval
      },
      hunt: { perRun: 10, analyzePerRun: 6 },
      launch: {
        autoContent: true,     // start the Ad Creator on approval
        autoBrand: true,       // start the Brand Designer on approval
        content: {
          adScripts: true, adCopy: true, organicPosts: true,
          scriptCount: 3, hooksPerScript: 3, adCopyCount: 3, postCount: 7,
          adPlatforms: ["meta", "tiktok"],
          postPlatforms: ["tiktok", "instagram", "youtube"],
          // bannedClaims: [...]  phrases no ad or post may use
        },
        brand: { storeNames: true, identity: true, layout: true, creativeBriefs: true, nameCount: 8, briefCount: 4, checkDomains: true },
      },
      analytics: {
        lookbackDays: 14,               // history each sync reads
        windowDays: 7,                  // days the calls are judged on
        minSpendToJudge: 30,            // no call before this much ad spend
        killAfterSpendNoSale: 50,       // kill after this much spend with no sale
        scaleAtBreakEvenMultiple: 1.5,  // scale at 1.5x break-even ROAS
        killBelowBreakEvenShare: 0.7,   // kill under 70% of break-even ROAS
      },
      digest: { enabled: true },        // the morning dropshipping digest
    },
  },
},
```

How much each agent does on its own is set under `agents`:

```ts
agents: {
  product_scout: { autonomy: "review_all" },
  product_analyst: { autonomy: "review_all" }, // "autopilot": approves strong picks itself (never borderline ones)
  ad_creator: { autonomy: "review_all" },
  brand_designer: { autonomy: "review_all" },
  store_analyst: { autonomy: "review_all" },
},
```

You can also choose the model per agent (`model`), how hard it thinks (`effort`), or switch an agent off
(`enabled: false`). Run `./aos doctor` after editing; it explains any mistake in plain words.

### 2. The taste: playbooks in `brand/dropship/`

| File | Read by | Write here |
|---|---|---|
| `products.md` | Product Scout, Product Analyst, Store Analyst | What you like and avoid beyond the numbers ("no sizing", "light and small", "prefer faster US delivery") |
| `content.md` | Ad Creator | How your ads should sound and look, calls to action, what never to say |
| `brand.md` | Brand Designer | The kind of store brands you like: names, colours, layout |

### 3. Corrections: `brand/lessons.md`

When the team gets something wrong, tell the Chief of Staff, or run `/attention:lesson never pick products that need
batteries`. The correction becomes a dated rule that every agent reads before it works.

## Connect Shopify

AttentionOS only reads orders and products. In the Shopify **Dev Dashboard**, create an app, give it the
`read_orders` and `read_products` scopes (add `read_all_orders` for history older than 60 days), release a version
and install it on your store. Then add to the workspace `.env`:

```
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_CLIENT_ID=...
SHOPIFY_CLIENT_SECRET=...
```

If you have an older custom app made in the store admin, set `SHOPIFY_ACCESS_TOKEN=shpat_...` instead of the client
ID and secret. Set `providers.commerce: "shopify"` in the config (the dropshipper preset already does).

Products are matched to Shopify by title; set the link yourself with "link pr-12 to Shopify product 123…" in chat if
the titles differ.

## Connect Meta Ads

AttentionOS only reads spend and purchases. In Meta Business settings → Users → System users, add a system user, give
it access to your ad account, and generate a token with the `ads_read` permission. Then add:

```
META_ACCESS_TOKEN=...
META_AD_ACCOUNT_ID=1234567890
```

Set `providers.adsAnalytics: "meta"` (the preset already does). **Put the product ref in your campaign names**
(`pr-12 | broad | hook A`) and every ad is matched to its product. Without it, ads are matched by product title, and
anything unmatched is shown as "not matched to a product".

## Using it

**Studio**: the **Products** page has the approvals queue with the profit maths and scores, products that are
launching or live, store numbers, the pipeline and your stores. Each product's page has the full analysis, every rule
check, the ads, posts and brand kit, with copy buttons. You can approve, reject, re-analyse, redo the ads or brand,
create a store, and mark products live, paused or killed.

**Chat** (Studio, Telegram, Discord): "how are my products doing", "find me LED skincare products", "check this
product: <link>", "show me the ads for pr-5", "approve ap-31", "kill pr-7".

**Claude Code** (`cd workspace && claude`):

| Command | Does |
|---|---|
| `/attention:products` | The board, or one product's full analysis (`/attention:products pr-12`) |
| `/attention:hunt` | Start a hunt (optionally with a focus), or have a link you found analysed |
| `/attention:launch pr-12` | See the launch kit, or redo the content or brand |
| `/attention:store` | Store numbers and the scale or kill calls; `sync` and `report` |
| `/attention:approvals` | Approve or reject products (and everything else) |

Or ask for a specialist: the `product-scout`, `product-analyst`, `ad-creator`, `brand-designer` and `store-analyst`
subagents.

## Safety

- Research jobs read the public web with **only** web search and web fetch: no access to your files, no tools that
  write. What they find comes back as structured data, is validated, and only then saved.
- Everything found on the web (titles, supplier facts, reviews) is fenced as untrusted data in every later prompt, so
  text on a web page can't give the agents instructions.
- Content and brand jobs run with no tools at all; their output is validated and checked in code (banned claims,
  readable colours, duplicate names). Problems are flagged on the item, never hidden.
- Approving or rejecting a product is a person's decision; agents can't do it (except the Product Analyst for strong
  picks when you put it on autopilot).
- Shopify and Meta Ads are read-only.

## Costs

On your Claude plan (the default engine) there's no per-run bill. On the API engine, rough ceilings per run: a hunt
$1.50, an analysis $1.20, a content pack $1, a brand pack $1, the store report $0.50, all capped by `budgets` in the
config.

## Jobs

| Job | Agent | When | AI |
|---|---|---|---|
| `dropship.product-hunt` | Product Scout | 06:00 daily, or on request | yes (web) |
| `dropship.analyze-new` | Product Analyst | 06:30 daily, and after each hunt | no (queues analyses) |
| `dropship.analyze-product` | Product Analyst | per product | yes (web) |
| `dropship.content-pack` | Ad Creator | when you approve | yes (no tools) |
| `dropship.brand-pack` | Brand Designer | when you approve | yes (no tools) |
| `dropship.sync-decisions` | Product Analyst | on every decision, and every 5 minutes | no |
| `dropship.store-sync` | Store Analyst | every 3 hours | no |
| `dropship.store-report` | Store Analyst | Monday 08:00 | yes (no tools) |
| `dropship.daily-digest` | Chief of Staff | 07:45 daily | no |

Schedules run in Autopilot mode (`mode: "autopilot"`). In Copilot mode the teams work when you ask, and approvals
still start the launch right away.
