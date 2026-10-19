import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseConfig, silentLogger } from "@attentionos/core";
import { accountPath, create, pickAction } from "../src/index.ts";
import { fakeFetch, fixture, noSleep, type Route } from "./fake-fetch.ts";

const FIX = fileURLToPath(new URL("./fixtures", import.meta.url));

function setup(routes: Route[], secrets: Record<string, string>) {
  const ff = fakeFetch(routes);
  const s = noSleep();
  const provider = create({ secret: (n) => secrets[n], config: parseConfig({ providers: { adsAnalytics: "meta" } }), log: silentLogger, fetch: ff.fetch, sleep: s.sleep });
  return { provider, calls: ff.calls, sleeps: s.sleeps };
}

const KEYS = { META_ACCESS_TOKEN: "test-token", META_AD_ACCOUNT_ID: "99" };

describe("helpers", () => {
  it("adds the act_ prefix once", () => {
    expect(accountPath("99")).toBe("act_99");
    expect(accountPath("act_99")).toBe("act_99");
  });
  it("counts one purchase type, never the sum of duplicates", () => {
    expect(pickAction([{ action_type: "purchase", value: "2" }, { action_type: "omni_purchase", value: "2" }])).toBe(2);
    expect(pickAction([{ action_type: "offsite_conversion.fb_pixel_purchase", value: "4" }])).toBe(4);
    expect(pickAction([{ action_type: "link_click", value: "40" }])).toBe(0);
    expect(pickAction(undefined)).toBe(0);
  });
});

describe("meta ads analytics", () => {
  it("explains what is missing", async () => {
    const h = await setup([], {}).provider.health();
    expect(h.ok).toBe(false);
    expect(h.fix).toContain("META_ACCESS_TOKEN");
  });

  it("reads daily ad rows across pages", async () => {
    const { provider, calls } = setup(
      [
        { method: "GET", match: /\/v25\.0\/act_99\/insights\?.*after=b/, respond: { body: fixture(FIX, "insights-page2.json") } },
        { method: "GET", match: /\/v25\.0\/act_99\/insights\?/, respond: { body: fixture(FIX, "insights-page1.json") } },
      ],
      KEYS,
    );
    const rows = await provider.listDailyInsights({ since: "2026-10-12", until: "2026-10-13" });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ day: "2026-10-12", level: "ad", adId: "140001", spend: 41.2, purchases: 3, purchaseValue: 89.97, clicks: 96, currency: "USD" });
    expect(rows[1]).toMatchObject({ adName: "Hook B", purchases: 0, purchaseValue: 0 });
    const first = new URL(calls[0]!.url);
    expect(first.searchParams.get("level")).toBe("ad");
    expect(first.searchParams.get("time_increment")).toBe("1");
    expect(JSON.parse(first.searchParams.get("time_range")!)).toEqual({ since: "2026-10-12", until: "2026-10-13" });
  });

  it("maps an expired token to an auth error", async () => {
    const { provider } = setup(
      [{ method: "GET", match: /insights/, respond: { status: 400, body: { error: { message: "Error validating access token", code: 190 } } } }],
      KEYS,
    );
    await expect(provider.listDailyInsights({ since: "2026-10-12", until: "2026-10-13" })).rejects.toMatchObject({ code: "auth" });
  });
});
