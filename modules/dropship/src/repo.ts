import { agentSettings, jsonb, type Actor, type AgentKey, type Sql, type WorkspaceContext } from "@attentionos/core";
import type { ProductAnalysis, ScoutCandidate } from "./schemas.ts";
import { needsOwner, type ProductScore } from "./scoring.ts";
import { dropshipSettings } from "./settings.ts";

/** Products, stores and what the teams made, always scoped by workspace. */

export const PRODUCT_STATUSES = [
  "found", "analyzing", "needs_data", "auto_rejected", "awaiting_approval", "approved", "rejected", "launching", "live", "paused", "killed",
] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const ASSET_KINDS = [
  "ad_script", "ad_copy", "organic_post", "angle", "store_name", "brand_identity", "store_layout", "creative_brief", "store_plan", "report",
] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const STORE_KINDS = ["niche", "single_product", "general"] as const;
export type StoreKind = (typeof STORE_KINDS)[number];

export const APPROVAL_SUBJECT = "dropship_product";

/** What the repository needs from a workspace: Studio passes its own, the worker and tools a full WorkspaceContext. */
export type DsWs = Pick<WorkspaceContext, "id" | "sql" | "config" | "now">;

export type Product = {
  id: string;
  ref: string;
  title: string;
  niche: string | null;
  status: ProductStatus;
  pitch: string | null;
  sources: { kind: string; url: string; note?: string }[];
  supplier: Record<string, unknown> | null;
  evidence: Record<string, unknown>;
  analysis: (ProductAnalysis & { result?: ProductScore }) | null;
  score: number | null;
  verdict: ProductScore["verdict"] | null;
  approvalRef: string | null;
  decisionNote: string | null;
  storeId: string | null;
  shopifyProductId: string | null;
  foundBy: string;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
};

export type Store = {
  id: string;
  ref: string;
  kind: StoreKind;
  name: string;
  niche: string | null;
  status: string;
  domain: string | null;
  brand: Record<string, unknown>;
  notes: string | null;
  createdAt: string;
};

export type Asset = {
  id: string;
  productId: string | null;
  storeId: string | null;
  kind: AssetKind;
  title: string;
  body: Record<string, unknown>;
  problems: string[];
  status: string;
  createdBy: string;
  createdAt: string;
};

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
const num = (v: unknown) => (v == null ? null : Number(v));

export function toProduct(r: Row): Product {
  return {
    id: r.id as string,
    ref: r.ref as string,
    title: r.title as string,
    niche: (r.niche as string | null) ?? null,
    status: r.status as ProductStatus,
    pitch: (r.pitch as string | null) ?? null,
    sources: (r.sources as Product["sources"]) ?? [],
    supplier: (r.supplier as Product["supplier"]) ?? null,
    evidence: (r.evidence as Product["evidence"]) ?? {},
    analysis: (r.analysis as Product["analysis"]) ?? null,
    score: num(r.score),
    verdict: (r.verdict as Product["verdict"]) ?? null,
    approvalRef: (r.approval_ref as string | null) ?? null,
    decisionNote: (r.decision_note as string | null) ?? null,
    storeId: (r.store_id as string | null) ?? null,
    shopifyProductId: (r.shopify_product_id as string | null) ?? null,
    foundBy: r.found_by as string,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
    decidedAt: iso(r.decided_at),
  };
}

export function toStore(r: Row): Store {
  return {
    id: r.id as string,
    ref: r.ref as string,
    kind: r.kind as StoreKind,
    name: r.name as string,
    niche: (r.niche as string | null) ?? null,
    status: r.status as string,
    domain: (r.domain as string | null) ?? null,
    brand: (r.brand as Record<string, unknown>) ?? {},
    notes: (r.notes as string | null) ?? null,
    createdAt: iso(r.created_at)!,
  };
}

export function toAsset(r: Row): Asset {
  return {
    id: r.id as string,
    productId: (r.product_id as string | null) ?? null,
    storeId: (r.store_id as string | null) ?? null,
    kind: r.kind as AssetKind,
    title: r.title as string,
    body: r.body as Record<string, unknown>,
    problems: (r.problems as string[]) ?? [],
    status: r.status as string,
    createdBy: r.created_by as string,
    createdAt: iso(r.created_at)!,
  };
}

/** "The Glow-Roller 2.0 (Pink)!" → "glow roller 2 0 pink": the same product found twice gets the same key. */
export function fingerprint(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(the|a|an|new|hot|best|viral|2024|2025|2026|pcs|pc|set|of)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .join(" ")
    .slice(0, 120);
}

