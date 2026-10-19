import type { ProductAnalysis } from "./schemas.ts";
import type { DropshipSettings, Rules } from "./settings.ts";

/**
 * Product scoring and the owner's rules, in code. The analyst gathers facts and gives judgments (1–10); everything
 * here is arithmetic on them, so the same product always gets the same score and the reasons are explainable.
 */

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

export type Profit = {
  sellPrice: number;
  productCost: number;
  shippingCost: number;
  landedCost: number;
  paymentFees: number;
  grossProfit: number;
  /** 0–1. */
  grossMargin: number;
  markup: number;
  /** The most one sale may cost in ads before the product loses money. */
  breakEvenCpa: number;
  /** Revenue ÷ ad spend needed to break even. */
  breakEvenRoas: number;
};

export function profitFor(sellPrice: number, productCost: number, shippingCost: number, rules: Pick<Rules, "paymentFeePct" | "paymentFeeFixed">): Profit {
  const landedCost = productCost + shippingCost;
  const paymentFees = sellPrice * (rules.paymentFeePct / 100) + rules.paymentFeeFixed;
  const grossProfit = sellPrice - landedCost - paymentFees;
  return {
    sellPrice: round(sellPrice),
    productCost: round(productCost),
    shippingCost: round(shippingCost),
    landedCost: round(landedCost),
    paymentFees: round(paymentFees),
    grossProfit: round(grossProfit),
    grossMargin: sellPrice > 0 ? round(grossProfit / sellPrice, 3) : 0,
    markup: landedCost > 0 ? round(sellPrice / landedCost) : 0,
    breakEvenCpa: round(Math.max(0, grossProfit)),
    breakEvenRoas: grossProfit > 0 ? round(sellPrice / grossProfit) : Number.POSITIVE_INFINITY,
  };
}

/** 0–100: markup against the target (60%) plus profit per sale against the cheapest allowed price (40%). */
export function profitScore(p: Profit, rules: Pick<Rules, "minMarkup" | "minSellPrice">): number {
  if (p.grossProfit <= 0) return 0;
  const markupPart = Math.min(1, p.markup / (rules.minMarkup * 1.5)) * 60;
  const dollarPart = Math.min(1, p.grossProfit / Math.max(10, rules.minSellPrice)) * 40;
  return Math.round(clamp(markupPart + dollarPart));
}

/** 0–100, higher = more crowded. Lots of advertisers and stores, old ads and cheap marketplace copies push it up. */
export function saturationScore(s: ProductAnalysis["saturation"]): number {
  let score = 0;
  score += Math.min(40, s.activeAds * 0.8); // 50+ advertisers = 40
  score += Math.min(30, s.competingStores * 1); // 30+ stores = 30
  if (s.firstAdSeenDaysAgo !== undefined) score += s.firstAdSeenDaysAgo > 180 ? 15 : s.firstAdSeenDaysAgo > 90 ? 10 : s.firstAdSeenDaysAgo > 30 ? 5 : 0;
  if (s.onBigMarketplaces) score += 15;
  if (s.trendDirection === "rising") score -= 10;
  if (s.trendDirection === "falling") score += 10;
  return Math.round(clamp(score));
}

/** 0–100 from the analyst's five 1–10 judgments. */
export function viralScore(v: ProductAnalysis["viral"]): number {
  const parts = [v.wowFactor, v.solvesProblem, v.easyToDemo, v.impulseBuy, v.broadAppeal];
  // Demo-ability and wow count double: short-form ads live on them.
  const weighted = (v.wowFactor * 2 + v.easyToDemo * 2 + v.solvesProblem + v.impulseBuy + v.broadAppeal) / 7;
  return parts.every((n) => n >= 1) ? Math.round(clamp(((weighted - 1) / 9) * 100)) : 0;
}

const SEVERITY = { low: 8, medium: 18, high: 35 } as const;

/** 0–100, higher = riskier: flagged risks plus supplier weaknesses measured against the rules. */
export function riskScore(a: ProductAnalysis, rules: Rules): number {
  let score = 0;
  for (const f of a.risk.flags) score += SEVERITY[f.severity];
  const sup = a.supplier;
  if (sup.shippingDaysMax !== undefined && sup.shippingDaysMax > rules.maxShippingDays) score += 15;
  if (sup.rating !== undefined && sup.rating < rules.minSupplierRating) score += 15;
  if (rules.minSupplierOrders > 0 && sup.orders !== undefined && sup.orders < rules.minSupplierOrders) score += 10;
  return Math.round(clamp(score));
}

