import { z } from "zod";
import {
  ProviderError,
  type AttentionOSConfig, type Commerce, type CommerceOrder, type CommerceProduct, type CommerceShop, type Logger, type ProviderHealth,
} from "@attentionos/core";
import { HttpClient, type FetchLike } from "@attentionos/provider-shared";

/**
 * Shopify, read-only, through the GraphQL Admin API. AttentionOS never writes to the store.
 *
 * Secrets (.env):
 * - SHOPIFY_STORE_DOMAIN   your-store.myshopify.com
 * - Either SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET: an app made in the Shopify Dev Dashboard and installed on your
 *   store (the way custom apps are made since January 2026). Tokens come from the client credentials grant and are
 *   refreshed on their own before they expire.
 * - Or SHOPIFY_ACCESS_TOKEN: an Admin API token (shpat_…) from a custom app made in the store admin before 2026.
 * - SHOPIFY_API_VERSION    optional, default below.
 *
 * Scopes: read_orders and read_products (add read_all_orders for orders older than 60 days).
 */

export const PROVIDER_ID = "commerce-shopify";
export const SHOPIFY_API_VERSION = "2026-07";
export const SHOPIFY_SECRETS = {
  domain: "SHOPIFY_STORE_DOMAIN",
  token: "SHOPIFY_ACCESS_TOKEN",
  clientId: "SHOPIFY_CLIENT_ID",
  clientSecret: "SHOPIFY_CLIENT_SECRET",
  apiVersion: "SHOPIFY_API_VERSION",
} as const;

export type ShopifyCreateOptions = {
  secret(name: string): string | undefined;
  config: AttentionOSConfig;
  log: Logger;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/** "my-store", "my-store.myshopify.com" or "https://my-store.myshopify.com/admin" → "my-store.myshopify.com". */
export function normalizeDomain(value: string | undefined): string | undefined {
  const v = value?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!v) return undefined;
  return v.includes(".") ? v : `${v}.myshopify.com`;
}

/** "gid://shopify/Product/123" → "123". */
export function gidToId(gid: string | null | undefined): string | null {
  if (!gid) return null;
  const m = /\/(\d+)$/.exec(gid);
  return m ? m[1]! : gid;
}

const money = z.object({ shopMoney: z.object({ amount: z.string() }) }).nullish();
const amount = (m: z.output<typeof money>): number => (m ? Number(m.shopMoney.amount) || 0 : 0);

const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullish() });

const orderNode = z.looseObject({
  id: z.string(),
  name: z.string().nullish(),
  createdAt: z.string(),
  currencyCode: z.string(),
  displayFinancialStatus: z.string().nullish(),
  cancelledAt: z.string().nullish(),
  currentSubtotalPriceSet: money,
  totalShippingPriceSet: money,
  totalDiscountsSet: money,
  currentTotalPriceSet: money,
  totalRefundedSet: money,
  lineItems: z.object({
    nodes: z.array(z.looseObject({
      title: z.string(),
      quantity: z.number(),
      sku: z.string().nullish(),
      product: z.object({ id: z.string() }).nullish(),
      variant: z.object({ id: z.string() }).nullish(),
      originalUnitPriceSet: money,
    })),
  }),
});

const productNode = z.looseObject({
  id: z.string(),
  title: z.string(),
  handle: z.string().nullish(),
  status: z.string().nullish(),
  onlineStoreUrl: z.string().nullish(),
  createdAt: z.string().nullish(),
  priceRangeV2: z.object({ minVariantPrice: z.object({ amount: z.string() }) }).nullish(),
});

const shopData = z.object({
  shop: z.object({ name: z.string(), myshopifyDomain: z.string(), currencyCode: z.string(), ianaTimezone: z.string().nullish() }),
});
const ordersData = z.object({ orders: z.object({ pageInfo, nodes: z.array(orderNode) }) });
const productsData = z.object({ products: z.object({ pageInfo, nodes: z.array(productNode) }) });

const tokenResponse = z.looseObject({ access_token: z.string(), expires_in: z.number().optional() });

