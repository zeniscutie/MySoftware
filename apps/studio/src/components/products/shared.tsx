"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ProductStatus } from "@attentionos/module-dropship/repo";
import { Badge, cn, type BadgeTone } from "@/components/ui";
import { useToast } from "@/components/shell/toast";
import type { ProductActionResult } from "@/server/actions/products";

/** Pieces shared by the Products board and a product's page. */

export const STATUS: Record<ProductStatus, { label: string; tone: BadgeTone }> = {
  found: { label: "Found", tone: "neutral" },
  analyzing: { label: "Analysing", tone: "info" },
  needs_data: { label: "Needs data", tone: "warning" },
  auto_rejected: { label: "Didn't pass", tone: "neutral" },
  awaiting_approval: { label: "Waiting for you", tone: "brand" },
  approved: { label: "Ready to launch", tone: "success" },
  rejected: { label: "Rejected", tone: "neutral" },
  launching: { label: "Teams working", tone: "info" },
  live: { label: "Live", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  killed: { label: "Killed", tone: "danger" },
};

export function StatusBadge({ status }: { status: ProductStatus }) {
  const s = STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const CALL: Record<string, { label: string; tone: BadgeTone }> = {
  scale: { label: "Scale", tone: "success" },
  keep_testing: { label: "Keep testing", tone: "info" },
  kill: { label: "Kill", tone: "danger" },
  not_enough_data: { label: "Not enough data", tone: "neutral" },
};

export const usd = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "–" : `$${n.toFixed(2)}`);

/** A 0–100 bar. `invert` for scores where lower is better (saturation, risk). */
export function ScoreBar({ label, value, invert, hint }: { label: string; value: number; invert?: boolean; hint?: string }) {
  const good = invert ? 100 - value : value;
  const tone = good >= 65 ? "bg-success" : good >= 45 ? "bg-warning" : "bg-danger";
  return (
    <div className="min-w-0" title={hint}>
      <div className="flex items-baseline justify-between gap-2 text-caption text-fg-2">
        <span>{label}</span>
        <span className="tabular text-fg">{value}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

export function ScoreRing({ score }: { score: number | null }) {
  const v = score ?? 0;
  const tone = v >= 65 ? "text-success" : v >= 50 ? "text-warning" : "text-fg-3";
  return (
    <div className={cn("flex size-14 shrink-0 flex-col items-center justify-center rounded-full border-2 border-current", tone)} aria-label={`Score ${score ?? "not scored"} out of 100`}>
      <span className="text-h3 font-medium tabular text-fg">{score ?? "–"}</span>
    </div>
  );
}

/** Runs a server action with a pending state, a toast and a refresh. */
export function useAction() {
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const run = (fn: () => Promise<ProductActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast(r.message);
        after?.();
        router.refresh();
      } else toast(r.error, "error");
    });
  return { pending, run };
}

const SOURCE_LABEL: Record<string, string> = {
  tiktok_ads: "TikTok", meta_ads: "Meta ads", supplier: "Supplier", trends: "Trends", competitor_store: "Store", marketplace: "Marketplace", other: "Link",
};

/** Links to where the product was found. External pages: opened in a new tab, never fetched by Studio. */
export function SourceLinks({ sources, max = 4 }: { sources: { kind: string; url: string }[]; max?: number }) {
  if (!sources.length) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-caption">
      {sources.slice(0, max).map((s) => (
        <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="text-fg-2 underline decoration-border-strong underline-offset-4 hover:text-fg">
          {SOURCE_LABEL[s.kind] ?? "Link"}
        </a>
      ))}
      {sources.length > max ? <span className="text-fg-3">+{sources.length - max}</span> : null}
    </div>
  );
}
