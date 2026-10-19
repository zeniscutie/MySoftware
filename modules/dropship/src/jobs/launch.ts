import { z } from "zod";
import { defineLlmJob, type JobGate, type WorkspaceContext } from "@attentionos/core";
import { checkBrandPack, checkContentPack } from "../checks.ts";
import { ownerContext, productBlock, UNTRUSTED_NOTE } from "../context.ts";
import { checkDomains } from "../domains.ts";
import { getProduct, listStores, notify, saveAssets, type NewAsset, type Product } from "../repo.ts";
import { brandPackSchema, contentPackSchema, jsonShape, readModelOutput } from "../schemas.ts";
import { dropshipSettings } from "../settings.ts";

/**
 * What happens after the owner approves a product. Both jobs work only from the saved product (fenced as data) and
 * the owner's own files, so they run with NO tools; their answers are validated and checked in code before saving.
 */

const LAUNCH_JOBS = ["dropship.content-pack", "dropship.brand-pack"];

/** When neither launch job is still queued or running for the product, it's ready: tell the owner. */
export async function finishLaunchIfDone(ws: WorkspaceContext, product: Product, currentRunId: string): Promise<boolean> {
  const busy = await ws.sql`
    select 1 from agent_runs
     where workspace_id = ${ws.id} and job_id in ${ws.sql(LAUNCH_JOBS)} and status in ('queued', 'running')
       and input->>'productId' = ${product.id} and id::text <> ${currentRunId}
     limit 1`;
  if (busy.length) return false;
  const rows = await ws.sql`
    update dropship_products set status = 'approved', updated_at = ${ws.now()}
     where workspace_id = ${ws.id} and id = ${product.id} and status = 'launching' returning id`;
  if (rows.length) {
    await notify(ws, { text: `${product.title} (${product.ref}) is ready to launch: ad scripts, ad copy, posts and the brand kit are on its page.`, dedupeKey: `dropship-ready:${product.id}` });
  }
  return rows.length > 0;
}

const launchInput = z.object({ productId: z.string().uuid() });

async function launchGate(ws: WorkspaceContext, productId: string): Promise<JobGate | null> {
  const p = await getProduct(ws, productId);
  if (!p) return { stop: "That product is no longer on the board." };
  if (!["approved", "launching", "live"].includes(p.status)) return { stop: `${p.ref} isn't approved (it's ${p.status.replace("_", " ")}).` };
  return null;
}

