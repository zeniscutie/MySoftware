import { z } from "zod";
import { SOURCE_KINDS } from "./settings.ts";

/**
 * The shapes each team's model answer must have. The runner validates the final JSON against these before
 * `onOutput` runs, and the code then applies its own checks (rules, banned claims, colours) on top.
 */

const url = z.url().max(2000);
const short = (max: number) => z.string().trim().min(1).max(max);

export const sourceSchema = z.object({
  kind: z.enum(SOURCE_KINDS),
  url,
  note: z.string().max(300).optional(),
});

/** A number read on a web page, with the page it came from. Nothing without a source is used. */
const sourced = z.object({ value: z.number().nonnegative(), sourceUrl: url });

export const supplierSchema = z.object({
  name: z.string().max(120).optional(),
  url,
  cost: sourced.optional(),
  shippingCost: sourced.optional(),
  shippingDaysMin: z.number().int().nonnegative().optional(),
  shippingDaysMax: z.number().int().nonnegative().optional(),
  rating: z.number().min(0).max(5).optional(),
  orders: z.number().int().nonnegative().optional(),
});

// ---------------------------------------------------------------------------
// Product Scout
// ---------------------------------------------------------------------------

export const scoutCandidateSchema = z.object({
  title: short(140),
  niche: short(60),
  pitch: short(280).describe("What it is and why people buy it, in one line"),
  sources: z.array(sourceSchema).min(1).max(8),
  supplier: supplierSchema.optional(),
  evidence: z.object({
    activeAds: z.number().int().nonnegative().optional().describe("Ads for it you saw running"),
    firstAdSeenDaysAgo: z.number().int().nonnegative().optional(),
    bestAdEngagement: z.string().max(200).optional().describe("e.g. '41k likes, 900 comments on a 9-day-old TikTok ad'"),
    trendDirection: z.enum(["rising", "steady", "falling", "unknown"]).default("unknown"),
    notes: z.string().max(500).optional(),
  }).default({ trendDirection: "unknown" }),
});
export type ScoutCandidate = z.output<typeof scoutCandidateSchema>;

export const scoutOutputSchema = z.object({ candidates: z.array(scoutCandidateSchema).max(30) });

// ---------------------------------------------------------------------------
// Product Analyst
// ---------------------------------------------------------------------------

const judgment = z.number().int().min(1).max(10);

export const RISK_FLAGS = [
  "fragile", "sizing_returns", "ip_or_brand", "regulated", "seasonal", "heavy_or_bulky", "battery_or_liquid",
  "quality_complaints", "long_shipping", "single_supplier", "excluded_category",
] as const;

export const analysisSchema = z.object({
  /** Supplier facts confirmed on the supplier's own page. */
  supplier: supplierSchema,
  pricing: z.object({
    /** What competing stores charge, each read on a page. */
    competitorPrices: z.array(sourced).max(10).default([]),
    suggestedPrice: z.number().positive().describe("Your proposed selling price, inside the owner's price range"),
    priceReason: short(300),
  }),
  saturation: z.object({
    activeAds: z.number().int().nonnegative().describe("Distinct advertisers running ads for it now"),
    competingStores: z.number().int().nonnegative().describe("Stores you found selling it"),
    firstAdSeenDaysAgo: z.number().int().nonnegative().optional(),
    onBigMarketplaces: z.boolean().describe("Sold widely on the big marketplaces at low prices"),
    trendDirection: z.enum(["rising", "steady", "falling", "unknown"]),
    notes: short(400),
  }),
  viral: z.object({
    wowFactor: judgment,
    solvesProblem: judgment,
    easyToDemo: judgment.describe("Can a 15-second video show it working?"),
    impulseBuy: judgment.describe("Cheap and exciting enough to buy without thinking"),
    broadAppeal: judgment,
    bestAngle: short(200),
  }),
  risk: z.object({
    flags: z.array(z.object({ flag: z.enum(RISK_FLAGS), severity: z.enum(["low", "medium", "high"]), why: short(200) })).max(11).default([]),
    notes: z.string().max(400).optional(),
  }),
  audience: short(300),
  /** Every page you used. */
  research: z.array(sourceSchema).min(1).max(20),
  /** Anything you could not find. Missing numbers go here, never guessed. */
  gaps: z.array(z.string().max(200)).max(10).default([]),
  summary: short(600),
});
export type ProductAnalysis = z.output<typeof analysisSchema>;

export const analystOutputSchema = z.object({ analysis: analysisSchema.nullable(), skipReason: z.string().max(300).optional() });

// ---------------------------------------------------------------------------
// Ad Creator
// ---------------------------------------------------------------------------

export const AD_FORMATS = ["ugc_testimonial", "demo", "problem_solution", "before_after", "unboxing", "comparison", "storytime"] as const;

export const adScriptSchema = z.object({
  title: short(80),
  angle: short(200),
  format: z.enum(AD_FORMATS),
  lengthSeconds: z.number().int().min(6).max(90),
  hooks: z.array(short(160)).min(1).max(6).describe("Alternative first lines, said in the first 2 seconds"),
  beats: z.array(z.object({ say: short(240), show: short(240) })).min(2).max(12),
  onScreenText: z.array(short(80)).max(8).default([]),
  cta: short(120),
});

