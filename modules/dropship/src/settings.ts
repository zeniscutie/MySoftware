import { z } from "zod";
import { moduleSettings, type WorkspaceContext } from "@attentionos/core";

/**
 * `config.modules.dropship.settings`: everything the dropshipping teams follow. Every field has a default, so you only
 * write the ones you want to change. Money is in your store's currency.
 */

export const STORE_MODELS = ["niche", "single_product", "both", "general"] as const;
export const SOURCE_KINDS = ["tiktok_ads", "meta_ads", "supplier", "trends", "competitor_store", "marketplace", "other"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const DEFAULT_EXCLUDED = [
  "weapons", "adult", "tobacco and vaping", "prescription or medical devices", "supplements and ingestibles",
  "baby car seats and cribs", "counterfeit or branded goods", "batteries shipped loose",
];

/** Phrases ad copy may never use. Health and beauty claims are the usual reason ad accounts get banned. */
export const DEFAULT_BANNED_CLAIMS = [
  "cure", "cures", "heal", "heals", "treats", "treatment for", "clinically proven", "doctor recommended", "fda approved",
  "guaranteed results", "100% guaranteed", "miracle", "lose weight fast", "anti-aging cure", "permanent results",
  "no side effects", "risk-free", "get rich",
];

/** The rule fields, without defaults: the owner's overrides only ever contain what they wrote. */
const ruleFields = {
  /** Your selling price must land inside this range. */
  minSellPrice: z.number().nonnegative(),
  maxSellPrice: z.number().positive(),
  /** Selling price ÷ landed cost (product + shipping to the customer). */
  minMarkup: z.number().min(1),
  /** Gross margin after product, shipping and payment fees, 0–1. */
  minGrossMargin: z.number().min(0).max(1),
  /** Slowest supplier delivery you accept, in days. */
  maxShippingDays: z.number().int().positive(),
  /** Supplier rating out of 5. */
  minSupplierRating: z.number().min(0).max(5),
  /** Orders the supplier listing has already filled (proof it ships). 0 turns the check off. */
  minSupplierOrders: z.number().int().nonnegative(),
  /** 0–100, worked out in code. Products more saturated than this are turned down. */
  maxSaturation: z.number().min(0).max(100),
  /** 0–100, worked out in code. Riskier products than this are turned down. */
  maxRisk: z.number().min(0).max(100),
  /** Payment processing: percent of the sale plus a fixed amount per order. */
  paymentFeePct: z.number().min(0).max(20),
  paymentFeeFixed: z.number().min(0),
  /** Categories never worth the risk. */
  excludedCategories: z.array(z.string().min(1)),
};

const RULE_DEFAULTS = {
  minSellPrice: 20, maxSellPrice: 80, minMarkup: 3, minGrossMargin: 0.55, maxShippingDays: 12, minSupplierRating: 4.6, minSupplierOrders: 100,
  maxSaturation: 75, maxRisk: 60, paymentFeePct: 2.9, paymentFeeFixed: 0.3, excludedCategories: DEFAULT_EXCLUDED,
};

const rulesSchema = z.object(ruleFields);
const rulesOverrideSchema = z.object(ruleFields).partial();

const PRESETS = {
  /** $10–$35 impulse buys, at least 4x markup, delivery within 15 days. */
  low_ticket: { minSellPrice: 10, maxSellPrice: 35, minMarkup: 4, minGrossMargin: 0.6, maxShippingDays: 15, minSupplierRating: 4.6 },
  /** $20–$80, at least 3x markup, delivery within 12 days. */
  standard: { minSellPrice: 20, maxSellPrice: 80, minMarkup: 3, minGrossMargin: 0.55, maxShippingDays: 12, minSupplierRating: 4.6 },
  /** $50–$150, at least 2.5x markup, delivery within 10 days. */
  high_ticket: { minSellPrice: 50, maxSellPrice: 150, minMarkup: 2.5, minGrossMargin: 0.5, maxShippingDays: 10, minSupplierRating: 4.7 },
} as const;
export type RulesPreset = keyof typeof PRESETS;

const weightsSchema = z.object({
  profit: z.number().nonnegative().default(30),
  saturation: z.number().nonnegative().default(20),
  viral: z.number().nonnegative().default(30),
  risk: z.number().nonnegative().default(20),
});

export const dropshipSettingsSchema = z.object({
  /**
   * How you sell: "niche" (one store, several products in a niche), "single_product" (a branded store per winner),
   * "both" (the Brand Designer proposes both and you pick per product) or "general" (one store, any niche).
   */
  storeModel: z.enum(STORE_MODELS).default("both"),

  niches: z.object({
    /** Niches the scout looks at first, e.g. ["beauty and health"]. */
    focus: z.array(z.string().min(1)).default([]),
    /** Also look outside the focus niches. */
    anyNiche: z.boolean().default(true),
    /** Share of each hunt spent on the focus niches when anyNiche is on, 0–1. */
    focusShare: z.number().min(0).max(1).default(0.6),
  }).default({ focus: [], anyNiche: true, focusShare: 0.6 }),

  /** Where the Product Scout looks. */
  sources: z.object({
    tiktokAds: z.boolean().default(true),
    metaAds: z.boolean().default(true),
    suppliers: z.boolean().default(true),
    trends: z.boolean().default(true),
    competitorStores: z.boolean().default(false),
  }).default({ tiktokAds: true, metaAds: true, suppliers: true, trends: true, competitorStores: false }),

  /** Start from a preset and override single numbers in `rules`. */
  rulesPreset: z.enum(Object.keys(PRESETS) as [RulesPreset, ...RulesPreset[]]).default("standard"),
  rules: rulesOverrideSchema.default({}),

  scoring: z.object({
    /** How much each part counts in the overall score (any numbers; they're normalised). */
    weights: weightsSchema.default({ profit: 30, saturation: 20, viral: 30, risk: 20 }),
    /** Overall score (0–100) at which a product is sent to you as a strong pick. */
    passAt: z.number().min(0).max(100).default(65),
    /** From here up to passAt a product is "borderline". */
    borderlineAt: z.number().min(0).max(100).default(50),
    /** Send borderline products for approval too (marked as borderline). */
    sendBorderline: z.boolean().default(true),
  }).default({ weights: { profit: 30, saturation: 20, viral: 30, risk: 20 }, passAt: 65, borderlineAt: 50, sendBorderline: true }),

  hunt: z.object({
    /** New products the scout adds per hunt. */
    perRun: z.number().int().min(1).max(30).default(10),
    /** Products analysed per analysis run. */
    analyzePerRun: z.number().int().min(1).max(20).default(6),
  }).default({ perRun: 10, analyzePerRun: 6 }),

  /** What happens after you approve a product. */
  launch: z.object({
    /** Start the Ad Creator right away. */
    autoContent: z.boolean().default(true),
    /** Start the Brand Designer right away. */
    autoBrand: z.boolean().default(true),
    content: z.object({
      adScripts: z.boolean().default(true),
      adCopy: z.boolean().default(true),
      organicPosts: z.boolean().default(true),
      /** How many of each. */
      scriptCount: z.number().int().min(1).max(10).default(3),
      hooksPerScript: z.number().int().min(1).max(6).default(3),
      adCopyCount: z.number().int().min(1).max(10).default(3),
      postCount: z.number().int().min(1).max(21).default(7),
      /** Platforms for ads and posts. */
      adPlatforms: z.array(z.enum(["meta", "tiktok"])).default(["meta", "tiktok"]),
      postPlatforms: z.array(z.enum(["tiktok", "instagram", "facebook", "youtube"])).default(["tiktok", "instagram", "youtube"]),
      /** Phrases no ad or post may use. */
      bannedClaims: z.array(z.string().min(1)).default(DEFAULT_BANNED_CLAIMS),
    }).default({
      adScripts: true, adCopy: true, organicPosts: true, scriptCount: 3, hooksPerScript: 3, adCopyCount: 3, postCount: 7,
      adPlatforms: ["meta", "tiktok"], postPlatforms: ["tiktok", "instagram", "youtube"], bannedClaims: DEFAULT_BANNED_CLAIMS,
    }),
    brand: z.object({
      storeNames: z.boolean().default(true),
      identity: z.boolean().default(true),
      layout: z.boolean().default(true),
      creativeBriefs: z.boolean().default(true),
      nameCount: z.number().int().min(3).max(20).default(8),
      briefCount: z.number().int().min(1).max(10).default(4),
      /** Look up whether NAME.com already has DNS records (a quick sign it's taken). */
      checkDomains: z.boolean().default(true),
    }).default({ storeNames: true, identity: true, layout: true, creativeBriefs: true, nameCount: 8, briefCount: 4, checkDomains: true }),
  }).default({
    autoContent: true,
    autoBrand: true,
    content: {
      adScripts: true, adCopy: true, organicPosts: true, scriptCount: 3, hooksPerScript: 3, adCopyCount: 3, postCount: 7,
      adPlatforms: ["meta", "tiktok"], postPlatforms: ["tiktok", "instagram", "youtube"], bannedClaims: DEFAULT_BANNED_CLAIMS,
    },
    brand: { storeNames: true, identity: true, layout: true, creativeBriefs: true, nameCount: 8, briefCount: 4, checkDomains: true },
  }),

  /** Store numbers and the scale-or-kill calls. */
  analytics: z.object({
    /** Days of Shopify and Meta Ads history each sync reads. */
    lookbackDays: z.number().int().min(1).max(90).default(14),
    /** Days the report and the dashboard judge on. */
    windowDays: z.number().int().min(1).max(90).default(7),
    /** No call is made until a product has spent this much on ads. */
    minSpendToJudge: z.number().nonnegative().default(30),
    /** Kill when a product spent this much with no sale. */
    killAfterSpendNoSale: z.number().nonnegative().default(50),
    /** Scale when ROAS is at least this many times the break-even ROAS. */
    scaleAtBreakEvenMultiple: z.number().min(1).default(1.5),
    /** Kill when ROAS is below this share of break-even once minSpendToJudge is reached. */
    killBelowBreakEvenShare: z.number().min(0).max(1).default(0.7),
  }).default({ lookbackDays: 14, windowDays: 7, minSpendToJudge: 30, killAfterSpendNoSale: 50, scaleAtBreakEvenMultiple: 1.5, killBelowBreakEvenShare: 0.7 }),

  /** The morning dropshipping digest (no AI, always arrives). */
  digest: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
});

export type DropshipSettings = z.output<typeof dropshipSettingsSchema>;
export type Rules = z.output<typeof rulesSchema>;

/** The preset's numbers with your overrides on top. */
export function effectiveRules(s: DropshipSettings): Rules {
  return rulesSchema.parse({ ...RULE_DEFAULTS, ...PRESETS[s.rulesPreset], ...s.rules });
}

export function dropshipSettings(ws: Pick<WorkspaceContext, "config">): DropshipSettings {
  return dropshipSettingsSchema.parse(moduleSettings(ws.config, "dropship").settings ?? {});
}

export const RULES_PRESETS = PRESETS;
