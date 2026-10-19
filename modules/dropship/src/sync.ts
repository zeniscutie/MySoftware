import { jsonb, type AdInsightRow, type CommerceOrder, type Sql, type WorkspaceContext } from "@attentionos/core";
import { fingerprint, listProducts, type DsWs, type Product } from "./repo.ts";
import { judgePerformance, profitFor, type Performance, type Profit } from "./scoring.ts";
import { dropshipSettings, effectiveRules } from "./settings.ts";

/**
 * Store numbers: Shopify orders and Meta Ads spend, per day, matched to products.
 *
 * Matching (in order):
 * - Shopify: the product's linked Shopify id, else the same title (normalised).
 * - Meta: the product ref (pr-12) in the campaign, ad set or ad name, else the product title inside one of those names.
 *   Name your campaigns "pr-12 …" and every ad is matched for sure.
 */

const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

type ShopifyDay = { day: string; key: string; label: string; orders: number; units: number; revenue: number; refunds: number; currency: string };

/** Per day and Shopify product: orders, units and revenue from line items; refunds and a 'store' total per day. */
export function aggregateOrders(orders: CommerceOrder[]): ShopifyDay[] {
  const map = new Map<string, ShopifyDay>();
  const bump = (d: string, key: string, label: string, currency: string, f: (r: ShopifyDay) => void) => {
    const k = `${d}|${key}`;
    let r = map.get(k);
    if (!r) map.set(k, (r = { day: d, key, label, orders: 0, units: 0, revenue: 0, refunds: 0, currency }));
    f(r);
  };
  for (const o of orders) {
    if (o.cancelled) continue;
    const d = o.createdAt.slice(0, 10);
    bump(d, "store", "Store total", o.currency, (r) => {
      r.orders += 1;
      r.units += o.lines.reduce((n, l) => n + l.quantity, 0);
      r.revenue += o.total;
      r.refunds += o.refunded;
    });
    const seen = new Set<string>();
    for (const l of o.lines) {
      if (!l.productId) continue;
      bump(d, l.productId, l.title, o.currency, (r) => {
        if (!seen.has(l.productId!)) r.orders += 1;
        r.units += l.quantity;
        r.revenue += l.unitPrice * l.quantity;
      });
      seen.add(l.productId);
    }
  }
  return [...map.values()].map((r) => ({ ...r, revenue: Math.round(r.revenue * 100) / 100, refunds: Math.round(r.refunds * 100) / 100 }));
}

/** The product an ad belongs to: its ref in a name first, then its title inside a name. */
export function matchAd(row: Pick<AdInsightRow, "campaignName" | "adsetName" | "adName">, products: Pick<Product, "id" | "ref" | "title">[]): string | null {
  const names = [row.campaignName, row.adsetName ?? "", row.adName ?? ""].map((n) => n.toLowerCase());
  for (const p of products) {
    const re = new RegExp(`(^|[^a-z0-9])${p.ref.replace("-", "[-_ ]?")}([^0-9]|$)`, "i");
    if (names.some((n) => re.test(n))) return p.id;
  }
  const fps = names.map((n) => ` ${fingerprint(n)} `);
  let best: { id: string; len: number } | null = null;
  for (const p of products) {
    const fp = fingerprint(p.title);
    if (fp.length < 4) continue;
    if (fps.some((n) => n.includes(` ${fp} `)) && (!best || fp.length > best.len)) best = { id: p.id, len: fp.length };
  }
  return best?.id ?? null;
}

export type StoreSyncResult = { shopify: { orders: number; rows: number } | null; meta: { rows: number; matched: number } | null; problems: string[] };