export const contentPackJob = defineLlmJob({
  kind: "llm",
  id: "dropship.content-pack",
  agent: "ad_creator",
  description: "Writes video ad scripts, ad copy and organic posts for an approved product.",
  input: launchInput,
  skill: "ad-content",
  toolless: true,
  allowedTools: [],
  defaultModel: "opus",
  maxTurns: 3,
  budgetUsd: 1,
  timeoutMs: 10 * 60_000,
  output: contentPackSchema,
  gate: (ctx) => launchGate(ctx.ws, ctx.input.productId),
  async prompt(ctx) {
    const p = (await getProduct(ctx.ws, ctx.input.productId))!;
    const c = dropshipSettings(ctx.ws).launch.content;
    const want = [
      c.adScripts ? `- adScripts: ${c.scriptCount} video ad scripts, each a different angle and format, each with ${c.hooksPerScript} alternative hooks` : "- adScripts: none (leave the list empty)",
      c.adCopy ? `- adCopy: ${c.adCopyCount} ad copy variants for each of: ${c.adPlatforms.join(", ")}` : "- adCopy: none (leave the list empty)",
      c.organicPosts ? `- organicPosts: ${c.postCount} organic posts spread over days 1–${c.postCount}, across ${c.postPlatforms.join(", ")}` : "- organicPosts: none (leave the list empty)",
    ];
    return [
      `Write the ad content for ${p.ref}. Follow the ad-content skill.`,
      "",
      ownerContext(ctx.ws, ["content"]),
      "",
      "## The product (approved by the owner)",
      productBlock(p, { analysis: true }),
      "",
      UNTRUSTED_NOTE,
      "",
      "## What to make",
      "- angles: 3–5 selling angles (who it's for, the pain, the promise); every script and ad uses one of them",
      ...want,
      "",
      `Never use these phrases or anything like them: ${c.bannedClaims.map((b) => `"${b}"`).join(", ")}.`,
      "No medical or guaranteed-result claims, no fake scarcity, no made-up reviews or numbers, no competitor brand names.",
      "Your final message is the JSON, nothing else.",
      jsonShape(contentPackSchema),
    ].filter((l) => l !== "").join("\n");
  },
  async onOutput(ctx, output) {
    const p = await getProduct(ctx.ws, ctx.input.productId);
    if (!p) return;
    const c = dropshipSettings(ctx.ws).launch.content;
    const pack = readModelOutput(contentPackSchema, output);
    const checks = checkContentPack(pack, { bannedClaims: c.bannedClaims, hooksPerScript: c.hooksPerScript });
    const problemsAt = (list: { index: number; problems: string[] }[], i: number) => list.find((x) => x.index === i)?.problems ?? [];
    const items: NewAsset[] = [
      ...pack.angles.map((a): NewAsset => ({ kind: "angle", title: a.name, body: a })),
      ...pack.adScripts.map((s, i): NewAsset => ({ kind: "ad_script", title: s.title, body: s, problems: problemsAt(checks.adScripts, i) })),
      ...pack.adCopy.map((a, i): NewAsset => ({ kind: "ad_copy", title: `${a.platform === "meta" ? "Meta" : "TikTok"}: ${a.headline}`, body: a, problems: problemsAt(checks.adCopy, i) })),
      ...pack.organicPosts.map((o, i): NewAsset => ({ kind: "organic_post", title: `Day ${o.day} · ${o.platform}: ${o.hook}`, body: o, problems: problemsAt(checks.organicPosts, i) })),
    ];
    await saveAssets(ctx.ws, { productId: p.id }, items, { createdBy: "agent:ad_creator", runId: ctx.runId });
    const flagged = items.filter((i) => i.problems?.length).length;
    await ctx.progress(
      `Wrote ${pack.adScripts.length} ad scripts, ${pack.adCopy.length} ad copy variants and ${pack.organicPosts.length} posts for ${p.title}` +
        (flagged ? ` (${flagged} flagged for a fix)` : ""),
    );
    await finishLaunchIfDone(ctx.ws, p, ctx.runId);
  },
});

