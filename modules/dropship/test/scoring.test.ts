import { describe, expect, it } from "vitest";
import { bannedIn, checkBrandPack, checkContentPack, contrast } from "../src/checks.ts";
import { checkDomain } from "../src/domains.ts";
import { fingerprint } from "../src/repo.ts";
import type { ProductAnalysis } from "../src/schemas.ts";
import { judgePerformance, profitFor, saturationScore, scoreProduct, viralScore } from "../src/scoring.ts";
import { dropshipSettingsSchema, effectiveRules } from "../src/settings.ts";
import { aggregateOrders, matchAd } from "../src/sync.ts";

const lowTicket = dropshipSettingsSchema.parse({ rulesPreset: "low_ticket", niches: { focus: ["beauty and health"] } });
const rules = effectiveRules(lowTicket);

export function analysis(over: Partial<ProductAnalysis> = {}): ProductAnalysis {
  return {
    supplier: {
      url: "https://supplier.example/item/1",
      cost: { value: 4, sourceUrl: "https://supplier.example/item/1" },
      shippingCost: { value: 1.5, sourceUrl: "https://supplier.example/item/1" },
      shippingDaysMin: 7,
      shippingDaysMax: 12,
      rating: 4.8,
      orders: 3200,
    },
    pricing: { competitorPrices: [{ value: 27.99, sourceUrl: "https://store.example/p" }], suggestedPrice: 24.99, priceReason: "Under the usual $28" },
    saturation: { activeAds: 12, competingStores: 8, firstAdSeenDaysAgo: 20, onBigMarketplaces: false, trendDirection: "rising", notes: "Early" },
    viral: { wowFactor: 8, solvesProblem: 7, easyToDemo: 9, impulseBuy: 8, broadAppeal: 7, bestAngle: "Before and after in 10 seconds" },
    risk: { flags: [] },
    audience: "Women 20–40 into skincare",
    research: [{ kind: "supplier", url: "https://supplier.example/item/1" }],
    gaps: [],
    summary: "A strong early product",
    ...over,
  };
}

describe("settings", () => {
  it("applies the preset and lets single numbers override it", () => {
    expect(rules).toMatchObject({ minSellPrice: 10, maxSellPrice: 35, minMarkup: 4, maxShippingDays: 15 });
    const custom = effectiveRules(dropshipSettingsSchema.parse({ rulesPreset: "low_ticket", rules: { maxShippingDays: 9 } }));
    expect(custom).toMatchObject({ minMarkup: 4, maxShippingDays: 9 });
    expect(dropshipSettingsSchema.parse({}).storeModel).toBe("both");
  });
});

