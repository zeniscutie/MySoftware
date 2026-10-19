import { z } from "zod";
import { defineLlmJob, defineNativeJob } from "@attentionos/core";
import { nicheText, ownerContext, productBlock, rulesText, UNTRUSTED_NOTE } from "../context.ts";
import { addCandidate, enqueueRun, getProduct, listProducts, notify, saveAnalysis, setProductStatus } from "../repo.ts";
import { analystOutputSchema, jsonShape, readModelOutput, scoutOutputSchema } from "../schemas.ts";
import { scoreProduct } from "../scoring.ts";
import { dropshipSettings, effectiveRules } from "../settings.ts";

/**
 * Product research. Both jobs read the public web, so they get ONLY WebSearch and WebFetch: no workspace files, no
 * write tools. What they found comes back as JSON, is validated, and only then is saved by code.
 */

const SOURCE_HINTS: Record<string, string> = {
  tiktokAds: "TikTok ads and TikTok Shop: the TikTok Creative Center top ads and top products, and TikTok Shop best sellers",
  metaAds: "Meta ads: the Meta Ad Library (search product keywords, look for ads running several weeks with many variations)",
  suppliers: "Supplier sites: AliExpress, CJdropshipping and similar (trending listings, order counts, ratings, delivery times)",
  trends: "Trend signals: Google Trends, Reddit and other forums (is interest rising or fading?)",
  competitorStores: "Competitor stores: other Shopify stores selling trending products, and what they charge",
};

export const productHuntInput = z.object({
  /** Optional focus from the owner, e.g. "LED skincare tools". */
  focus: z.string().max(300).optional(),
  count: z.number().int().min(1).max(30).optional(),
});

export const productHuntJob = defineLlmJob({
  kind: "llm",
  id: "dropship.product-hunt",
  agent: "product_scout",
  description: "Searches ads, supplier sites and trends for products that fit your rules.",
  input: productHuntInput,
  skill: "product-hunt",
  allowedTools: ["WebSearch", "WebFetch"],
  defaultModel: "sonnet",
  maxTurns: 40,
  budgetUsd: 1.5,
  timeoutMs: 20 * 60_000,
  output: scoutOutputSchema,
  async prompt(ctx) {
    const s = dropshipSettings(ctx.ws);
    const count = ctx.input.count ?? s.hunt.perRun;
    const known = await listProducts(ctx.ws, { limit: 200 });
    const sources = Object.entries(s.sources).filter(([, on]) => on).map(([k]) => `- ${SOURCE_HINTS[k]}`);
    return [
      `Find up to ${count} new products this owner could dropship. Follow the product-hunt skill.`,
      "",
      "## The owner's rules (trusted)",
      rulesText(ctx.ws),
      `- Niches: ${nicheText(ctx.ws)}`,
      ctx.input.focus ? `- This hunt, the owner asks you to look at: ${ctx.input.focus}` : "",
      "",
      "## Where to look",
      ...sources,
      "",
      ownerContext(ctx.ws, ["products"]),
      "",
      "## Already on the board (skip these and close variants of them)",
      known.length ? known.map((p) => `- ${p.title}`).join("\n").slice(0, 4000) : "(nothing yet)",
      "",
      UNTRUSTED_NOTE,
      "Every source is a page you actually opened. Supplier numbers only from the supplier's own page, each with its sourceUrl. Leave out what you could not find; never guess a number.",
      "Your final message is the JSON, nothing else.",
      jsonShape(scoutOutputSchema),
    ].filter((l) => l !== "").join("\n");
  },
  async onOutput(ctx, output) {
    const s = dropshipSettings(ctx.ws);
    const { candidates } = readModelOutput(scoutOutputSchema, output);
    const cap = ctx.input.count ?? s.hunt.perRun;
    let added = 0;
    let again = 0;
    for (const c of candidates.slice(0, cap)) {
      const r = await addCandidate(ctx.ws, "agent:product_scout", c);
      if (r.created) added++;
      else again++;
    }
    await ctx.progress(`Found ${added} new product${added === 1 ? "" : "s"}${again ? ` (${again} already on the board)` : ""}`);
    if (added) await enqueueRun(ctx.ws, { jobId: "dropship.analyze-new", agent: "product_analyst", dedupeKey: "dropship-analyze-new", createdBy: "agent:product_scout" });
  },
});

export const analyzeProductInput = z.object({ productId: z.string().uuid() });