export const brandPackJob = defineLlmJob({
  kind: "llm",
  id: "dropship.brand-pack",
  agent: "brand_designer",
  description: "Names the store and designs the brand, layout and ad creatives for an approved product.",
  input: launchInput,
  skill: "brand-design",
  toolless: true,
  allowedTools: [],
  defaultModel: "opus",
  maxTurns: 3,
  budgetUsd: 1,
  timeoutMs: 10 * 60_000,
  output: brandPackSchema,
  gate: (ctx) => launchGate(ctx.ws, ctx.input.productId),
  async prompt(ctx) {
    const p = (await getProduct(ctx.ws, ctx.input.productId))!;
    const s = dropshipSettings(ctx.ws);
    const b = s.launch.brand;
    const stores = await listStores(ctx.ws);
    const current = p.storeId ? stores.find((x) => x.id === p.storeId) : undefined;
    const model = {
      niche: "The owner runs niche stores: recommend an existing niche store that fits, or a new niche store.",
      single_product: "The owner runs one-product stores: design a store just for this product.",
      both: "The owner runs both niche stores and one-product stores: recommend the better fit for this product and say why.",
      general: "The owner runs a general store: recommend the existing general store, and design for it.",
    }[s.storeModel];
    return [
      `Design the store and brand for ${p.ref}. Follow the brand-design skill.`,
      "",
      ownerContext(ctx.ws, ["brand"]),
      "",
      "## The product (approved by the owner)",
      productBlock(p, { analysis: true }),
      "",
      UNTRUSTED_NOTE,
      "",
      "## The owner's stores (trusted)",
      stores.length ? stores.map((x) => `- ${x.ref} ${x.name} (${x.kind.replace("_", " ")}${x.niche ? `, ${x.niche}` : ""}, ${x.products} products)`).join("\n") : "(none yet)",
      current ? `This product is already assigned to ${current.ref} ${current.name}: design for that store.` : model,
      "",
      "## What to make",
      "- storePlan: single_product, niche (a new niche store, give nicheName) or existing_store (give existingStoreRef)",
      b.storeNames ? `- storeNames: ${b.nameCount} store names with a domain idea each (short, easy to spell, no trademarks)` : "- storeNames: none (leave empty)",
      b.identity ? "- identity: tagline, voice, a 3–6 colour palette with hex codes (text and background must be readable together), fonts (Google Fonts), 2–3 logo concepts with an image prompt each" : "- identity: leave it out",
      b.layout ? "- layout: a Shopify theme, homepage sections, product page sections (in order), trust elements and pages" : "- layout: leave it out",
      b.creativeBriefs ? `- creativeBriefs: ${b.briefCount} briefs for ad images, ad videos, thumbnails or product photos` : "- creativeBriefs: none (leave empty)",
      "",
      "Never use another company's brand or trademark in a name, logo or domain.",
      "Your final message is the JSON, nothing else.",
      jsonShape(brandPackSchema),
    ].filter((l) => l !== "").join("\n");
  },
  async onOutput(ctx, output) {
    const p = await getProduct(ctx.ws, ctx.input.productId);
    if (!p) return;
    const b = dropshipSettings(ctx.ws).launch.brand;
    const pack = readModelOutput(brandPackSchema, output);
    const problems = checkBrandPack(pack);
    const domains = b.checkDomains && pack.storeNames.length ? await checkDomains(pack.storeNames.map((n) => n.domainIdea)) : {};
    const items: NewAsset[] = [
      { kind: "store_plan", title: pack.storePlan.recommended === "existing_store" ? `Add to ${pack.storePlan.existingStoreRef}` : pack.storePlan.recommended === "niche" ? `New niche store: ${pack.storePlan.nicheName ?? "niche"}` : "One-product store", body: pack.storePlan },
      ...pack.storeNames.map((n): NewAsset => ({
        kind: "store_name",
        title: n.name,
        body: { ...n, domainStatus: domains[n.domainIdea.toLowerCase()] ?? "unchecked" },
        problems: problems.filter((x) => x.includes(`"${n.name}"`)),
      })),
      ...(pack.identity ? [{ kind: "brand_identity" as const, title: pack.identity.tagline, body: pack.identity, problems: problems.filter((x) => x.startsWith("No two palette")) }] : []),
      ...(pack.layout ? [{ kind: "store_layout" as const, title: pack.layout.theme, body: pack.layout }] : []),
      ...pack.creativeBriefs.map((c): NewAsset => ({ kind: "creative_brief", title: c.title, body: c })),
    ];
    await saveAssets(ctx.ws, { productId: p.id, storeId: p.storeId }, items, { createdBy: "agent:brand_designer", runId: ctx.runId });
    const taken = Object.values(domains).filter((d) => d === "taken").length;
    await ctx.progress(
      `Designed the brand for ${p.title}: ${pack.storeNames.length} store names${taken ? ` (${taken} domains already taken)` : ""}, ` +
        `${pack.identity ? "a brand kit, " : ""}${pack.layout ? "a store layout, " : ""}${pack.creativeBriefs.length} creative briefs`,
    );
    await finishLaunchIfDone(ctx.ws, p, ctx.runId);
  },
});
