"use server";

import { z } from "zod";
import { ApprovalError, decideApproval, enqueueRun } from "@attentionos/db";
import {
  assignProduct, createStore, getProduct, getStore, listAssets, setAssetStatus, setProductStatus, startLaunch, syncDecisions,
} from "@attentionos/module-dropship/repo";
import { requireSession } from "@/server/auth";
import { dropshipOn, dropshipWs } from "@/server/queries/products";
import { BAD_REQUEST, id, parse } from "@/server/validate";

/**
 * Products from Studio. Approving or rejecting goes through the shared approvals queue (so chat and Claude Code see the
 * same decision); everything else queues the team's job or updates the board.
 */

const ACTOR = "user:studio" as const;
export type ProductActionResult = { ok: true; message: string } | { ok: false; error: string };

const productRef = z.string().trim().regex(/^pr-\d{1,9}$/i);
const NOT_ON = "Turn on the dropship module first (modules.dropship.enabled in config/attentionos.config.ts).";

function explain(e: unknown): string {
  if (e instanceof ApprovalError) return [e.message, e.hint].filter(Boolean).join(" ");
  console.error("[studio] products action failed:", e);
  return "Couldn't save that. Check the database connection and try again.";
}

export async function decideProductAction(rawRef: string, rawDecision: "approved" | "rejected", rawNote?: string): Promise<ProductActionResult> {
  await requireSession();
  if (!dropshipOn()) return { ok: false, error: NOT_ON };
  const args = parse(z.object({ ref: productRef, decision: z.enum(["approved", "rejected"]), note: z.string().max(2000).optional() }), { ref: rawRef, decision: rawDecision, note: rawNote || undefined });
  if (!args) return { ok: false, error: BAD_REQUEST };
  const ws = dropshipWs();
  try {
    const p = await getProduct(ws, args.ref);
    if (!p?.approvalRef || p.status !== "awaiting_approval") return { ok: false, error: "That product isn't waiting for a decision." };
    await decideApproval(ws.sql, ws.id, { refOrId: p.approvalRef, decision: args.decision, actor: ACTOR, ...(args.note?.trim() ? { note: args.note.trim() } : {}) });
    const r = await syncDecisions(ws);
    if (args.decision === "rejected") return { ok: true, message: `Set aside ${p.title}.` };
    return { ok: true, message: r.launched.includes(p.ref) ? `Approved ${p.title}. The Ad Creator and Brand Designer are on it.` : `Approved ${p.title}.` };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

export async function huntAction(rawFocus?: string): Promise<ProductActionResult> {
  await requireSession();
  if (!dropshipOn()) return { ok: false, error: NOT_ON };
  const focus = parse(z.string().trim().max(300), rawFocus ?? "");
  if (focus === undefined) return { ok: false, error: BAD_REQUEST };
  const ws = dropshipWs();
  try {
    const run = await enqueueRun(ws.sql, { workspaceId: ws.id, jobId: "dropship.product-hunt", agent: "product_scout", trigger: "manual", input: focus ? { focus } : {}, dedupeKey: "dropship-hunt", createdBy: ACTOR });
    return run.deduped ? { ok: true, message: "The Product Scout is already hunting." } : { ok: true, message: `The Product Scout is hunting${focus ? ` for ${focus}` : ""}. New products land here as they're found.` };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

export async function reanalyzeAction(rawRef: string): Promise<ProductActionResult> {
  await requireSession();
  if (!dropshipOn()) return { ok: false, error: NOT_ON };
  const ref = parse(productRef, rawRef);
  if (!ref) return { ok: false, error: BAD_REQUEST };
  const ws = dropshipWs();
  try {
    const p = await getProduct(ws, ref);
    if (!p) return { ok: false, error: "No such product." };
    if (!["found", "analyzing", "needs_data", "auto_rejected", "rejected"].includes(p.status)) return { ok: false, error: "Only new, incomplete or turned-down products can be analysed again." };
    await setProductStatus(ws, p.id, "found");
    await enqueueRun(ws.sql, { workspaceId: ws.id, jobId: "dropship.analyze-product", agent: "product_analyst", trigger: "manual", input: { productId: p.id }, dedupeKey: `dropship-analyze:${p.id}`, createdBy: ACTOR });
    return { ok: true, message: `The Product Analyst is checking ${p.title} again.` };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

export async function relaunchAction(rawRef: string, rawOnly: "content" | "brand" | "both"): Promise<ProductActionResult> {
  await requireSession();
  if (!dropshipOn()) return { ok: false, error: NOT_ON };
  const args = parse(z.object({ ref: productRef, only: z.enum(["content", "brand", "both"]) }), { ref: rawRef, only: rawOnly });
  if (!args) return { ok: false, error: BAD_REQUEST };
  const ws = dropshipWs();
  try {
    const p = await getProduct(ws, args.ref);
    if (!p || !["approved", "launching", "live", "paused"].includes(p.status)) return { ok: false, error: "Approve the product first." };
    const queued = await startLaunch(ws, p.id, ACTOR, args.only === "both" ? ["content", "brand"] : [args.only]);
    if (queued.length && p.status === "approved") await setProductStatus(ws, p.id, "launching");
    if (!queued.length) return { ok: true, message: "That's already being made." };
    return { ok: true, message: queued.length === 2 ? "The Ad Creator and Brand Designer are on it." : queued[0] === "content" ? "The Ad Creator is writing new ads and posts." : "The Brand Designer is on a new brand kit." };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

export async function setProductStatusAction(rawRef: string, rawStatus: "live" | "paused" | "killed"): Promise<ProductActionResult> {
  await requireSession();
  if (!dropshipOn()) return { ok: false, error: NOT_ON };
  const args = parse(z.object({ ref: productRef, status: z.enum(["live", "paused", "killed"]) }), { ref: rawRef, status: rawStatus });
  if (!args) return { ok: false, error: BAD_REQUEST };
  const ws = dropshipWs();
  try {
    const p = await getProduct(ws, args.ref);
    if (!p) return { ok: false, error: "No such product." };
    if (args.status !== "killed" && !["approved", "launching", "live", "paused"].includes(p.status)) return { ok: false, error: "Only approved products can go live or be paused." };
    await setProductStatus(ws, p.id, args.status);
    return { ok: true, message: `${p.title} is ${args.status === "live" ? "live" : args.status}.` };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

export async function createStoreFromProductAction(rawRef: string, rawInput: { nameAssetId: string; identityAssetId?: string; kind: "single_product" | "niche" | "general"; niche?: string }): Promise<ProductActionResult> {
  await requireSession();
  if (!dropshipOn()) return { ok: false, error: NOT_ON };
  const args = parse(
    z.object({ ref: productRef, nameAssetId: id, identityAssetId: id.optional(), kind: z.enum(["single_product", "niche", "general"]), niche: z.string().trim().max(60).optional() }),
    { ref: rawRef, ...rawInput },
  );
  if (!args) return { ok: false, error: BAD_REQUEST };
  const ws = dropshipWs();
  try {
    const p = await getProduct(ws, args.ref);
    if (!p) return { ok: false, error: "No such product." };
    const assets = await listAssets(ws, { productId: p.id, kind: ["store_name", "brand_identity"], limit: 300 });
    const name = assets.find((a) => a.id === args.nameAssetId && a.kind === "store_name");
    if (!name) return { ok: false, error: "Pick one of the proposed store names." };
    const identity = args.identityAssetId ? assets.find((a) => a.id === args.identityAssetId && a.kind === "brand_identity") : assets.find((a) => a.kind === "brand_identity");
    const store = await createStore(ws, ACTOR, {
      kind: args.kind,
      name: String(name.body.name ?? name.title),
      niche: args.kind === "niche" ? args.niche || p.niche : p.niche,
      domain: typeof name.body.domainIdea === "string" ? name.body.domainIdea : null,
      brand: identity?.body ?? {},
    });
    await assignProduct(ws, p.id, store.id);
    await setAssetStatus(ws, name.id, "approved");
    if (identity) await setAssetStatus(ws, identity.id, "approved");
    return { ok: true, message: `Created ${store.name} (${store.ref}) with ${p.title} in it.` };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

export async function assignStoreAction(rawRef: string, rawStore: string | null): Promise<ProductActionResult> {
  await requireSession();
  if (!dropshipOn()) return { ok: false, error: NOT_ON };
  const args = parse(z.object({ ref: productRef, store: z.string().regex(/^st-\d{1,9}$/i).nullable() }), { ref: rawRef, store: rawStore });
  if (!args) return { ok: false, error: BAD_REQUEST };
  const ws = dropshipWs();
  try {
    const p = await getProduct(ws, args.ref);
    const s = args.store ? await getStore(ws, args.store) : null;
    if (!p || (args.store && !s)) return { ok: false, error: "No such product or store." };
    await assignProduct(ws, p.id, s?.id ?? null);
    return { ok: true, message: s ? `${p.title} is in ${s.name}.` : `${p.title} isn't in a store now.` };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

export async function setAssetStatusAction(rawId: string, rawStatus: "approved" | "rejected" | "used" | "draft"): Promise<ProductActionResult> {
  await requireSession();
  if (!dropshipOn()) return { ok: false, error: NOT_ON };
  const args = parse(z.object({ id, status: z.enum(["approved", "rejected", "used", "draft"]) }), { id: rawId, status: rawStatus });
  if (!args) return { ok: false, error: BAD_REQUEST };
  try {
    return (await setAssetStatus(dropshipWs(), args.id, args.status)) ? { ok: true, message: "Saved." } : { ok: false, error: "Not found." };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}

export async function syncStoreAction(): Promise<ProductActionResult> {
  await requireSession();
  if (!dropshipOn()) return { ok: false, error: NOT_ON };
  const ws = dropshipWs();
  try {
    const run = await enqueueRun(ws.sql, { workspaceId: ws.id, jobId: "dropship.store-sync", agent: "store_analyst", trigger: "manual", input: {}, dedupeKey: "dropship-store-sync", createdBy: ACTOR });
    return { ok: true, message: run.deduped ? "A sync is already running." : "Pulling the latest Shopify and Meta Ads numbers." };
  } catch (e) {
    return { ok: false, error: explain(e) };
  }
}