export type Gate = { rule: string; ok: boolean; detail: string };
export type Verdict = "pass" | "borderline" | "weak" | "fail" | "needs_data";

export type ProductScore = {
  profit: Profit | null;
  scores: { profit: number; saturation: number; viral: number; risk: number; overall: number };
  gates: Gate[];
  verdict: Verdict;
  /** Plain-language reasons, worst first. */
  reasons: string[];
  gaps: string[];
};

const money = (n: number) => `$${n.toFixed(2)}`;

/** Scores an analysis against the owner's rules. Pure: no I/O. */
export function scoreProduct(a: ProductAnalysis, settings: DropshipSettings, rules: Rules): ProductScore {
  const gaps = [...a.gaps];
  const cost = a.supplier.cost?.value;
  const ship = a.supplier.shippingCost?.value ?? (a.supplier.cost ? 0 : undefined);
  if (cost === undefined) gaps.unshift("Supplier product cost (with the page it's on)");
  if (a.supplier.shippingDaysMax === undefined) gaps.push("Supplier delivery time");

  const profit = cost !== undefined && ship !== undefined ? profitFor(a.pricing.suggestedPrice, cost, ship, rules) : null;
  const scores = {
    profit: profit ? profitScore(profit, rules) : 0,
    saturation: saturationScore(a.saturation),
    viral: viralScore(a.viral),
    risk: riskScore(a, rules),
    overall: 0,
  };
  const w = settings.scoring.weights;
  const total = w.profit + w.saturation + w.viral + w.risk || 1;
  scores.overall = Math.round((w.profit * scores.profit + w.saturation * (100 - scores.saturation) + w.viral * scores.viral + w.risk * (100 - scores.risk)) / total);

  const gates: Gate[] = [];
  const price = a.pricing.suggestedPrice;
  gates.push({ rule: "price_range", ok: price >= rules.minSellPrice && price <= rules.maxSellPrice, detail: `Sells at ${money(price)}; your range is ${money(rules.minSellPrice)}–${money(rules.maxSellPrice)}` });
  if (profit) {
    gates.push({ rule: "markup", ok: profit.markup >= rules.minMarkup, detail: `${profit.markup}x markup on a ${money(profit.landedCost)} landed cost; you want ${rules.minMarkup}x` });
    gates.push({ rule: "gross_margin", ok: profit.grossMargin >= rules.minGrossMargin, detail: `${Math.round(profit.grossMargin * 100)}% gross margin after fees; you want ${Math.round(rules.minGrossMargin * 100)}%` });
  }
  if (a.supplier.shippingDaysMax !== undefined) {
    gates.push({ rule: "shipping_days", ok: a.supplier.shippingDaysMax <= rules.maxShippingDays, detail: `Delivers in up to ${a.supplier.shippingDaysMax} days; your limit is ${rules.maxShippingDays}` });
  }
  if (a.supplier.rating !== undefined) {
    gates.push({ rule: "supplier_rating", ok: a.supplier.rating >= rules.minSupplierRating, detail: `Supplier rated ${a.supplier.rating}/5; you want ${rules.minSupplierRating}` });
  }
  if (rules.minSupplierOrders > 0 && a.supplier.orders !== undefined) {
    gates.push({ rule: "supplier_orders", ok: a.supplier.orders >= rules.minSupplierOrders, detail: `${a.supplier.orders} orders on the listing; you want ${rules.minSupplierOrders}+` });
  }
  gates.push({ rule: "saturation", ok: scores.saturation <= rules.maxSaturation, detail: `Saturation ${scores.saturation}/100; your limit is ${rules.maxSaturation}` });
  gates.push({ rule: "risk", ok: scores.risk <= rules.maxRisk, detail: `Risk ${scores.risk}/100; your limit is ${rules.maxRisk}` });
  const excluded = a.risk.flags.find((f) => f.flag === "excluded_category");
  gates.push({ rule: "excluded_category", ok: !excluded, detail: excluded ? `In a category you exclude: ${excluded.why}` : "Not in an excluded category" });

  const failed = gates.filter((g) => !g.ok);
  let verdict: Verdict;
  if (!profit) verdict = "needs_data";
  else if (failed.length) verdict = "fail";
  else if (scores.overall >= settings.scoring.passAt) verdict = "pass";
  else if (scores.overall >= settings.scoring.borderlineAt) verdict = "borderline";
  else verdict = "weak";

  const reasons = [
    ...failed.map((g) => g.detail),
    ...(profit ? [`Makes ${money(profit.grossProfit)} per sale before ads; break-even ad cost ${money(profit.breakEvenCpa)} per sale (ROAS ${Number.isFinite(profit.breakEvenRoas) ? profit.breakEvenRoas : "n/a"})`] : []),
    `Scores: profit ${scores.profit}, saturation ${scores.saturation}, viral ${scores.viral}, risk ${scores.risk} → ${scores.overall}/100`,
  ];
  return { profit, scores, gates, verdict, reasons, gaps };
}