export const analyzeProductJob = defineLlmJob({
  kind: "llm",
  id: "dropship.analyze-product",
  agent: "product_analyst",
  description: "Checks one product's profit, saturation, viral potential and supplier risk.",
  input: analyzeProductInput,
  skill: "product-analysis",
  allowedTools: ["WebSearch", "WebFetch"],
  defaultModel: "sonnet",
  maxTurns: 40,
  budgetUsd: 1.2,
  timeoutMs: 15 * 60_000,
  output: analystOutputSchema,
  async gate(ctx) {
    const p = await getProduct(ctx.ws, ctx.input.productId);
    if (!p) return { stop: "That product is no longer on the board." };
    if (!["found", "analyzing", "needs_data"].includes(p.status)) return { stop: `${p.ref} was already ${p.status.replace("_", " ")}.` };
    return null;
  },
  async prompt(ctx) {
    const p = (await getProduct(ctx.ws, ctx.input.productId))!;
    await setProductStatus(ctx.ws, p.id, "analyzing");
    const r = effectiveRules(dropshipSettings(ctx.ws));
    return [
      `Analyse product ${p.ref} for this owner. Follow the product-analysis skill.`,
      "",
      "## The owner's rules (trusted)",
      rulesText(ctx.ws),
      "",
      ownerContext(ctx.ws, ["products"]),
      "",
      "## The product, as the scout found it",
      productBlock(p),
      "",
      UNTRUSTED_NOTE,
      "Work it out on the live web: open the supplier page, the ads and competing stores yourself.",
      `Suggest a selling price between $${r.minSellPrice} and $${r.maxSellPrice} that matches what competitors charge.`,
      "Every number needs the page it came from. Anything you could not confirm goes in gaps; never estimate a supplier cost.",
      "The code works out profit, saturation, viral and risk scores from your facts and judgments, so be honest and specific.",
      'If it isn\'t a real product you can source (dead links, no supplier), reply {"analysis": null, "skipReason": "..."}.',
      "Your final message is the JSON, nothing else.",
      jsonShape(analystOutputSchema),
    ].filter((l) => l !== "").join("\n");
  },
  async onOutput(ctx, output) {
    const p = await getProduct(ctx.ws, ctx.input.productId);
    if (!p) return;
    const parsed = readModelOutput(analystOutputSchema, output);
    if (!parsed.analysis) {
      await setProductStatus(ctx.ws, p.id, "auto_rejected", { note: parsed.skipReason ?? "The analyst could not source it." });
      await ctx.progress(`Set ${p.title} aside: ${parsed.skipReason ?? "could not source it"}`);
      return;
    }
    const settings = dropshipSettings(ctx.ws);
    const result = scoreProduct(parsed.analysis, settings, effectiveRules(settings));
    const saved = await saveAnalysis(ctx.ws, p, parsed.analysis, result, { runId: ctx.runId });
    if (saved.autoApproved) {
      await ctx.progress(`${p.title} scored ${result.scores.overall}/100 and was approved automatically; the launch teams are on it`);
      await notify(ctx.ws, {
        text: `Approved automatically: ${p.title} (${p.ref}), ${result.scores.overall}/100.\n${result.reasons.slice(0, 3).join("\n")}\nThe Ad Creator and Brand Designer are on it. Reply "kill ${p.ref}" to stop it.`,
        dedupeKey: `dropship-auto:${p.id}`,
      });
    } else if (saved.approvalRef) {
      await ctx.progress(`${p.title} scored ${result.scores.overall}/100 and is waiting for your OK (${saved.approvalRef})`);
      await notify(ctx.ws, {
        text: `New product for you: ${p.title} (${p.ref}), ${result.scores.overall}/100${result.verdict === "borderline" ? ", borderline" : ""}.\n${result.reasons.slice(0, 3).join("\n")}\nApprove or reject ${saved.approvalRef}.`,
        dedupeKey: `dropship-approval:${saved.approvalRef}`,
        ref: saved.approvalRef,
      });
    } else if (saved.status === "needs_data") {
      await ctx.progress(`${p.title} needs more data: ${result.gaps.slice(0, 2).join("; ")}`);
    } else {
      await ctx.progress(`Turned down ${p.title} (${result.scores.overall}/100): ${result.reasons[0]}`);
    }
  },
});

/** Hands every new product to the analyst, a few per run so a big hunt doesn't flood the queue. */
export const analyzeNewJob = defineNativeJob({
  kind: "native",
  id: "dropship.analyze-new",
  agent: "product_analyst",
  description: "Sends newly found products to the Product Analyst.",
  input: z.object({ limit: z.number().int().min(1).max(20).optional() }),
  async run(ctx) {
    const limit = ctx.input.limit ?? dropshipSettings(ctx.ws).hunt.analyzePerRun;
    // An analysis that died half way (status stuck on "analyzing" for hours) gets another go.
    const stale = ctx.ws.now().getTime() - 3 * 3_600_000;
    const fresh = (await listProducts(ctx.ws, { status: ["found", "analyzing"], limit: 200 }))
      .filter((p) => p.status === "found" || Date.parse(p.updatedAt) < stale)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit);
    let queued = 0;
    for (const p of fresh) {
      const id = await enqueueRun(ctx.ws, { jobId: "dropship.analyze-product", agent: "product_analyst", input: { productId: p.id }, dedupeKey: `dropship-analyze:${p.id}`, createdBy: "agent:product_analyst" });
      if (id) queued++;
    }
    if (queued) await ctx.progress(`Started analysing ${queued} product${queued === 1 ? "" : "s"}`);
    return { queued };
  },
});
