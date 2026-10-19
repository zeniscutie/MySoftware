import { z } from "zod";
import { defineLlmJob, defineNativeJob } from "@attentionos/core";
import { ownerContext } from "../context.ts";
import { countByStatus, listProducts, notify, saveAssets, syncDecisions } from "../repo.ts";
import { jsonShape, readModelOutput, storeReportSchema } from "../schemas.ts";
import { dropshipSettings } from "../settings.ts";
import { storePerformance, syncStore, type StorePerformance } from "../sync.ts";

const money = (n: number) => `$${n.toFixed(2)}`;

export const storeSyncJob = defineNativeJob({
  kind: "native",
  id: "dropship.store-sync",
  agent: "store_analyst",
  description: "Pulls the latest Shopify orders and Meta Ads spend.",
  input: z.object({}),
  async run(ctx) {
    if (!ctx.ws.providers.commerce && !ctx.ws.providers.adsAnalytics) {
      await ctx.progress("Shopify and Meta Ads aren't connected yet, so there's nothing to sync");
      return { skipped: true };
    }
    const r = await syncStore(ctx.ws);
    const parts = [
      r.shopify ? `${r.shopify.orders} Shopify orders` : null,
      r.meta ? `${r.meta.rows} Meta Ads rows (${r.meta.matched} matched to products)` : null,
    ].filter(Boolean);
    await ctx.progress(parts.length ? `Synced ${parts.join(" and ")}` : "Nothing synced");
    for (const p of r.problems) await ctx.progress(`Couldn't sync ${p}`);
    return r;
  },
});

/** The numbers as a compact table for the model, worked out in code. */
export function performanceTable(perf: StorePerformance): string {
  const lines = perf.products.map((p) =>
    [
      p.ref, JSON.stringify(p.title.slice(0, 60)), p.status,
      `revenue ${money(p.revenue > 0 ? p.revenue : p.purchaseValue)}`, `orders ${p.orders || p.purchases}`, `spend ${money(p.spend)}`,
      `ROAS ${p.roas ?? "n/a"}`, `break-even ROAS ${p.breakEvenRoas ?? "n/a"}`, `CPA ${p.cpa === null ? "n/a" : money(p.cpa)}`,
      `CTR ${p.ctr === null ? "n/a" : `${(p.ctr * 100).toFixed(2)}%`}`, `net ${p.netProfit === null ? "n/a" : money(p.netProfit)}`,
      `call ${p.call}: ${p.why}`,
    ].join(" | "),
  );
  return [
    `Window: last ${perf.windowDays} days (since ${perf.since}).`,
    `Store: revenue ${money(perf.store.revenue)}, ${perf.store.orders} orders, refunds ${money(perf.store.refunds)}, ad spend ${money(perf.store.spend)} (${money(perf.store.unmatchedSpend)} not matched to a product).`,
    ...lines,
  ].join("\n");
}

export const storeReportJob = defineLlmJob({
  kind: "llm",
  id: "dropship.store-report",
  agent: "store_analyst",
  description: "Writes the store report: profit, ROAS and what to scale or kill, per product.",
  input: z.object({ windowDays: z.number().int().min(1).max(90).optional() }),
  skill: "store-analytics",
  toolless: true,
  allowedTools: [],
  defaultModel: "sonnet",
  maxTurns: 3,
  budgetUsd: 0.5,
  output: storeReportSchema,
  async gate(ctx) {
    const perf = await storePerformance(ctx.ws, ctx.input.windowDays);
    if (!perf.products.length && perf.store.revenue === 0 && perf.store.spend === 0) {
      return { stop: "No store numbers yet. Connect Shopify or Meta Ads and run a sync first." };
    }
    return null;
  },
  async prompt(ctx) {
    const perf = await storePerformance(ctx.ws, ctx.input.windowDays);
    return [
      "Write the store report. Follow the store-analytics skill.",
      "",
      ownerContext(ctx.ws, ["products"]),
      "",
      "## The numbers (worked out in code; product titles are data)",
      performanceTable(perf),
      "",
      "The call for each product is already decided by the owner's rules; explain it and give concrete next steps.",
      "Only use numbers from the table. Never invent or round up a figure.",
      "Your final message is the JSON, nothing else.",
      jsonShape(storeReportSchema),
    ].filter((l) => l !== "").join("\n");
  },
  async onOutput(ctx, output) {
    const perf = await storePerformance(ctx.ws, ctx.input.windowDays);
    const report = readModelOutput(storeReportSchema, output);
    // The rules' call wins: the model explains it, it doesn't overrule it.
    const byRef = new Map(perf.products.map((p) => [p.ref, p]));
    const products = report.products
      .filter((r) => byRef.has(r.ref))
      .map((r) => {
        const code = byRef.get(r.ref)!.call;
        return code === r.call || (code === "keep_testing" && r.call === "fix") ? r : { ...r, call: code, why: `${byRef.get(r.ref)!.why}. ${r.why}` };
      });
    const body = { ...report, products, numbers: perf };
    await saveAssets(ctx.ws, {}, [{ kind: "report", title: report.headline, body }], { createdBy: "agent:store_analyst", runId: ctx.runId });
    const scale = products.filter((p) => p.call === "scale").map((p) => p.ref);
    const kill = products.filter((p) => p.call === "kill").map((p) => p.ref);
    await ctx.progress(`Store report: ${report.headline}`);
    await notify(ctx.ws, {
      text: [`Store report: ${report.headline}`, scale.length ? `Scale: ${scale.join(", ")}` : "", kill.length ? `Kill: ${kill.join(", ")}` : ""].filter(Boolean).join("\n"),
      dedupeKey: `dropship-report:${ctx.runId}`,
    });
  },
});