/** Whether a verdict goes to the owner's approvals queue. */
export function needsOwner(verdict: Verdict, settings: DropshipSettings): boolean {
  return verdict === "pass" || (verdict === "borderline" && settings.scoring.sendBorderline);
}

// ---------------------------------------------------------------------------
// Scale or kill
// ---------------------------------------------------------------------------

export type ProductNumbers = {
  revenue: number;
  orders: number;
  units: number;
  refunds: number;
  spend: number;
  purchases: number;
  purchaseValue: number;
  clicks: number;
  impressions: number;
};

export type Call = "scale" | "keep_testing" | "kill" | "not_enough_data";

export type Performance = ProductNumbers & {
  /** Store revenue ÷ ad spend (falls back to Meta's purchase value when the store has no sales linked). */
  roas: number | null;
  cpa: number | null;
  ctr: number | null;
  /** Revenue minus product and shipping cost, fees, refunds and ad spend. Null without a landed cost. */
  netProfit: number | null;
  breakEvenRoas: number | null;
  call: Call;
  why: string;
};

/** The scale / keep testing / kill call for one product over a window. Pure. */
export function judgePerformance(n: ProductNumbers, profit: Profit | null, a: DropshipSettings["analytics"], rules: Pick<Rules, "paymentFeePct" | "paymentFeeFixed">): Performance {
  const revenue = n.revenue > 0 ? n.revenue : n.purchaseValue;
  const sales = n.orders > 0 ? n.orders : n.purchases;
  const roas = n.spend > 0 ? round(revenue / n.spend) : null;
  const cpa = n.spend > 0 && sales > 0 ? round(n.spend / sales) : null;
  const ctr = n.impressions > 0 ? round(n.clicks / n.impressions, 4) : null;
  const units = n.units > 0 ? n.units : sales;
  const netProfit = profit
    ? round(revenue - n.refunds - units * profit.landedCost - (revenue * rules.paymentFeePct) / 100 - sales * rules.paymentFeeFixed - n.spend)
    : null;
  const be = profit && Number.isFinite(profit.breakEvenRoas) ? profit.breakEvenRoas : null;

  let call: Call = "not_enough_data";
  let why = `Spent ${money(n.spend)} of the ${money(a.minSpendToJudge)} needed to judge it`;
  if (n.spend >= a.killAfterSpendNoSale && sales === 0) {
    call = "kill";
    why = `Spent ${money(n.spend)} with no sale (your limit is ${money(a.killAfterSpendNoSale)})`;
  } else if (n.spend >= a.minSpendToJudge && roas !== null) {
    if (be === null) {
      call = "keep_testing";
      why = `ROAS ${roas}; add the supplier cost to judge it against break-even`;
    } else if (roas >= be * a.scaleAtBreakEvenMultiple) {
      call = "scale";
      why = `ROAS ${roas} is ${round(roas / be)}x break-even (${be})`;
    } else if (roas < be * a.killBelowBreakEvenShare) {
      call = "kill";
      why = `ROAS ${roas} is well below break-even (${be})`;
    } else {
      call = "keep_testing";
      why = `ROAS ${roas} is near break-even (${be}); test new hooks or angles`;
    }
  }
  return { ...n, roas, cpa, ctr, netProfit, breakEvenRoas: be, call, why };
}
