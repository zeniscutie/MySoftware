/** Platforms AttentionOS can research, publish to or measure. */
export const PLATFORMS = ["instagram", "tiktok", "youtube", "facebook", "linkedin", "x", "threads"] as const;
export type Platform = (typeof PLATFORMS)[number];

/** Content lifecycle. */
export const CONTENT_STATUSES = [
  "idea", "scripted", "filming", "editing", "review", "scheduled", "published", "measured", "archived",
] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const FUNNEL_STAGES = ["tofu", "mofu", "bofu"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const CTA_TYPES = ["comment_keyword", "dm_keyword", "link_in_bio", "follow", "save_share", "book_call", "none"] as const;
export type CtaType = (typeof CTA_TYPES)[number];

/**
 * The six content agents, the five dropshipping agents (product research, analysis, ad content, brand design,
 * store analytics) and the orchestrator.
 */
export const AGENT_KEYS = [
  "analyst", "strategist", "copywriter", "art_director", "publisher", "community",
  "product_scout", "product_analyst", "ad_creator", "brand_designer", "store_analyst",
  "chief_of_staff",
] as const;

/** The agents that make up the dropshipping teams (the `dropship` module). */
export const DROPSHIP_AGENT_KEYS = ["product_scout", "product_analyst", "ad_creator", "brand_designer", "store_analyst"] as const;
export type AgentKey = (typeof AGENT_KEYS)[number];

export const AGENT_MONOGRAMS: Record<AgentKey, string> = {
  analyst: "An",
  strategist: "St",
  copywriter: "Cw",
  art_director: "Ad",
  publisher: "Pb",
  community: "Cm",
  product_scout: "Ps",
  product_analyst: "Pa",
  ad_creator: "Ac",
  brand_designer: "Bd",
  store_analyst: "Sa",
  chief_of_staff: "Cs",
};

export const AUTONOMY_LEVELS = ["review_all", "review_key", "autopilot"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

/** Who performed a write. Every repository write and MCP tool call carries one. */
export type Actor = `agent:${AgentKey}` | `user:${string}` | "system";

export function isActor(value: string): value is Actor {
  return value === "system" || /^user:.+/.test(value) || AGENT_KEYS.some((k) => value === `agent:${k}`);
}

/** Money is stored in micro-dollars to keep LLM/API cost sums exact. */
export type MicroUsd = number;
export const usdToMicro = (usd: number): MicroUsd => Math.round(usd * 1_000_000);
export const microToUsd = (micro: MicroUsd): number => micro / 1_000_000;
