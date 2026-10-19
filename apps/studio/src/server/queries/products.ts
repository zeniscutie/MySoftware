import "server-only";
import {
  countByStatus, getProduct, getStore, listAssets, listProducts, listStores, syncDecisions,
  type Asset, type DsWs, type Product, type ProductStatus,
} from "@attentionos/module-dropship/repo";
import { dropshipSettings, effectiveRules } from "@attentionos/module-dropship/settings";
import { storePerformance, type ProductPerformance, type StorePerformance } from "@attentionos/module-dropship/sync";
import type { ProductScore } from "@attentionos/module-dropship/scoring";
import { workspace } from "@/server/workspace";

/**
 * The Products board in Studio: what the dropshipping teams found, what's waiting for the owner's OK, what's launching
 * and how live products are doing. Decisions made anywhere (here, chat, Claude Code) are applied before reading.
 */

export function dropshipWs(): DsWs {
  const ws = workspace();
  return { id: ws.id, sql: ws.sql, config: ws.config, now: () => new Date() };
}

export function dropshipOn(): boolean {
  return Boolean(workspace().config.modules.dropship?.enabled);
}

export type ProductCard = {
  ref: string;
  title: string;
  niche: string | null;
  status: ProductStatus;
  pitch: string | null;
  score: number | null;
  verdict: ProductScore["verdict"] | null;
  scores: ProductScore["scores"] | null;
  profit: ProductScore["profit"];
  reasons: string[];
  gaps: string[];
  approvalRef: string | null;
  approvalId: string | null;
  bestAngle: string | null;
  sources: { kind: string; url: string }[];
  decisionNote: string | null;
  updatedAt: string;
};

function card(p: Product, approvalIds: Map<string, string>): ProductCard {
  const r = p.analysis?.result;
  return {
    ref: p.ref,
    title: p.title,
    niche: p.niche,
    status: p.status,
    pitch: p.pitch,
    score: p.score,
    verdict: p.verdict,
    scores: r?.scores ?? null,
    profit: r?.profit ?? null,
    reasons: r?.reasons ?? [],
    gaps: r?.gaps ?? [],
    approvalRef: p.approvalRef,
    approvalId: p.approvalRef ? approvalIds.get(p.approvalRef) ?? null : null,
    bestAngle: p.analysis?.viral?.bestAngle ?? null,
    sources: p.sources.map((s) => ({ kind: s.kind, url: s.url })),
    decisionNote: p.decisionNote,
    updatedAt: p.updatedAt,
  };
}

export type RulesView = { minSellPrice: number; maxSellPrice: number; minMarkup: number; maxShippingDays: number; minSupplierRating: number; focus: string[]; anyNiche: boolean; storeModel: string };

export type ProductsData = {
  on: boolean;
  counts: Partial<Record<ProductStatus, number>>;
  waiting: ProductCard[];
  launching: ProductCard[];
  live: ProductCard[];
  pipeline: ProductCard[];
  passed: ProductCard[];
  stores: { ref: string; name: string; kind: string; niche: string | null; status: string; domain: string | null; products: number }[];
  performance: StorePerformance | null;
  rules: RulesView;
  connected: { shopify: boolean; meta: boolean };
};

async function approvalIdsFor(ws: DsWs, refs: string[]): Promise<Map<string, string>> {
  if (!refs.length) return new Map();
  const rows = await ws.sql<{ id: string; ref: string }[]>`select id, ref from approvals where workspace_id = ${ws.id} and ref in ${ws.sql(refs)}`;
  return new Map(rows.map((r) => [r.ref, r.id]));
}