/** Pulls the last `lookbackDays` from Shopify and Meta Ads (whichever are connected) and upserts the daily rows. */
export async function syncStore(ws: WorkspaceContext): Promise<StoreSyncResult> {
  const s = dropshipSettings(ws).analytics;
  const now = ws.now();
  const since = day(addDays(now, -s.lookbackDays));
  const until = day(now);
  const products = await listProducts(ws, { limit: 500 });
  const out: StoreSyncResult = { shopify: null, meta: null, problems: [] };

  const commerce = ws.providers.commerce;
  if (commerce) {
    try {
      const orders = await commerce.listOrders({ since, until: day(addDays(now, 1)) });
      const rows = aggregateOrders(orders);
      const byShopifyId = new Map(products.filter((p) => p.shopifyProductId).map((p) => [p.shopifyProductId!, p.id]));
      const byTitle = new Map(products.map((p) => [fingerprint(p.title), p.id]));
      await ws.sql.begin(async (tx) => {
        const sql = tx as unknown as Sql;
        for (const r of rows) {
          const productId = r.key === "store" ? null : byShopifyId.get(r.key) ?? byTitle.get(fingerprint(r.label)) ?? null;
          await sql`
            insert into dropship_daily (workspace_id, day, source, key, product_id, label, orders, units, revenue, refunds, currency, updated_at)
            values (${ws.id}, ${r.day}, 'shopify', ${r.key}, ${productId}, ${r.label}, ${r.orders}, ${r.units}, ${r.revenue}, ${r.refunds}, ${r.currency}, ${now})
            on conflict (workspace_id, day, source, key) do update set
              product_id = coalesce(excluded.product_id, dropship_daily.product_id), label = excluded.label, orders = excluded.orders,
              units = excluded.units, revenue = excluded.revenue, refunds = excluded.refunds, currency = excluded.currency, updated_at = excluded.updated_at`;
        }
        // A product matched by title gets its Shopify id, so later syncs match it for sure.
        for (const r of rows) {
          const pid = r.key !== "store" && !byShopifyId.has(r.key) ? byTitle.get(fingerprint(r.label)) : undefined;
          if (pid) await sql`update dropship_products set shopify_product_id = ${r.key} where workspace_id = ${ws.id} and id = ${pid} and shopify_product_id is null`;
        }
      });
      out.shopify = { orders: orders.length, rows: rows.length };
    } catch (err) {
      out.problems.push(`Shopify: ${(err as Error).message}`);
    }
  }

  const ads = ws.providers.adsAnalytics;
  if (ads) {
    try {
      const rows = await ads.listDailyInsights({ since, until, level: "ad" });
      let matched = 0;
      await ws.sql.begin(async (tx) => {
        const sql = tx as unknown as Sql;
        for (const r of rows) {
          const productId = matchAd(r, products);
          if (productId) matched++;
          const key = r.adId ?? r.adsetId ?? r.campaignId;
          const label = [r.campaignName, r.adsetName, r.adName].filter(Boolean).join(" › ");
          await sql`
            insert into dropship_daily (workspace_id, day, source, key, product_id, label, spend, impressions, clicks, purchases, purchase_value, currency, updated_at)
            values (${ws.id}, ${r.day}, 'meta', ${key}, ${productId}, ${label}, ${r.spend}, ${r.impressions}, ${r.clicks}, ${r.purchases}, ${r.purchaseValue}, ${r.currency}, ${now})
            on conflict (workspace_id, day, source, key) do update set
              product_id = coalesce(excluded.product_id, dropship_daily.product_id), label = excluded.label, spend = excluded.spend,
              impressions = excluded.impressions, clicks = excluded.clicks, purchases = excluded.purchases,
              purchase_value = excluded.purchase_value, currency = excluded.currency, updated_at = excluded.updated_at`;
        }
      });
      out.meta = { rows: rows.length, matched };
    } catch (err) {
      out.problems.push(`Meta Ads: ${(err as Error).message}`);
    }
  }

  await ws.sql`
    insert into settings (workspace_id, key, value) values (${ws.id}, 'dropship.last_sync', ${jsonb(ws.sql, { at: now.toISOString(), ...out })})
    on conflict (workspace_id, key) do update set value = excluded.value`;
  return out;
}

export type ProductPerformance = Performance & { productId: string; ref: string; title: string; status: string; profit: Profit | null };