async function nextRef(sql: Sql, workspaceId: string, prefix: "pr" | "st"): Promise<string> {
  const [row] = await sql<{ n: string }[]>`select aos_next_counter(${workspaceId}, ${`dropship_${prefix}`}) as n`;
  return `${prefix}-${row!.n}`;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export async function addCandidate(ws: DsWs, actor: Actor | string, c: ScoutCandidate): Promise<{ product: Product; created: boolean }> {
  const fp = fingerprint(c.title);
  if (!fp) throw new Error("A product needs a title with letters or numbers in it.");
  return ws.sql.begin(async (tx) => {
    const sql = tx as unknown as Sql;
    const [existing] = await sql<Row[]>`select * from dropship_products where workspace_id = ${ws.id} and fingerprint = ${fp}`;
    if (existing) {
      // Seen again: keep any new source links, so the evidence grows instead of duplicating the product.
      const known = new Set(((existing.sources as { url: string }[]) ?? []).map((s) => s.url));
      const fresh = c.sources.filter((s) => !known.has(s.url));
      if (fresh.length) {
        const [row] = await sql<Row[]>`
          update dropship_products set sources = sources || ${jsonb(sql, fresh)}, updated_at = ${ws.now()}
           where workspace_id = ${ws.id} and id = ${existing.id as string} returning *`;
        return { product: toProduct(row!), created: false };
      }
      return { product: toProduct(existing), created: false };
    }
    const ref = await nextRef(sql, ws.id, "pr");
    const [row] = await sql<Row[]>`
      insert into dropship_products (workspace_id, ref, title, fingerprint, niche, pitch, sources, supplier, evidence, found_by, created_at, updated_at)
      values (${ws.id}, ${ref}, ${c.title}, ${fp}, ${c.niche.toLowerCase()}, ${c.pitch}, ${jsonb(sql, c.sources)},
              ${c.supplier ? jsonb(sql, c.supplier) : null}, ${jsonb(sql, c.evidence)}, ${actor}, ${ws.now()}, ${ws.now()})
      returning *`;
    return { product: toProduct(row!), created: true };
  });
}

export async function getProduct(ws: DsWs, refOrId: string): Promise<Product | null> {
  const byId = /^[0-9a-f-]{36}$/i.test(refOrId);
  const [row] = await ws.sql<Row[]>`
    select * from dropship_products where workspace_id = ${ws.id}
       and ${byId ? ws.sql`id = ${refOrId}` : ws.sql`ref = ${refOrId.toLowerCase()}`}`;
  return row ? toProduct(row) : null;
}

export async function listProducts(ws: DsWs, opts: { status?: ProductStatus[]; niche?: string; limit?: number } = {}): Promise<Product[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const rows = await ws.sql<Row[]>`
    select * from dropship_products where workspace_id = ${ws.id}
      ${opts.status?.length ? ws.sql`and status in ${ws.sql(opts.status)}` : ws.sql``}
      ${opts.niche ? ws.sql`and niche = ${opts.niche.toLowerCase()}` : ws.sql``}
     order by coalesce(score, -1) desc, updated_at desc
     limit ${limit}`;
  return rows.map(toProduct);
}

export async function countByStatus(ws: DsWs): Promise<Partial<Record<ProductStatus, number>>> {
  const rows = await ws.sql<{ status: ProductStatus; n: number }[]>`
    select status, count(*)::int as n from dropship_products where workspace_id = ${ws.id} group by status`;
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

export async function setProductStatus(ws: DsWs, id: string, status: ProductStatus, extra: { note?: string | null } = {}): Promise<void> {
  await ws.sql`
    update dropship_products set status = ${status}, updated_at = ${ws.now()},
           decision_note = coalesce(${extra.note ?? null}, decision_note)
     where workspace_id = ${ws.id} and id = ${id}`;
}

export async function linkShopifyProduct(ws: DsWs, id: string, shopifyProductId: string | null): Promise<void> {
  await ws.sql`update dropship_products set shopify_product_id = ${shopifyProductId}, updated_at = ${ws.now()} where workspace_id = ${ws.id} and id = ${id}`;
  // Re-attach any synced store rows for that Shopify product.
  if (shopifyProductId) {
    await ws.sql`update dropship_daily set product_id = ${id} where workspace_id = ${ws.id} and source = 'shopify' and key = ${shopifyProductId}`;
  }
}

const STATUS_FOR_VERDICT: Record<ProductScore["verdict"], ProductStatus> = {
  pass: "awaiting_approval",
  borderline: "awaiting_approval",
  weak: "auto_rejected",
  fail: "auto_rejected",
  needs_data: "needs_data",
};

/**
 * Saves the analysis and the code's score, then routes the product: strong and (if allowed) borderline picks go to
 * the owner's approvals queue; the rest are turned down automatically with their reasons kept.
 */
export async function saveAnalysis(
  ws: DsWs,
  product: Product,
  analysis: ProductAnalysis,
  result: ProductScore,
  opts: { agent?: AgentKey; runId?: string | null } = {},
): Promise<{ status: ProductStatus; approvalRef: string | null; autoApproved: boolean }> {
  const settings = dropshipSettings(ws);
  let status = STATUS_FOR_VERDICT[result.verdict];
  if (status === "awaiting_approval" && !needsOwner(result.verdict, settings)) status = "auto_rejected";
  // On autopilot the analyst approves strong picks itself; borderline ones still wait for the owner.
  const autoApproved = status === "awaiting_approval" && result.verdict === "pass" && agentSettings(ws.config, "product_analyst").autonomy === "autopilot";
  if (autoApproved) status = settings.launch.autoContent || settings.launch.autoBrand ? "launching" : "approved";
  let approvalRef: string | null = null;
  await ws.sql.begin(async (tx) => {
    const sql = tx as unknown as Sql;
    await sql`
      update dropship_products
         set analysis = ${jsonb(sql, { ...analysis, result })}, score = ${result.scores.overall}, verdict = ${result.verdict},
             supplier = ${jsonb(sql, analysis.supplier)}, status = ${status}, updated_at = ${ws.now()},
             decided_at = ${autoApproved ? ws.now() : null},
             decision_note = ${autoApproved ? "Approved automatically: the Product Analyst is on autopilot." : null}
       where workspace_id = ${ws.id} and id = ${product.id}`;
    if (status !== "awaiting_approval") return;
    // A newer analysis replaces any approval still waiting for this product.
    await sql`
      update approvals set status = 'revised', decided_at = ${ws.now()}, decided_by = 'system', decision_note = 'A newer analysis was submitted.'
       where workspace_id = ${ws.id} and status = 'pending' and subject_type = ${APPROVAL_SUBJECT} and subject_id = ${product.id}`;
    const [{ n }] = (await sql`select aos_next_counter(${ws.id}, 'ap') as n`) as unknown as [{ n: string }];
    approvalRef = `ap-${n}`;
    const p = result.profit;
    const summary = `${result.verdict === "borderline" ? "Borderline: " : ""}${product.title} (${product.ref}), score ${result.scores.overall}/100${p ? `, $${p.sellPrice} at ${p.markup}x, $${p.grossProfit} profit per sale` : ""}`;
    await sql`
      insert into approvals (workspace_id, ref, kind, subject_type, subject_id, agent, status, summary, preview, run_id)
      values (${ws.id}, ${approvalRef}, 'product', ${APPROVAL_SUBJECT}, ${product.id}, ${opts.agent ?? "product_analyst"}, 'pending', ${summary.slice(0, 300)},
              ${jsonb(sql, {
                productRef: product.ref,
                title: product.title,
                niche: product.niche,
                verdict: result.verdict,
                scores: result.scores,
                profit: result.profit,
                reasons: result.reasons,
                gaps: result.gaps,
                summary: analysis.summary,
                bestAngle: analysis.viral.bestAngle,
                link: `/products/${product.ref}`,
              })},
              null)`;
    await sql`update dropship_products set approval_ref = ${approvalRef} where workspace_id = ${ws.id} and id = ${product.id}`;
  });
  if (autoApproved && status === "launching") await startLaunch(ws, product.id, `agent:${opts.agent ?? "product_analyst"}`);
  return { status, approvalRef, autoApproved };
}

export type DecisionSync = { approved: string[]; rejected: string[]; launched: string[] };

/**
 * Applies decisions made on product approvals from any surface (Studio, Claude Code, Telegram, Discord): approved
 * products start their launch (content and brand packs, per settings), rejected ones are set aside with the note.
 */
export async function syncDecisions(ws: DsWs): Promise<DecisionSync> {
  const settings = dropshipSettings(ws);
  const rows = await ws.sql<{ id: string; ref: string; title: string; astatus: string; note: string | null; decided_by: string | null; decided_at: Date | null }[]>`
    select p.id, p.ref, p.title, a.status as astatus, a.decision_note as note, a.decided_by, a.decided_at
      from dropship_products p
      join approvals a on a.workspace_id = p.workspace_id and a.ref = p.approval_ref
     where p.workspace_id = ${ws.id} and p.status = 'awaiting_approval' and a.status in ('approved', 'rejected', 'expired')`;
  const out: DecisionSync = { approved: [], rejected: [], launched: [] };
  for (const r of rows) {
    if (r.astatus === "approved") {
      const launch = settings.launch.autoContent || settings.launch.autoBrand;
      await ws.sql`
        update dropship_products set status = ${launch ? "launching" : "approved"}, decided_at = ${r.decided_at ?? ws.now()},
               decision_note = ${r.note}, updated_at = ${ws.now()}
         where workspace_id = ${ws.id} and id = ${r.id} and status = 'awaiting_approval'`;
      out.approved.push(r.ref);
      if (launch) {
        await startLaunch(ws, r.id, r.decided_by ?? "system");
        out.launched.push(r.ref);
      }
    } else {
      await ws.sql`
        update dropship_products set status = 'rejected', decided_at = ${r.decided_at ?? ws.now()}, decision_note = ${r.note}, updated_at = ${ws.now()}
         where workspace_id = ${ws.id} and id = ${r.id} and status = 'awaiting_approval'`;
      out.rejected.push(r.ref);
    }
  }
  return out;
}

/** Queues the Ad Creator and Brand Designer for an approved product (per the launch settings). */
export async function startLaunch(ws: DsWs, productId: string, createdBy: string, only?: ("content" | "brand")[]): Promise<string[]> {
  const s = dropshipSettings(ws).launch;
  const queued: string[] = [];
  const want = (k: "content" | "brand") => (only ? only.includes(k) : k === "content" ? s.autoContent : s.autoBrand);
  if (want("content")) {
    const id = await enqueueRun(ws, { jobId: "dropship.content-pack", agent: "ad_creator", input: { productId }, dedupeKey: `dropship-content:${productId}`, createdBy });
    if (id) queued.push("content");
  }
  if (want("brand")) {
    const id = await enqueueRun(ws, { jobId: "dropship.brand-pack", agent: "brand_designer", input: { productId }, dedupeKey: `dropship-brand:${productId}`, createdBy });
    if (id) queued.push("brand");
  }
  return queued;
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export async function createStore(ws: DsWs, actor: string, input: { kind: StoreKind; name: string; niche?: string | null; domain?: string | null; brand?: Record<string, unknown>; notes?: string | null }): Promise<Store> {
  return ws.sql.begin(async (tx) => {
    const sql = tx as unknown as Sql;
    const ref = await nextRef(sql, ws.id, "st");
    const [row] = await sql<Row[]>`
      insert into dropship_stores (workspace_id, ref, kind, name, niche, domain, brand, notes, created_by, created_at, updated_at)
      values (${ws.id}, ${ref}, ${input.kind}, ${input.name}, ${input.niche?.toLowerCase() ?? null}, ${input.domain ?? null},
              ${jsonb(sql, input.brand ?? {})}, ${input.notes ?? null}, ${actor}, ${ws.now()}, ${ws.now()})
      returning *`;
    return toStore(row!);
  });
}

export async function listStores(ws: DsWs): Promise<(Store & { products: number })[]> {
  const rows = await ws.sql<Row[]>`
    select s.*, (select count(*)::int from dropship_products p where p.workspace_id = s.workspace_id and p.store_id = s.id) as products
      from dropship_stores s where s.workspace_id = ${ws.id} order by s.created_at`;
  return rows.map((r) => ({ ...toStore(r), products: Number(r.products) }));
}

export async function getStore(ws: DsWs, refOrId: string): Promise<Store | null> {
  const byId = /^[0-9a-f-]{36}$/i.test(refOrId);
  const [row] = await ws.sql<Row[]>`
    select * from dropship_stores where workspace_id = ${ws.id} and ${byId ? ws.sql`id = ${refOrId}` : ws.sql`ref = ${refOrId.toLowerCase()}`}`;
  return row ? toStore(row) : null;
}

export async function updateStore(ws: DsWs, id: string, patch: { status?: string; domain?: string | null; brand?: Record<string, unknown>; name?: string; notes?: string | null }): Promise<void> {
  await ws.sql`
    update dropship_stores set
      status = coalesce(${patch.status ?? null}, status),
      domain = ${patch.domain === undefined ? ws.sql`domain` : patch.domain},
      brand = ${patch.brand ? jsonb(ws.sql, patch.brand) : ws.sql`brand`},
      name = coalesce(${patch.name ?? null}, name),
      notes = ${patch.notes === undefined ? ws.sql`notes` : patch.notes},
      updated_at = ${ws.now()}
     where workspace_id = ${ws.id} and id = ${id}`;
}

export async function assignProduct(ws: DsWs, productId: string, storeId: string | null): Promise<void> {
  await ws.sql`update dropship_products set store_id = ${storeId}, updated_at = ${ws.now()} where workspace_id = ${ws.id} and id = ${productId}`;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export type NewAsset = { kind: AssetKind; title: string; body: Record<string, unknown>; problems?: string[] };

export async function saveAssets(ws: DsWs, target: { productId?: string | null; storeId?: string | null }, items: NewAsset[], meta: { createdBy: string; runId?: string | null }): Promise<number> {
  if (!items.length) return 0;
  const runId = meta.runId && /^[0-9a-f-]{36}$/i.test(meta.runId) ? meta.runId : null;
  await ws.sql.begin(async (tx) => {
    const sql = tx as unknown as Sql;
    for (const it of items) {
      await sql`
        insert into dropship_assets (workspace_id, product_id, store_id, kind, title, body, problems, run_id, created_by, created_at)
        values (${ws.id}, ${target.productId ?? null}, ${target.storeId ?? null}, ${it.kind}, ${it.title.slice(0, 200)},
                ${jsonb(sql, it.body)}, ${jsonb(sql, it.problems ?? [])}, ${runId}, ${meta.createdBy}, ${ws.now()})`;
    }
  });
  return items.length;
}

export async function listAssets(ws: DsWs, opts: { productId?: string; storeId?: string; kind?: AssetKind[]; limit?: number } = {}): Promise<Asset[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const rows = await ws.sql<Row[]>`
    select * from dropship_assets where workspace_id = ${ws.id}
      ${opts.productId ? ws.sql`and product_id = ${opts.productId}` : ws.sql``}
      ${opts.storeId ? ws.sql`and store_id = ${opts.storeId}` : ws.sql``}
      ${opts.kind?.length ? ws.sql`and kind in ${ws.sql(opts.kind)}` : ws.sql``}
     order by created_at desc limit ${limit}`;
  return rows.map(toAsset);
}

export async function setAssetStatus(ws: DsWs, id: string, status: "draft" | "approved" | "rejected" | "used"): Promise<boolean> {
  const rows = await ws.sql`update dropship_assets set status = ${status} where workspace_id = ${ws.id} and id = ${id} returning id`;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Queue and notifications (schema v1 tables)
// ---------------------------------------------------------------------------

export type EnqueueInput = { jobId: string; agent: AgentKey; input?: Record<string, unknown>; dedupeKey?: string; createdBy?: string; trigger?: "schedule" | "manual" | "event" | "chat" | "handoff" };

/** Queues a job run. Returns the run id, or null when the same run is already queued or running. */
export async function enqueueRun(ws: DsWs, r: EnqueueInput): Promise<string | null> {
  const rows = await ws.sql`
    insert into agent_runs (workspace_id, agent, job_id, trigger, status, input, dedupe_key, run_after, created_by)
    values (${ws.id}, ${r.agent}, ${r.jobId}, ${r.trigger ?? "handoff"}, 'queued', ${jsonb(ws.sql, r.input ?? {})},
            ${r.dedupeKey ?? null}, ${ws.now()}, ${r.createdBy ?? "system"})
    on conflict do nothing
    returning id`;
  return (rows[0]?.id as string | undefined) ?? null;
}

/** Queues a message on the owner's notification channel. False when the same dedupe key was already queued. */
export async function notify(ws: DsWs, msg: { text: string; dedupeKey?: string; priority?: "low" | "normal" | "high"; ref?: string }): Promise<boolean> {
  const body = { text: msg.text, format: "plain", priority: msg.priority ?? "normal", ...(msg.dedupeKey ? { dedupeKey: msg.dedupeKey } : {}), ...(msg.ref ? { ref: msg.ref } : {}) };
  const rows = await ws.sql`
    insert into messages (workspace_id, channel, direction, dedupe_key, ref, body, status)
    values (${ws.id}, ${ws.config.providers.notifier}, 'out', ${msg.dedupeKey ?? null}, ${msg.ref ?? null}, ${jsonb(ws.sql, body)}, 'queued')
    on conflict do nothing
    returning id`;
  return rows.length > 0;
}