export const adCopySchema = z.object({
  platform: z.enum(["meta", "tiktok"]),
  angle: short(200),
  primaryText: short(1200),
  headline: short(80),
  description: z.string().max(120).optional(),
  cta: z.enum(["shop_now", "learn_more", "order_now", "get_offer", "buy_now"]),
});

export const organicPostSchema = z.object({
  platform: z.enum(["tiktok", "instagram", "facebook", "youtube"]),
  day: z.number().int().min(1).max(31),
  format: z.enum(["short_video", "carousel", "photo", "story"]),
  hook: short(160),
  caption: short(2200),
  hashtags: z.array(z.string().regex(/^#?[\p{L}\p{N}_]{1,60}$/u)).max(15).default([]),
  shotList: z.array(short(200)).max(10).default([]),
});

export const contentPackSchema = z.object({
  angles: z.array(z.object({ name: short(80), audience: short(200), pain: short(200), promise: short(200) })).min(1).max(8),
  adScripts: z.array(adScriptSchema).max(10).default([]),
  adCopy: z.array(adCopySchema).max(10).default([]),
  organicPosts: z.array(organicPostSchema).max(21).default([]),
});
export type ContentPack = z.output<typeof contentPackSchema>;

// ---------------------------------------------------------------------------
// Brand Designer
// ---------------------------------------------------------------------------

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "a 6-digit hex colour like #1A2B3C");

export const brandPackSchema = z.object({
  storePlan: z.object({
    recommended: z.enum(["single_product", "niche", "existing_store"]),
    existingStoreRef: z.string().regex(/^st-\d+$/).optional(),
    nicheName: z.string().max(80).optional(),
    reason: short(400),
  }),
  storeNames: z.array(z.object({
    name: z.string().trim().min(2).max(30),
    domainIdea: z.string().regex(/^[a-z0-9-]{2,40}\.[a-z]{2,10}$/, "a bare domain like glowly.com"),
    style: z.enum(["brandable", "descriptive", "playful", "premium", "minimal"]),
    why: short(200),
  })).max(20).default([]),
  identity: z.object({
    tagline: short(90),
    voice: short(300),
    palette: z.array(z.object({ name: short(30), hex, use: short(80) })).min(3).max(6),
    fonts: z.object({ heading: short(40), body: short(40), why: short(200) }),
    logoConcepts: z.array(z.object({ name: short(60), description: short(300), imagePrompt: short(600) })).min(1).max(5),
  }).optional(),
  layout: z.object({
    theme: short(80).describe("A Shopify theme and why"),
    homepage: z.array(z.object({ section: short(60), content: short(400) })).min(3).max(14),
    productPage: z.array(z.object({ section: short(60), content: short(400) })).min(3).max(14),
    trustElements: z.array(short(120)).max(10).default([]),
    pages: z.array(short(60)).max(10).default([]),
  }).optional(),
  creativeBriefs: z.array(z.object({
    title: short(80),
    format: z.enum(["image_ad", "video_ad", "carousel", "thumbnail", "product_photo"]),
    concept: short(400),
    shots: z.array(short(200)).max(10).default([]),
    textOverlay: z.string().max(120).optional(),
    imagePrompt: z.string().max(600).optional(),
  })).max(10).default([]),
});
export type BrandPack = z.output<typeof brandPackSchema>;

// ---------------------------------------------------------------------------
// Store Analyst
// ---------------------------------------------------------------------------

export const storeReportSchema = z.object({
  headline: short(200),
  products: z.array(z.object({
    ref: z.string().regex(/^pr-\d+$/),
    call: z.enum(["scale", "keep_testing", "fix", "kill", "not_enough_data"]),
    why: short(400),
    nextSteps: z.array(short(200)).max(5).default([]),
  })).max(50).default([]),
  storeNotes: z.array(short(300)).max(8).default([]),
});
export type StoreReport = z.output<typeof storeReportSchema>;

/** The schema as JSON Schema, for prompts (the runner validates the real answer). */
export function jsonShape(schema: z.ZodType): string {
  const { $schema: _drop, ...json } = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  return `Reply with one JSON object only (no prose, no code fence) matching this JSON Schema:\n${JSON.stringify(json)}`;
}

/** Parses JSON from a model answer: the whole text, a fenced block, or the outermost object. */
export function parseModelJson(text: string): unknown {
  const attempts = [text.trim()];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced?.[1]) attempts.push(fenced[1].trim());
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) attempts.push(text.slice(first, last + 1));
  for (const a of attempts) {
    try {
      return JSON.parse(a);
    } catch {
      // try the next shape
    }
  }
  return undefined;
}

/** The validated answer, whether the runner handed over the object or the model's text. */
export function readModelOutput<T extends z.ZodType>(schema: T, output: unknown): z.output<T> {
  const direct = schema.safeParse(output);
  if (direct.success) return direct.data;
  const text = output && typeof output === "object" && typeof (output as { summary?: unknown }).summary === "string" ? (output as { summary: string }).summary : typeof output === "string" ? output : "";
  const candidate = parseModelJson(text);
  if (candidate === undefined) throw new Error("The answer wasn't valid JSON.");
  const parsed = schema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`The answer didn't match the expected format: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "answer"}: ${i.message}`).join("; ")}`);
  }
  return parsed.data;
}