export async function getProductsData(): Promise<ProductsData> {
  const cfg = workspace().config;
  const s = dropshipSettings({ config: cfg });
  const r = effectiveRules(s);
  const rules: RulesView = { minSellPrice: r.minSellPrice, maxSellPrice: r.maxSellPrice, minMarkup: r.minMarkup, maxShippingDays: r.maxShippingDays, minSupplierRating: r.minSupplierRating, focus: s.niches.focus, anyNiche: s.niches.anyNiche, storeModel: s.storeModel };
  const connected = { shopify: cfg.providers.commerce !== "none", meta: cfg.providers.adsAnalytics !== "none" };
  if (!dropshipOn()) {
    return { on: false, counts: {}, waiting: [], launching: [], live: [], pipeline: [], passed: [], stores: [], performance: null, rules, connected };
  }
  const ws = dropshipWs();
  await syncDecisions(ws);
  const [counts, all, stores, performance] = await Promise.all([countByStatus(ws), listProducts(ws, { limit: 300 }), listStores(ws), storePerformance(ws)]);
  const ids = await approvalIdsFor(ws, all.map((p) => p.approvalRef).filter((x): x is string => Boolean(x)));
  const cards = all.map((p) => card(p, ids));
  const by = (...st: ProductStatus[]) => cards.filter((c) => st.includes(c.status));
  return {
    on: true,
    counts,
    waiting: by("awaiting_approval"),
    launching: by("launching", "approved"),
    live: by("live", "paused"),
    pipeline: by("found", "analyzing", "needs_data").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    passed: by("auto_rejected", "rejected", "killed").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 40),
    stores: stores.map((x) => ({ ref: x.ref, name: x.name, kind: x.kind, niche: x.niche, status: x.status, domain: x.domain, products: x.products })),
    performance: performance.products.length || performance.store.revenue || performance.store.spend ? performance : null,
    rules,
    connected,
  };
}

export type AssetView = { id: string; kind: Asset["kind"]; title: string; body: Record<string, unknown>; problems: string[]; status: string; createdAt: string };

export type ProductDetail = {
  card: ProductCard;
  gates: { rule: string; ok: boolean; detail: string }[];
  analysis: {
    summary: string | null;
    audience: string | null;
    supplier: Record<string, unknown> | null;
    saturation: Record<string, unknown> | null;
    viral: Record<string, unknown> | null;
    risks: { flag: string; severity: string; why: string }[];
    competitorPrices: { value: number; sourceUrl: string }[];
    priceReason: string | null;
    research: { kind: string; url: string }[];
  } | null;
  evidence: Record<string, unknown>;
  store: { ref: string; name: string } | null;
  stores: { ref: string; name: string; kind: string }[];
  assets: AssetView[];
  performance: ProductPerformance | null;
  busy: string[];
};

export async function getProductDetail(ref: string): Promise<ProductDetail | null> {
  if (!dropshipOn()) return null;
  const ws = dropshipWs();
  await syncDecisions(ws);
  const p = await getProduct(ws, ref);
  if (!p) return null;
  const [assets, stores, perf, store, runs] = await Promise.all([
    listAssets(ws, { productId: p.id, limit: 300 }),
    listStores(ws),
    storePerformance(ws),
    p.storeId ? getStore(ws, p.storeId) : Promise.resolve(null),
    ws.sql<{ job_id: string }[]>`
      select job_id from agent_runs where workspace_id = ${ws.id} and status in ('queued', 'running') and input->>'productId' = ${p.id}`,
  ]);
  const ids = await approvalIdsFor(ws, p.approvalRef ? [p.approvalRef] : []);
  const a = p.analysis;
  return {
    card: card(p, ids),
    gates: a?.result?.gates ?? [],
    analysis: a
      ? {
          summary: a.summary ?? null,
          audience: a.audience ?? null,
          supplier: (a.supplier as Record<string, unknown>) ?? null,
          saturation: (a.saturation as Record<string, unknown>) ?? null,
          viral: (a.viral as Record<string, unknown>) ?? null,
          risks: a.risk?.flags ?? [],
          competitorPrices: a.pricing?.competitorPrices ?? [],
          priceReason: a.pricing?.priceReason ?? null,
          research: (a.research ?? []).map((x) => ({ kind: x.kind, url: x.url })),
        }
      : null,
    evidence: p.evidence,
    store: store ? { ref: store.ref, name: store.name } : null,
    stores: stores.map((x) => ({ ref: x.ref, name: x.name, kind: x.kind })),
    assets: assets.map((x) => ({ id: x.id, kind: x.kind, title: x.title, body: x.body, problems: x.problems, status: x.status, createdAt: x.createdAt })),
    performance: perf.products.find((x) => x.ref === p.ref) ?? null,
    busy: runs.map((r) => r.job_id),
  };
}