const gqlEnvelope = z.looseObject({
  data: z.unknown().optional(),
  errors: z.array(z.looseObject({ message: z.string(), extensions: z.looseObject({ code: z.string().optional() }).optional() })).optional(),
});

const SHOP_QUERY = `query { shop { name myshopifyDomain currencyCode ianaTimezone } }`;

const ORDERS_QUERY = `query Orders($q: String!, $after: String) {
  orders(first: 100, after: $after, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt currencyCode displayFinancialStatus cancelledAt
      currentSubtotalPriceSet { shopMoney { amount } }
      totalShippingPriceSet { shopMoney { amount } }
      totalDiscountsSet { shopMoney { amount } }
      currentTotalPriceSet { shopMoney { amount } }
      totalRefundedSet { shopMoney { amount } }
      lineItems(first: 50) { nodes { title quantity sku product { id } variant { id } originalUnitPriceSet { shopMoney { amount } } } }
    }
  }
}`;

const PRODUCTS_QUERY = `query Products($after: String) {
  products(first: 100, after: $after, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes { id title handle status onlineStoreUrl createdAt priceRangeV2 { minVariantPrice { amount } } }
  }
}`;

export function toOrder(n: z.output<typeof orderNode>): CommerceOrder {
  return {
    id: gidToId(n.id)!,
    ...(n.name ? { name: n.name } : {}),
    createdAt: n.createdAt,
    currency: n.currencyCode,
    subtotal: amount(n.currentSubtotalPriceSet),
    shipping: amount(n.totalShippingPriceSet),
    discounts: amount(n.totalDiscountsSet),
    total: amount(n.currentTotalPriceSet),
    refunded: amount(n.totalRefundedSet),
    ...(n.displayFinancialStatus ? { financialStatus: n.displayFinancialStatus.toLowerCase() } : {}),
    ...(n.cancelledAt ? { cancelled: true } : {}),
    lines: n.lineItems.nodes.map((l) => ({
      productId: gidToId(l.product?.id),
      variantId: gidToId(l.variant?.id),
      title: l.title,
      sku: l.sku ?? null,
      quantity: l.quantity,
      unitPrice: amount(l.originalUnitPriceSet),
    })),
  };
}

export function toProduct(n: z.output<typeof productNode>): CommerceProduct {
  return {
    id: gidToId(n.id)!,
    title: n.title,
    ...(n.handle ? { handle: n.handle } : {}),
    ...(n.status ? { status: n.status.toLowerCase() } : {}),
    ...(n.priceRangeV2 ? { price: Number(n.priceRangeV2.minVariantPrice.amount) } : {}),
    ...(n.onlineStoreUrl ? { url: n.onlineStoreUrl } : {}),
    ...(n.createdAt ? { createdAt: n.createdAt } : {}),
  };
}