describe("profit", () => {
  it("works out margin, markup and break-even", () => {
    const p = profitFor(24.99, 4, 1.5, rules);
    expect(p.landedCost).toBe(5.5);
    expect(p.paymentFees).toBe(1.02);
    expect(p.grossProfit).toBe(18.47);
    expect(p.markup).toBe(4.54);
    expect(p.breakEvenCpa).toBe(18.47);
    expect(p.breakEvenRoas).toBe(1.35);
  });
  it("never divides by zero", () => {
    const p = profitFor(5, 6, 0, rules);
    expect(p.grossProfit).toBeLessThan(0);
    expect(p.breakEvenCpa).toBe(0);
    expect(p.breakEvenRoas).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("scoring", () => {
  it("passes a strong, early, cheap-to-source product", () => {
    const r = scoreProduct(analysis(), lowTicket, rules);
    expect(r.verdict).toBe("pass");
    expect(r.gates.every((g) => g.ok)).toBe(true);
    expect(r.scores.overall).toBeGreaterThanOrEqual(65);
    expect(r.reasons.join(" ")).toContain("break-even ad cost $18.47");
  });

  it("fails a product that breaks a rule, and says which", () => {
    const r = scoreProduct(analysis({ pricing: { competitorPrices: [], suggestedPrice: 49.99, priceReason: "premium" } }), lowTicket, rules);
    expect(r.verdict).toBe("fail");
    expect(r.reasons[0]).toContain("your range is $10.00–$35.00");
  });

  it("fails slow shipping and excluded categories", () => {
    const slow = analysis();
    slow.supplier = { ...slow.supplier, shippingDaysMax: 25 };
    expect(scoreProduct(slow, lowTicket, rules).gates.find((g) => g.rule === "shipping_days")!.ok).toBe(false);
    const banned = scoreProduct(analysis({ risk: { flags: [{ flag: "excluded_category", severity: "high", why: "an ingestible supplement" }] } }), lowTicket, rules);
    expect(banned.verdict).toBe("fail");
  });

  it("asks for data instead of guessing a supplier cost", () => {
    const a = analysis();
    a.supplier = { url: a.supplier.url, rating: 4.9 };
    const r = scoreProduct(a, lowTicket, rules);
    expect(r.verdict).toBe("needs_data");
    expect(r.profit).toBeNull();
    expect(r.gaps[0]).toContain("Supplier product cost");
  });

  it("scores saturation and virality from the facts", () => {
    expect(saturationScore({ activeAds: 80, competingStores: 50, firstAdSeenDaysAgo: 200, onBigMarketplaces: true, trendDirection: "falling", notes: "" })).toBe(100);
    expect(saturationScore({ activeAds: 0, competingStores: 0, onBigMarketplaces: false, trendDirection: "rising", notes: "" })).toBe(0);
    expect(viralScore({ wowFactor: 10, solvesProblem: 10, easyToDemo: 10, impulseBuy: 10, broadAppeal: 10, bestAngle: "" })).toBe(100);
    expect(viralScore({ wowFactor: 1, solvesProblem: 1, easyToDemo: 1, impulseBuy: 1, broadAppeal: 1, bestAngle: "" })).toBe(0);
  });

  it("follows the owner's weights", () => {
    const viralOnly = dropshipSettingsSchema.parse({ rulesPreset: "low_ticket", scoring: { weights: { profit: 0, saturation: 0, viral: 1, risk: 0 } } });
    const r = scoreProduct(analysis(), viralOnly, rules);
    expect(r.scores.overall).toBe(r.scores.viral);
  });
});

describe("scale or kill", () => {
  const profit = profitFor(24.99, 4, 1.5, rules);
  const zero = { revenue: 0, orders: 0, units: 0, refunds: 0, spend: 0, purchases: 0, purchaseValue: 0, clicks: 0, impressions: 0 };
  it("waits for enough spend", () => {
    expect(judgePerformance({ ...zero, spend: 10 }, profit, lowTicket.analytics, rules).call).toBe("not_enough_data");
  });
  it("kills spend with no sale", () => {
    expect(judgePerformance({ ...zero, spend: 60 }, profit, lowTicket.analytics, rules).call).toBe("kill");
  });
  it("scales well above break-even and works out net profit", () => {
    const p = judgePerformance({ ...zero, revenue: 249.9, orders: 10, units: 10, spend: 80, clicks: 400, impressions: 20000 }, profit, lowTicket.analytics, rules);
    expect(p.call).toBe("scale");
    expect(p.roas).toBe(3.12);
    expect(p.cpa).toBe(8);
    expect(p.ctr).toBe(0.02);
    expect(p.netProfit).toBe(249.9 - 55 - 7.25 - 3 - 80);
  });
  it("kills well below break-even", () => {
    expect(judgePerformance({ ...zero, revenue: 25, orders: 1, units: 1, spend: 40 }, profit, lowTicket.analytics, rules).call).toBe("kill");
  });
});

describe("content checks", () => {
  it("finds banned claims as whole phrases", () => {
    expect(bannedIn("Clinically-Proven to clear skin!", ["clinically proven"])).toEqual(["clinically proven"]);
    expect(bannedIn("A curated set", ["cure"])).toEqual([]);
  });
  it("flags scripts and copy but keeps them", () => {
    const res = checkContentPack(
      {
        angles: [{ name: "a", audience: "b", pain: "c", promise: "d" }],
        adScripts: [{ title: "t", angle: "a", format: "demo", lengthSeconds: 20, hooks: ["This cures acne"], beats: [{ say: "x", show: "y" }, { say: "x", show: "y" }], onScreenText: [], cta: "Shop now" }],
        adCopy: [{ platform: "meta", angle: "a", primaryText: "Fine", headline: "A headline that is far too long for most ad placements", cta: "shop_now" }],
        organicPosts: [],
      },
      { bannedClaims: ["cures"], hooksPerScript: 3 },
    );
    expect(res.adScripts[0]!.problems).toEqual(['Uses a banned claim: "cures"', "Has 1 hook; you asked for 3"]);
    expect(res.adCopy[0]!.problems[0]).toContain("over 40 characters");
  });
  it("checks palette contrast and duplicate names", () => {
    expect(contrast("#000000", "#FFFFFF")).toBe(21);
    const problems = checkBrandPack({
      storePlan: { recommended: "single_product", reason: "x" },
      storeNames: [{ name: "Glowly", domainIdea: "glowly.com", style: "brandable", why: "x" }, { name: "glowly", domainIdea: "getglowly.com", style: "brandable", why: "x" }],
      identity: { tagline: "t", voice: "v", palette: [{ name: "a", hex: "#EEEEEE", use: "bg" }, { name: "b", hex: "#DDDDDD", use: "text" }, { name: "c", hex: "#CCCCCC", use: "accent" }], fonts: { heading: "Inter", body: "Inter", why: "x" }, logoConcepts: [{ name: "n", description: "d", imagePrompt: "p" }] },
      creativeBriefs: [],
    });
    expect(problems).toHaveLength(2);
  });
});

describe("domains", () => {
  it("reports taken, maybe free and unknown", async () => {
    expect(await checkDomain("taken.example", async () => ["ns1.example"])).toBe("taken");
    expect(await checkDomain("free.example", async () => { throw Object.assign(new Error("x"), { code: "ENOTFOUND" }); })).toBe("maybe_free");
    expect(await checkDomain("slow.example", () => new Promise(() => {}), 10)).toBe("unknown");
    expect(await checkDomain("not a domain")).toBe("unknown");
  });
});

describe("store sync helpers", () => {
  it("normalises titles so the same product isn't added twice", () => {
    expect(fingerprint("The NEW Glow-Roller 2.0 (Pink)!")).toBe(fingerprint("glow roller 2 0 pink"));
  });
  it("aggregates orders per product and per store", () => {
    const rows = aggregateOrders([
      { id: "1", createdAt: "2026-10-10T10:00:00Z", currency: "USD", subtotal: 50, shipping: 0, discounts: 0, total: 50, refunded: 0, lines: [{ productId: "9", title: "Roller", quantity: 2, unitPrice: 25 }] },
      { id: "2", createdAt: "2026-10-10T12:00:00Z", currency: "USD", subtotal: 25, shipping: 0, discounts: 0, total: 25, refunded: 5, lines: [{ productId: "9", title: "Roller", quantity: 1, unitPrice: 25 }] },
      { id: "3", createdAt: "2026-10-10T13:00:00Z", currency: "USD", subtotal: 25, shipping: 0, discounts: 0, total: 25, refunded: 0, cancelled: true, lines: [{ productId: "9", title: "Roller", quantity: 1, unitPrice: 25 }] },
    ]);
    expect(rows.find((r) => r.key === "9")).toMatchObject({ orders: 2, units: 3, revenue: 75 });
    expect(rows.find((r) => r.key === "store")).toMatchObject({ orders: 2, revenue: 75, refunds: 5 });
  });
  it("matches ads to products by ref first, then title", () => {
    const products = [{ id: "a", ref: "pr-1", title: "Glow Roller" }, { id: "b", ref: "pr-12", title: "Pet Brush" }];
    expect(matchAd({ campaignName: "PR-12 | test", adsetName: "broad", adName: "hook a" }, products)).toBe("b");
    expect(matchAd({ campaignName: "pr_1 scale" }, products)).toBe("a");
    expect(matchAd({ campaignName: "Test", adName: "Glow roller hook B" }, products)).toBe("a");
    expect(matchAd({ campaignName: "Brand awareness" }, products)).toBeNull();
    expect(matchAd({ campaignName: "pr-123" }, products)).toBeNull();
  });
});
