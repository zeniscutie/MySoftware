import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ProviderError, parseConfig, silentLogger } from "@attentionos/core";
import { create, gidToId, normalizeDomain, SHOPIFY_API_VERSION } from "../src/index.ts";
import { fakeFetch, fixture, noSleep, type Route } from "./fake-fetch.ts";

const FIX = fileURLToPath(new URL("./fixtures", import.meta.url));
const NOW = Date.parse("2026-10-14T12:00:00Z");
const GQL = `/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

function setup(routes: Route[], secrets: Record<string, string>, now = () => NOW) {
  const ff = fakeFetch(routes);
  const s = noSleep();
  const provider = create({
    secret: (n) => secrets[n],
    config: parseConfig({ providers: { commerce: "shopify" } }),
    log: silentLogger,
    fetch: ff.fetch,
    sleep: s.sleep,
    now,
  });
  return { provider, calls: ff.calls, sleeps: s.sleeps };
}

const byQuery = (call: { body?: unknown }) => String((call.body as { query?: string })?.query ?? "");

describe("helpers", () => {
  it("normalises store domains", () => {
    expect(normalizeDomain("demo-store")).toBe("demo-store.myshopify.com");
    expect(normalizeDomain("https://Demo-Store.myshopify.com/admin")).toBe("demo-store.myshopify.com");
    expect(normalizeDomain("  ")).toBeUndefined();
  });
  it("turns gids into plain ids", () => {
    expect(gidToId("gid://shopify/Product/9001")).toBe("9001");
    expect(gidToId(null)).toBeNull();
  });
});

describe("shopify commerce", () => {
  it("explains what is missing instead of failing", async () => {
    const { provider } = setup([], {});
    const h = await provider.health();
    expect(h.ok).toBe(false);
    expect(h.fix).toContain("SHOPIFY_STORE_DOMAIN");
    await expect(provider.getShop()).rejects.toBeInstanceOf(ProviderError);
  });

  it("reads orders across pages with a static token", async () => {
    const { provider, calls } = setup(
      [{ method: "POST", match: GQL, respond: [{ body: fixture(FIX, "orders-page1.json") }, { body: fixture(FIX, "orders-page2.json") }] }],
      { SHOPIFY_STORE_DOMAIN: "examplebrand", SHOPIFY_ACCESS_TOKEN: "shpat_test" },
    );
    const orders = await provider.listOrders({ since: "2026-10-01", until: "2026-10-14" });
    expect(orders).toHaveLength(2);
    expect(orders[0]).toMatchObject({ id: "5001", name: "#1001", total: 44.98, discounts: 5, financialStatus: "paid" });
    expect(orders[0]!.lines[0]).toMatchObject({ productId: "9001", quantity: 2, unitPrice: 24.99, sku: "EX-ROLL-1" });
    expect(orders[1]!.lines[0]!.productId).toBeNull();
    expect(orders[1]!.refunded).toBe(4.99);
    expect(calls[0]!.url).toContain("https://examplebrand.myshopify.com");
    expect(calls[0]!.headers["x-shopify-access-token"]).toBe("shpat_test");
    expect((calls[0]!.body as { variables: { q: string } }).variables.q).toBe("created_at:>='2026-10-01' created_at:<'2026-10-14'");
    expect((calls[1]!.body as { variables: { after: string } }).variables.after).toBe("cursor-1");
  });

  it("mints a token with client credentials and reuses it until it nearly expires", async () => {
    let t = NOW;
    const { provider, calls } = setup(
      [
        { method: "POST", match: "/admin/oauth/access_token", respond: [{ body: { access_token: "tok-1", expires_in: 3600 } }, { body: { access_token: "tok-2", expires_in: 3600 } }] },
        { method: "POST", match: GQL, respond: (c) => ({ body: byQuery(c).includes("shop {") ? fixture(FIX, "shop.json") : fixture(FIX, "products.json") }) },
      ],
      { SHOPIFY_STORE_DOMAIN: "examplebrand.myshopify.com", SHOPIFY_CLIENT_ID: "cid", SHOPIFY_CLIENT_SECRET: "csecret" },
      () => t,
    );
    const shop = await provider.getShop();
    expect(shop).toEqual({ name: "Examplebrand Studio", domain: "examplebrand.myshopify.com", currency: "USD", timezone: "America/New_York" });
    const products = await provider.listProducts();
    expect(products[0]).toMatchObject({ id: "9001", price: 24.99, status: "active" });
    expect(calls.filter((c) => c.path.endsWith("/access_token"))).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ grant_type: "client_credentials", client_id: "cid" });
    t += 3_590_000; // inside the last minute: refresh
    await provider.getShop();
    expect(calls.filter((c) => c.path.endsWith("/access_token"))).toHaveLength(2);
    expect(calls.at(-1)!.headers["x-shopify-access-token"]).toBe("tok-2");
  });

  it("waits and retries when Shopify throttles a query", async () => {
    const { provider, sleeps } = setup(
      [{ method: "POST", match: GQL, respond: [{ body: { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] } }, { body: fixture(FIX, "shop.json") }] }],
      { SHOPIFY_STORE_DOMAIN: "examplebrand", SHOPIFY_ACCESS_TOKEN: "shpat_test" },
    );
    expect((await provider.getShop()).name).toBe("Examplebrand Studio");
    expect(sleeps).toEqual([2000]);
  });

  it("maps a missing scope to an auth error", async () => {
    const { provider } = setup(
      [{ method: "POST", match: GQL, respond: { body: { errors: [{ message: "Access denied for orders field.", extensions: { code: "ACCESS_DENIED" } }] } } }],
      { SHOPIFY_STORE_DOMAIN: "examplebrand", SHOPIFY_ACCESS_TOKEN: "shpat_test" },
    );
    await expect(provider.listOrders({ since: "2026-10-01" })).rejects.toMatchObject({ code: "auth" });
  });
});
