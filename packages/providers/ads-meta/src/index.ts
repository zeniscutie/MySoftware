import { z } from "zod";
import {
  ProviderError,
  type AdInsightRow, type AdsAnalytics, type AttentionOSConfig, type Logger, type ProviderHealth,
} from "@attentionos/core";
import { HttpClient, type FetchLike } from "@attentionos/provider-shared";

/**
 * Meta Ads (Facebook and Instagram ads), read-only, through the Marketing API insights edge.
 * AttentionOS never creates, pauses or edits campaigns, and never changes budgets.
 *
 * Secrets (.env):
 * - META_ACCESS_TOKEN    a long-lived system user token with the ads_read permission (Business settings →
 *                        Users → System users → Generate token).
 * - META_AD_ACCOUNT_ID   the ad account id, with or without the act_ prefix.
 * - META_API_VERSION     optional, default below.
 */

export const PROVIDER_ID = "ads-meta";
export const META_API_VERSION = "v25.0";
export const META_BASE_URL = "https://graph.facebook.com";
export const META_SECRETS = { token: "META_ACCESS_TOKEN", account: "META_AD_ACCOUNT_ID", apiVersion: "META_API_VERSION" } as const;

/**
 * Purchase action types, best first. Meta reports the same purchase under several types (omni_purchase also counts
 * the pixel and app events), so exactly one is used per row and never a sum.
 */
export const PURCHASE_ACTIONS = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase", "onsite_web_purchase"] as const;

export type MetaCreateOptions = {
  secret(name: string): string | undefined;
  config: AttentionOSConfig;
  log: Logger;
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
};

const actionList = z.array(z.looseObject({ action_type: z.string(), value: z.string() })).optional();

const insightRow = z.looseObject({
  date_start: z.string(),
  campaign_id: z.string().optional(),
  campaign_name: z.string().optional(),
  adset_id: z.string().optional(),
  adset_name: z.string().optional(),
  ad_id: z.string().optional(),
  ad_name: z.string().optional(),
  spend: z.string().optional(),
  impressions: z.string().optional(),
  clicks: z.string().optional(),
  account_currency: z.string().optional(),
  actions: actionList,
  action_values: actionList,
});

const insightsPage = z.looseObject({
  data: z.array(insightRow),
  paging: z.looseObject({ next: z.string().optional() }).optional(),
});

const errorBody = z.looseObject({
  error: z.looseObject({ message: z.string().optional(), code: z.number().optional(), error_subcode: z.number().optional() }),
});

/** Meta error codes for throttling (ads API, app, account) and for a bad or expired token. */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80003, 80004]);
const AUTH_CODES = new Set([102, 190, 200, 10]);

export function accountPath(id: string): string {
  const clean = id.trim();
  return clean.startsWith("act_") ? clean : `act_${clean}`;
}

/** The first purchase action type present, so a purchase is never counted twice. */
export function pickAction(list: z.output<typeof actionList>): number {
  if (!list?.length) return 0;
  for (const type of PURCHASE_ACTIONS) {
    const hit = list.find((a) => a.action_type === type);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

export function toRow(r: z.output<typeof insightRow>, level: AdInsightRow["level"]): AdInsightRow {
  return {
    day: r.date_start,
    level,
    campaignId: r.campaign_id ?? "",
    campaignName: r.campaign_name ?? "",
    ...(r.adset_id ? { adsetId: r.adset_id } : {}),
    ...(r.adset_name ? { adsetName: r.adset_name } : {}),
    ...(r.ad_id ? { adId: r.ad_id } : {}),
    ...(r.ad_name ? { adName: r.ad_name } : {}),
    spend: Number(r.spend ?? 0) || 0,
    impressions: Number(r.impressions ?? 0) || 0,
    clicks: Number(r.clicks ?? 0) || 0,
    purchases: pickAction(r.actions),
    purchaseValue: pickAction(r.action_values),
    currency: r.account_currency ?? "USD",
  };
}

const FIELDS: Record<AdInsightRow["level"], string> = {
  campaign: "campaign_id,campaign_name",
  adset: "campaign_id,campaign_name,adset_id,adset_name",
  ad: "campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name",
};

export function create(opts: MetaCreateOptions): AdsAnalytics {
  const token = opts.secret(META_SECRETS.token)?.trim();
  const account = opts.secret(META_SECRETS.account)?.trim();
  const version = opts.secret(META_SECRETS.apiVersion)?.trim() || META_API_VERSION;

  const http = new HttpClient({
    provider: PROVIDER_ID,
    baseUrl: `${META_BASE_URL}/${version}`,
    headers: () => ({}),
    log: opts.log,
    fetch: opts.fetch,
    sleep: opts.sleep,
    maxRetries: 4,
    describeError: (status, body) => {
      const parsed = errorBody.safeParse(body);
      if (!parsed.success) return { message: `Meta returned HTTP ${status}` };
      const e = parsed.data.error;
      const code = e.code !== undefined && RATE_LIMIT_CODES.has(e.code) ? "rate_limited" as const
        : e.code !== undefined && AUTH_CODES.has(e.code) ? "auth" as const
        : undefined;
      return { message: `Meta: ${e.message ?? `HTTP ${status}`}`, vendorCode: e.code, ...(code ? { code } : {}) };
    },
  });

  return {
    id: PROVIDER_ID,
    async health(): Promise<ProviderHealth> {
      if (!token || !account) {
        return {
          ok: false,
          detail: "Meta Ads isn't connected yet",
          fix: `In .env, set ${META_SECRETS.token} (a system user token with ads_read) and ${META_SECRETS.account}. See docs/dropshipping.md#connect-meta-ads.`,
        };
      }
      return { ok: true, detail: `Reads spend and purchases from ${accountPath(account)} (read-only)` };
    },
    async listDailyInsights({ since, until, level = "ad" }) {
      if (!token || !account) throw new ProviderError(PROVIDER_ID, "auth", `set ${META_SECRETS.token} and ${META_SECRETS.account}`);
      const rows: AdInsightRow[] = [];
      let next: string | undefined = http.url(`/${accountPath(account)}/insights`, {
        level,
        time_increment: 1,
        time_range: JSON.stringify({ since, until }),
        fields: `${FIELDS[level]},spend,impressions,clicks,actions,action_values,account_currency`,
        limit: 500,
        access_token: token,
      });
      for (let page = 0; next && page < 200; page++) {
        const res: z.output<typeof insightsPage> = await http.request("GET", next, { schema: insightsPage });
        rows.push(...res.data.map((r) => toRow(r, level)));
        next = res.paging?.next;
      }
      return rows;
    },
  };
}

export const createAdsAnalytics = create;