export function create(opts: ShopifyCreateOptions): Commerce {
  const domain = normalizeDomain(opts.secret(SHOPIFY_SECRETS.domain));
  const staticToken = opts.secret(SHOPIFY_SECRETS.token)?.trim();
  const clientId = opts.secret(SHOPIFY_SECRETS.clientId)?.trim();
  const clientSecret = opts.secret(SHOPIFY_SECRETS.clientSecret)?.trim();
  const version = opts.secret(SHOPIFY_SECRETS.apiVersion)?.trim() || SHOPIFY_API_VERSION;
  const now = opts.now ?? (() => Date.now());
  let minted: { token: string; expiresAt: number } | null = null;

  const describeError = (status: number, body: unknown) => {
    const b = body as { errors?: unknown; error_description?: string } | undefined;
    const detail = typeof b?.errors === "string" ? b.errors : b?.error_description;
    return { message: detail ? `Shopify: ${detail}` : `Shopify returned HTTP ${status}` };
  };
  const http = new HttpClient({
    provider: PROVIDER_ID,
    baseUrl: `https://${domain ?? "missing.myshopify.com"}`,
    headers: () => ({}),
    log: opts.log,
    fetch: opts.fetch,
    sleep: opts.sleep,
    now: opts.now,
    maxRetries: 4,
    describeError,
  });

  function setupProblem(): string | null {
    if (!domain) return `set ${SHOPIFY_SECRETS.domain} (your-store.myshopify.com)`;
    if (!staticToken && !(clientId && clientSecret)) return `set ${SHOPIFY_SECRETS.clientId} and ${SHOPIFY_SECRETS.clientSecret}, or ${SHOPIFY_SECRETS.token}`;
    return null;
  }

  async function accessToken(): Promise<string> {
    const problem = setupProblem();
    if (problem) throw new ProviderError(PROVIDER_ID, "auth", problem);
    if (staticToken) return staticToken;
    // Refresh a minute early so a long sync never runs on an expired token.
    if (minted && minted.expiresAt - 60_000 > now()) return minted.token;
    const res = await http.request("POST", "/admin/oauth/access_token", {
      body: { client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" },
      schema: tokenResponse,
      retry: "rate_limited",
    });
    minted = { token: res.access_token, expiresAt: now() + (res.expires_in ?? 86_400) * 1000 };
    return minted.token;
  }

  async function gql<S extends z.ZodType>(query: string, variables: Record<string, unknown>, schema: S): Promise<z.output<S>> {
    for (let attempt = 0; ; attempt++) {
      const token = await accessToken();
      const body = await http.request("POST", `/admin/api/${version}/graphql.json`, {
        body: { query, variables },
        headers: { "x-shopify-access-token": token },
        schema: gqlEnvelope,
      });
      const errors = body.errors ?? [];
      if (errors.some((e) => e.extensions?.code === "THROTTLED") && attempt < 4) {
        await (opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))))(2_000 * (attempt + 1));
        continue;
      }
      if (errors.length) {
        const denied = errors.some((e) => e.extensions?.code === "ACCESS_DENIED");
        throw new ProviderError(PROVIDER_ID, denied ? "auth" : "invalid_request", `Shopify: ${errors.map((e) => e.message).join("; ")}`, { raw: errors });
      }
      const parsed = schema.safeParse(body.data);
      if (!parsed.success) throw new ProviderError(PROVIDER_ID, "upstream", "unexpected response shape from the Shopify Admin API", { raw: body.data });
      return parsed.data;
    }
  }

  return {
    id: PROVIDER_ID,
    async health(): Promise<ProviderHealth> {
      const problem = setupProblem();
      if (problem) return { ok: false, detail: "Shopify isn't connected yet", fix: `In .env, ${problem}. See docs/dropshipping.md#connect-shopify.` };
      return { ok: true, detail: `Reads orders and products from ${domain} (read-only)` };
    },
    async getShop(): Promise<CommerceShop> {
      const d = await gql(SHOP_QUERY, {}, shopData);
      return { name: d.shop.name, domain: d.shop.myshopifyDomain, currency: d.shop.currencyCode, ...(d.shop.ianaTimezone ? { timezone: d.shop.ianaTimezone } : {}) };
    },
    async listOrders({ since, until, limit = 5_000 }) {
      const q = [`created_at:>='${since}'`, until ? `created_at:<'${until}'` : ""].filter(Boolean).join(" ");
      const out: CommerceOrder[] = [];
      let after: string | null = null;
      do {
        const d: z.output<typeof ordersData> = await gql(ORDERS_QUERY, { q, after }, ordersData);
        out.push(...d.orders.nodes.map(toOrder));
        after = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor ?? null : null;
      } while (after && out.length < limit);
      return out.slice(0, limit);
    },
    async listProducts({ limit = 250 } = {}) {
      const out: CommerceProduct[] = [];
      let after: string | null = null;
      do {
        const d: z.output<typeof productsData> = await gql(PRODUCTS_QUERY, { after }, productsData);
        out.push(...d.products.nodes.map(toProduct));
        after = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor ?? null : null;
      } while (after && out.length < limit);
      return out.slice(0, limit);
    },
  };
}

export const createCommerce = create;