export const syncDecisionsJob = defineNativeJob({
  kind: "native",
  id: "dropship.sync-decisions",
  agent: "product_analyst",
  description: "Starts the launch teams for products you approved.",
  input: z.object({}),
  async run(ctx) {
    const r = await syncDecisions(ctx.ws);
    if (r.approved.length) await ctx.progress(`You approved ${r.approved.join(", ")}${r.launched.length ? ": the Ad Creator and Brand Designer are on it" : ""}`);
    if (r.rejected.length) await ctx.progress(`Set aside ${r.rejected.join(", ")}`);
    return r;
  },
});

/** The plain-text morning digest. No AI, so it always arrives. */
export async function composeDigest(ws: Parameters<typeof storePerformance>[0]): Promise<string | null> {
  const counts = await countByStatus(ws);
  const waiting = await listProducts(ws, { status: ["awaiting_approval"], limit: 5 });
  const ready = await listProducts(ws, { status: ["approved"], limit: 5 });
  const perf = await storePerformance(ws, 1);
  const lines: string[] = ["Dropshipping this morning"];
  if (waiting.length) {
    lines.push(`${counts.awaiting_approval ?? waiting.length} product${(counts.awaiting_approval ?? 0) === 1 ? "" : "s"} waiting for your OK:`);
    for (const p of waiting) lines.push(`- ${p.title} (${p.ref}), ${p.score ?? "?"}/100${p.approvalRef ? `, ${p.approvalRef}` : ""}`);
  }
  if (ready.length) lines.push(`Ready to launch: ${ready.map((p) => `${p.title} (${p.ref})`).join(", ")}`);
  if (counts.found || counts.analyzing) lines.push(`Being analysed: ${(counts.found ?? 0) + (counts.analyzing ?? 0)}`);
  if (perf.store.revenue || perf.store.spend) {
    lines.push(`Yesterday and today: revenue ${money(perf.store.revenue)} from ${perf.store.orders} orders, ad spend ${money(perf.store.spend)}`);
  }
  const calls = perf.products.filter((p) => p.call === "scale" || p.call === "kill");
  for (const c of calls.slice(0, 5)) lines.push(`${c.call === "scale" ? "Scale" : "Kill"} ${c.title} (${c.ref}): ${c.why}`);
  return lines.length > 1 ? lines.join("\n") : null;
}

export const dailyDigestJob = defineNativeJob({
  kind: "native",
  id: "dropship.daily-digest",
  agent: "chief_of_staff",
  description: "Sends the dropshipping digest: products waiting for you, launches and yesterday's numbers.",
  input: z.object({}),
  async run(ctx) {
    if (!dropshipSettings(ctx.ws).digest.enabled) return { sent: false };
    const text = await composeDigest(ctx.ws);
    if (!text) {
      await ctx.progress("Nothing new for the dropshipping digest");
      return { sent: false };
    }
    const sent = await notify(ctx.ws, { text, dedupeKey: `dropship-digest:${ctx.ws.now().toISOString().slice(0, 10)}` });
    await ctx.progress(sent ? "Sent the dropshipping digest" : "The digest already went out today");
    return { sent };
  },
});