export type StorePerformance = {
  windowDays: number;
  since: string;
  store: { revenue: number; orders: number; refunds: number; spend: number; unmatchedSpend: number; currency: string | null };
  products: ProductPerformance[];
  lastSync: { at: string; problems?: string[] } | null;
};

/** Numbers and the scale / keep testing / kill call per product over the window. */
export async function storePerformance(ws: DsWs, windowDays?: number): Promise<StorePerformance> {
  const settings = dropshipSettings(ws);
  const rules = effectiveRules(settings);
  const days = windowDays ?? settings.analytics.windowDays;
  const since = day(addDays(ws.now(), -days + 1));
  const [store] = await ws.sql<Record<string, unknown>[]>`
    select coalesce(sum(revenue) filter (where source = 'shopify' and key = 'store'), 0)::float8 as revenue,
           coalesce(sum(orders) filter (where source = 'shopify' and key = 'store'), 0)::int as orders,
           coalesce(sum(refunds) filter (where source = 'shopify' and key = 'store'), 0)::float8 as refunds,
           coalesce(sum(spend) filter (where source = 'meta'), 0)::float8 as spend,
           coalesce(sum(spend) filter (where source = 'meta' and product_id is null), 0)::float8 as unmatched,
           max(currency) as currency
      from dropship_daily where workspace_id = ${ws.id} and day >= ${since}`;
  const rows = await ws.sql<Record<string, unknown>[]>`
    select p.id, p.ref, p.title, p.status, p.analysis,
           coalesce(sum(d.revenue) filter (where d.source = 'shopify'), 0)::float8 as revenue,
           coalesce(sum(d.orders) filter (where d.source = 'shopify'), 0)::int as orders,
           coalesce(sum(d.units) filter (where d.source = 'shopify'), 0)::int as units,
           coalesce(sum(d.refunds) filter (where d.source = 'shopify'), 0)::float8 as refunds,
           coalesce(sum(d.spend) filter (where d.source = 'meta'), 0)::float8 as spend,
           coalesce(sum(d.purchases) filter (where d.source = 'meta'), 0)::float8 as purchases,
           coalesce(sum(d.purchase_value) filter (where d.source = 'meta'), 0)::float8 as purchase_value,
           coalesce(sum(d.clicks) filter (where d.source = 'meta'), 0)::float8 as clicks,
           coalesce(sum(d.impressions) filter (where d.source = 'meta'), 0)::float8 as impressions
      from dropship_products p
      join dropship_daily d on d.workspace_id = p.workspace_id and d.product_id = p.id and d.day >= ${since}
     where p.workspace_id = ${ws.id}
     group by p.id
     order by spend desc, revenue desc`;
  const products = rows.map((r): ProductPerformance => {
    const result = (r.analysis as { result?: { profit?: Profit | null } } | null)?.result;
    const base = result?.profit ?? null;
    const profit = base ? profitFor(base.sellPrice, base.productCost, base.shippingCost, rules) : null;
    const perf = judgePerformance(
      {
        revenue: Number(r.revenue), orders: Number(r.orders), units: Number(r.units), refunds: Number(r.refunds), spend: Number(r.spend),
        purchases: Number(r.purchases), purchaseValue: Number(r.purchase_value), clicks: Number(r.clicks), impressions: Number(r.impressions),
      },
      profit,
      settings.analytics,
      rules,
    );
    return { ...perf, productId: r.id as string, ref: r.ref as string, title: r.title as string, status: r.status as string, profit };
  });
  const [last] = await ws.sql<{ value: { at: string; problems?: string[] } }[]>`select value from settings where workspace_id = ${ws.id} and key = 'dropship.last_sync'`;
  return {
    windowDays: days,
    since,
    store: {
      revenue: Number(store?.revenue ?? 0), orders: Number(store?.orders ?? 0), refunds: Number(store?.refunds ?? 0),
      spend: Number(store?.spend ?? 0), unmatchedSpend: Number(store?.unmatched ?? 0), currency: (store?.currency as string | null) ?? null,
    },
    products,
    lastSync: last?.value ?? null,
  };
}
