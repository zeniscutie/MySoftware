"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Check, CircleAlert, Copy, X } from "lucide-react";
import type { AssetView, ProductDetail } from "@/server/queries/products";
import {
  assignStoreAction, createStoreFromProductAction, decideProductAction, reanalyzeAction, relaunchAction, setAssetStatusAction, setProductStatusAction,
} from "@/server/actions/products";
import { Badge, Button, Card, Select, cn } from "@/components/ui";
import { PageHeader, SectionTitle } from "@/components/shell/page-header";
import { EmptyState, Facts } from "@/components/content/shared";
import { useToast } from "@/components/shell/toast";
import { CALL, ScoreBar, ScoreRing, SourceLinks, StatusBadge, useAction, usd } from "./shared";

type Tab = "analysis" | "ads" | "posts" | "brand";

const str = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
const arr = <T,>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);

function CopyButton({ text }: { text: string }) {
  const toast = useToast();
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => navigator.clipboard.writeText(text).then(() => toast("Copied"), () => toast("Couldn't copy", "error"))}
      title="Copy"
    >
      <Copy className="size-3.5" strokeWidth={1.75} />
    </Button>
  );
}

function AssetActions({ a }: { a: AssetView }) {
  const { pending, run } = useAction();
  return (
    <div className="flex items-center gap-1">
      {a.status !== "draft" ? <Badge tone={a.status === "approved" ? "success" : a.status === "used" ? "info" : "neutral"}>{a.status}</Badge> : null}
      <Button variant="ghost" size="sm" disabled={pending} title="Keep" onClick={() => run(() => setAssetStatusAction(a.id, a.status === "approved" ? "draft" : "approved"))}>
        <Check className="size-3.5" strokeWidth={1.75} />
      </Button>
      <Button variant="ghost" size="sm" disabled={pending} title="Drop" onClick={() => run(() => setAssetStatusAction(a.id, a.status === "rejected" ? "draft" : "rejected"))}>
        <X className="size-3.5" strokeWidth={1.75} />
      </Button>
    </div>
  );
}

function Problems({ problems }: { problems: string[] }) {
  if (!problems.length) return null;
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {problems.map((p) => (
        <li key={p} className="flex items-center gap-1.5 text-caption text-danger">
          <CircleAlert className="size-3.5 shrink-0" strokeWidth={1.75} />
          {p}
        </li>
      ))}
    </ul>
  );
}

function AssetCard({ a, children, copy }: { a: AssetView; children: React.ReactNode; copy?: string }) {
  return (
    <Card className={cn("flex flex-col gap-3", a.status === "rejected" && "opacity-60")}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-h3 font-medium text-fg">{a.title}</h3>
        <div className="flex items-center">
          {copy ? <CopyButton text={copy} /> : null}
          <AssetActions a={a} />
        </div>
      </div>
      {children}
      <Problems problems={a.problems} />
    </Card>
  );
}

function Script({ a }: { a: AssetView }) {
  const b = a.body;
  const hooks = arr<string>(b.hooks);
  const beats = arr<{ say: string; show: string }>(b.beats);
  const text = [`Hooks:\n${hooks.map((h, i) => `${i + 1}. ${h}`).join("\n")}`, ...beats.map((x) => `SAY: ${x.say}\nSHOW: ${x.show}`), `CTA: ${str(b.cta)}`].join("\n\n");
  return (
    <AssetCard a={a} copy={text}>
      <div className="flex flex-wrap gap-2 text-caption text-fg-2">
        <Badge>{str(b.format).replace(/_/g, " ")}</Badge>
        <span>{str(b.lengthSeconds)}s</span>
        <span>· {str(b.angle)}</span>
      </div>
      <div>
        <div className="text-caption text-fg-3">Hooks to test</div>
        <ol className="mt-1 flex list-decimal flex-col gap-1 pl-5 text-small text-fg">
          {hooks.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ol>
      </div>
      <ol className="flex flex-col gap-2">
        {beats.map((x, i) => (
          <li key={i} className="grid grid-cols-1 gap-1 rounded-md bg-surface-2 p-2.5 text-small sm:grid-cols-2 sm:gap-3">
            <span className="text-fg">{x.say}</span>
            <span className="text-fg-2">{x.show}</span>
          </li>
        ))}
      </ol>
      {arr<string>(b.onScreenText).length ? <p className="text-caption text-fg-2">On screen: {arr<string>(b.onScreenText).join(" · ")}</p> : null}
      <p className="text-small text-fg-2">Call to action: {str(b.cta)}</p>
    </AssetCard>
  );
}

function AdCopy({ a }: { a: AssetView }) {
  const b = a.body;
  return (
    <AssetCard a={a} copy={`${str(b.primaryText)}\n\nHeadline: ${str(b.headline)}${b.description ? `\nDescription: ${str(b.description)}` : ""}`}>
      <p className="whitespace-pre-wrap text-small text-fg">{str(b.primaryText)}</p>
      <Facts
        items={[
          { label: "Headline", value: str(b.headline) },
          ...(b.description ? [{ label: "Description", value: str(b.description) }] : []),
          { label: "Button", value: str(b.cta).replace(/_/g, " ") },
          { label: "Angle", value: str(b.angle) },
        ]}
      />
    </AssetCard>
  );
}

function Post({ a }: { a: AssetView }) {
  const b = a.body;
  const tags = arr<string>(b.hashtags).map((t) => (t.startsWith("#") ? t : `#${t}`));
  return (
    <AssetCard a={a} copy={`${str(b.caption)}\n\n${tags.join(" ")}`}>
      <div className="flex flex-wrap gap-2 text-caption text-fg-2">
        <Badge>Day {str(b.day)}</Badge>
        <Badge>{str(b.platform)}</Badge>
        <Badge>{str(b.format).replace(/_/g, " ")}</Badge>
      </div>
      <p className="whitespace-pre-wrap text-small text-fg">{str(b.caption)}</p>
      {tags.length ? <p className="text-caption text-fg-2">{tags.join(" ")}</p> : null}
      {arr<string>(b.shotList).length ? (
        <ul className="list-disc pl-5 text-small text-fg-2">
          {arr<string>(b.shotList).map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      ) : null}
    </AssetCard>
  );
}

function Sections({ title, items }: { title: string; items: { section: string; content: string }[] }) {
  return (
    <div>
      <div className="text-caption text-fg-3">{title}</div>
      <ol className="mt-1 flex flex-col gap-1.5">
        {items.map((s, i) => (
          <li key={i} className="text-small">
            <span className="font-medium text-fg">{s.section}</span> <span className="text-fg-2">· {s.content}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function BrandTab({ d }: { d: ProductDetail }) {
  const names = d.assets.filter((a) => a.kind === "store_name");
  const identity = d.assets.find((a) => a.kind === "brand_identity");
  const layout = d.assets.find((a) => a.kind === "store_layout");
  const plan = d.assets.find((a) => a.kind === "store_plan");
  const briefs = d.assets.filter((a) => a.kind === "creative_brief");
  const [nameId, setNameId] = useState(names[0]?.id ?? "");
  const [storeRef, setStoreRef] = useState(d.store?.ref ?? "");
  const recommended = str(plan?.body.recommended);
  const [kind, setKind] = useState<"single_product" | "niche" | "general">(recommended === "niche" ? "niche" : "single_product");
  const { pending, run } = useAction();

  if (!names.length && !identity && !layout && !briefs.length) {
    return <EmptyState title="No brand kit yet" body="The Brand Designer makes store names, a brand identity, a layout and creative briefs once the product is approved." />;
  }
  return (
    <div className="flex flex-col gap-6">
      {plan ? (
        <Card signal>
          <div className="text-caption text-fg-3">Store plan</div>
          <div className="mt-1 text-h3 font-medium text-fg">{plan.title}</div>
          <p className="mt-1 text-small text-fg-2">{str(plan.body.reason)}</p>
        </Card>
      ) : null}

      <Card className="flex flex-col gap-3">
        <h3 className="text-h3 font-medium text-fg">Store</h3>
        {d.store ? <p className="text-small text-fg-2">This product is in {d.store.name} ({d.store.ref}).</p> : <p className="text-small text-fg-2">Not in a store yet. Create one from a name below, or add it to one you have.</p>}
        {names.length ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => createStoreFromProductAction(d.card.ref, { nameAssetId: nameId, identityAssetId: identity?.id, kind, niche: str(plan?.body.nicheName) || undefined }));
            }}
          >
            <label className="flex flex-col gap-1 text-caption text-fg-3">
              Name
              <Select value={nameId} onChange={(e) => setNameId(e.target.value)} className="w-56">
                {names.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title} ({str(n.body.domainIdea)})
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-caption text-fg-3">
              Kind
              <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="w-48">
                <option value="single_product">One-product store</option>
                <option value="niche">Niche store</option>
                <option value="general">General store</option>
              </Select>
            </label>
            <Button type="submit" variant="primary" disabled={pending || !nameId}>
              Create store
            </Button>
          </form>
        ) : null}
        {d.stores.length ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-caption text-fg-3">
              Or add to
              <Select value={storeRef} onChange={(e) => setStoreRef(e.target.value)} className="w-56">
                <option value="">No store</option>
                {d.stores.map((s) => (
                  <option key={s.ref} value={s.ref}>
                    {s.name} ({s.ref})
                  </option>
                ))}
              </Select>
            </label>
            <Button disabled={pending} onClick={() => run(() => assignStoreAction(d.card.ref, storeRef || null))}>
              Save
            </Button>
          </div>
        ) : null}
      </Card>

      {names.length ? (
        <section>
          <SectionTitle count={names.length}>Store names</SectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {names.map((n) => {
              const status = str(n.body.domainStatus);
              return (
                <AssetCard key={n.id} a={n}>
                  <div className="flex flex-wrap items-center gap-2 text-small">
                    <span className="text-fg-2">{str(n.body.domainIdea)}</span>
                    {status === "taken" ? <Badge tone="danger">Domain taken</Badge> : status === "maybe_free" ? <Badge tone="success">Maybe free</Badge> : null}
                    <Badge>{str(n.body.style)}</Badge>
                  </div>
                  <p className="text-small text-fg-2">{str(n.body.why)}</p>
                </AssetCard>
              );
            })}
          </div>
          <p className="mt-2 text-caption text-fg-3">"Maybe free" means the domain has no DNS yet. Check it at a registrar before you buy.</p>
        </section>
      ) : null}

      {identity ? (
        <AssetCard a={identity}>
          <p className="text-small text-fg-2">{str(identity.body.voice)}</p>
          <div className="flex flex-wrap gap-3">
            {arr<{ name: string; hex: string; use: string }>(identity.body.palette).map((c) => (
              <div key={c.hex + c.name} className="flex items-center gap-2">
                <span className="size-8 rounded-md border border-border" style={{ background: c.hex }} />
                <span className="text-caption">
                  <span className="block text-fg">{c.name}</span>
                  <span className="text-fg-3">
                    {c.hex} · {c.use}
                  </span>
                </span>
              </div>
            ))}
          </div>
          {identity.body.fonts ? (
            <p className="text-small text-fg-2">
              Fonts: {str((identity.body.fonts as Record<string, unknown>).heading)} for headings, {str((identity.body.fonts as Record<string, unknown>).body)} for text.{" "}
              {str((identity.body.fonts as Record<string, unknown>).why)}
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            <div className="text-caption text-fg-3">Logo concepts</div>
            {arr<{ name: string; description: string; imagePrompt: string }>(identity.body.logoConcepts).map((l) => (
              <div key={l.name} className="rounded-md bg-surface-2 p-3 text-small">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-fg">{l.name}</span>
                  <CopyButton text={l.imagePrompt} />
                </div>
                <p className="text-fg-2">{l.description}</p>
                <p className="mt-1 text-caption text-fg-3">Image prompt: {l.imagePrompt}</p>
              </div>
            ))}
          </div>
        </AssetCard>
      ) : null}

      {layout ? (
        <AssetCard a={layout}>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Sections title="Homepage" items={arr(layout.body.homepage)} />
            <Sections title="Product page" items={arr(layout.body.productPage)} />
          </div>
          {arr<string>(layout.body.trustElements).length ? <p className="text-small text-fg-2">Trust: {arr<string>(layout.body.trustElements).join(" · ")}</p> : null}
          {arr<string>(layout.body.pages).length ? <p className="text-small text-fg-2">Pages: {arr<string>(layout.body.pages).join(" · ")}</p> : null}
        </AssetCard>
      ) : null}

      {briefs.length ? (
        <section>
          <SectionTitle count={briefs.length}>Creative briefs</SectionTitle>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {briefs.map((b) => (
              <AssetCard key={b.id} a={b} copy={[str(b.body.concept), ...arr<string>(b.body.shots), str(b.body.imagePrompt)].filter(Boolean).join("\n")}>
                <Badge>{str(b.body.format).replace(/_/g, " ")}</Badge>
                <p className="text-small text-fg">{str(b.body.concept)}</p>
                {arr<string>(b.body.shots).length ? (
                  <ul className="list-disc pl-5 text-small text-fg-2">
                    {arr<string>(b.body.shots).map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                ) : null}
                {b.body.textOverlay ? <p className="text-caption text-fg-2">Text: {str(b.body.textOverlay)}</p> : null}
                {b.body.imagePrompt ? <p className="text-caption text-fg-3">Image prompt: {str(b.body.imagePrompt)}</p> : null}
              </AssetCard>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function AnalysisTab({ d }: { d: ProductDetail }) {
  const a = d.analysis;
  const c = d.card;
  const { pending, run } = useAction();
  if (!a) {
    return (
      <EmptyState
        title={c.status === "analyzing" ? "Being analysed" : "Not analysed yet"}
        body={c.decisionNote ?? "The Product Analyst checks supplier cost, competitor prices, saturation, viral potential and risk, then scores it against your rules."}
        action={
          ["found", "needs_data", "auto_rejected", "rejected"].includes(c.status) ? (
            <Button disabled={pending} onClick={() => run(() => reanalyzeAction(c.ref))}>
              Analyse now
            </Button>
          ) : undefined
        }
      />
    );
  }
  const sup = a.supplier ?? {};
  const cost = sup.cost as { value: number; sourceUrl: string } | undefined;
  const ship = sup.shippingCost as { value: number; sourceUrl: string } | undefined;
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex flex-col gap-6">
        {a.summary ? (
          <Card>
            <p className="text-body text-fg">{a.summary}</p>
            {a.audience ? <p className="mt-2 text-small text-fg-2">Who buys it: {a.audience}</p> : null}
          </Card>
        ) : null}
        <section>
          <SectionTitle>Your rules</SectionTitle>
          <Card padded={false} className="px-4">
            <ul>
              {d.gates.map((g) => (
                <li key={g.rule} className="flex items-start gap-2 border-b border-border py-2.5 text-small last:border-b-0">
                  {g.ok ? <Check className="mt-0.5 size-4 shrink-0 text-success" strokeWidth={1.75} /> : <X className="mt-0.5 size-4 shrink-0 text-danger" strokeWidth={1.75} />}
                  <span className={g.ok ? "text-fg" : "text-danger"}>{g.detail}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
        {a.risks.length ? (
          <section>
            <SectionTitle>Risks</SectionTitle>
            <ul className="flex flex-col gap-2">
              {a.risks.map((r) => (
                <li key={r.flag} className="flex items-start gap-2 text-small">
                  <Badge tone={r.severity === "high" ? "danger" : r.severity === "medium" ? "warning" : "neutral"}>{r.severity}</Badge>
                  <span className="text-fg">
                    {r.flag.replace(/_/g, " ")}: <span className="text-fg-2">{r.why}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {c.gaps.length ? (
          <section>
            <SectionTitle>Couldn't confirm</SectionTitle>
            <ul className="list-disc pl-5 text-small text-warning">
              {c.gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      <div className="flex flex-col gap-6">
        {c.scores ? (
          <Card className="flex flex-col gap-3">
            <ScoreBar label="Profit" value={c.scores.profit} />
            <ScoreBar label="Saturation (lower is better)" value={c.scores.saturation} invert />
            <ScoreBar label="Viral potential" value={c.scores.viral} />
            <ScoreBar label="Risk (lower is better)" value={c.scores.risk} invert />
          </Card>
        ) : null}
        {c.profit ? (
          <Card>
            <Facts
              items={[
                { label: "Product", value: cost ? <a href={cost.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="underline decoration-border-strong underline-offset-4">{usd(cost.value)}</a> : "–" },
                { label: "Shipping", value: ship ? usd(ship.value) : usd(0) },
                { label: "Fees", value: usd(c.profit.paymentFees) },
                { label: "Sell at", value: usd(c.profit.sellPrice) },
                { label: "Profit per sale", value: usd(c.profit.grossProfit) },
                { label: "Margin", value: `${Math.round(c.profit.grossMargin * 100)}% (${c.profit.markup}x)` },
                { label: "Max ad cost/sale", value: usd(c.profit.breakEvenCpa) },
                { label: "Break-even ROAS", value: Number.isFinite(c.profit.breakEvenRoas) ? String(c.profit.breakEvenRoas) : "–" },
              ]}
            />
            {a.priceReason ? <p className="mt-3 text-caption text-fg-2">{a.priceReason}</p> : null}
          </Card>
        ) : null}
        <Card>
          <Facts
            items={[
              { label: "Delivery", value: sup.shippingDaysMax !== undefined ? `${str(sup.shippingDaysMin) || "?"}–${str(sup.shippingDaysMax)} days` : "–" },
              { label: "Supplier rating", value: sup.rating !== undefined ? `${str(sup.rating)}/5` : "–" },
              { label: "Orders filled", value: sup.orders !== undefined ? str(sup.orders) : "–" },
              { label: "Advertisers", value: str(a.saturation?.activeAds) || "–" },
              { label: "Stores selling", value: str(a.saturation?.competingStores) || "–" },
              { label: "Trend", value: str(a.saturation?.trendDirection) || "–" },
            ]}
          />
        </Card>
        <Card>
          <div className="mb-2 text-caption text-fg-3">Sources</div>
          <SourceLinks sources={[...c.sources, ...a.research.filter((r) => !c.sources.some((s) => s.url === r.url))]} max={12} />
        </Card>
      </div>
    </div>
  );
}

export function ProductDetailView({ d }: { d: ProductDetail }) {
  const c = d.card;
  const [tab, setTab] = useState<Tab>(["launching", "approved", "live", "paused"].includes(c.status) ? "ads" : "analysis");
  const { pending, run } = useAction();
  const ads = d.assets.filter((a) => a.kind === "ad_script" || a.kind === "ad_copy" || a.kind === "angle");
  const posts = d.assets.filter((a) => a.kind === "organic_post").sort((a, b) => Number(a.body.day) - Number(b.body.day));
  const brandCount = d.assets.filter((a) => ["store_name", "brand_identity", "store_layout", "creative_brief"].includes(a.kind)).length;
  const approved = ["approved", "launching", "live", "paused"].includes(c.status);
  const working = (job: string) => d.busy.includes(job);

  return (
    <div className="flex flex-col gap-8">
      <Link href="/products" className="flex items-center gap-1.5 text-small text-fg-2 hover:text-fg">
        <ArrowLeft className="size-4" strokeWidth={1.5} />
        Products
      </Link>
      <PageHeader
        meta={
          <span className="flex flex-wrap items-center gap-2">
            {c.ref} <StatusBadge status={c.status} /> {c.niche ? <Badge>{c.niche}</Badge> : null}
          </span>
        }
        title={
          <span className="flex items-center gap-4">
            <ScoreRing score={c.score} />
            {c.title}
          </span>
        }
        description={c.pitch ?? undefined}
        actions={
          c.status === "awaiting_approval" ? (
            <>
              <Button variant="ghost" disabled={pending} onClick={() => run(() => decideProductAction(c.ref, "rejected"))}>
                Reject
              </Button>
              <Button variant="primary" disabled={pending} onClick={() => run(() => decideProductAction(c.ref, "approved"))}>
                Approve and launch
              </Button>
            </>
          ) : approved ? (
            <>
              {c.status !== "live" ? (
                <Button variant="primary" disabled={pending} onClick={() => run(() => setProductStatusAction(c.ref, "live"))}>
                  Mark live
                </Button>
              ) : (
                <Button disabled={pending} onClick={() => run(() => setProductStatusAction(c.ref, "paused"))}>
                  Pause
                </Button>
              )}
              <Button variant="danger" disabled={pending} onClick={() => run(() => setProductStatusAction(c.ref, "killed"))}>
                Kill
              </Button>
            </>
          ) : undefined
        }
      />

      {d.performance ? (
        <Card className="flex flex-wrap items-center gap-x-8 gap-y-2 text-small">
          <span>
            <span className="text-fg-3">Revenue </span>
            <span className="tabular">{usd(d.performance.revenue > 0 ? d.performance.revenue : d.performance.purchaseValue)}</span>
          </span>
          <span>
            <span className="text-fg-3">Spend </span>
            <span className="tabular">{usd(d.performance.spend)}</span>
          </span>
          <span>
            <span className="text-fg-3">ROAS </span>
            <span className="tabular">{d.performance.roas ?? "–"}</span>
            <span className="text-fg-3"> vs {d.performance.breakEvenRoas ?? "–"} break-even</span>
          </span>
          <span>
            <span className="text-fg-3">Net </span>
            <span className="tabular">{usd(d.performance.netProfit)}</span>
          </span>
          <Badge tone={CALL[d.performance.call]?.tone ?? "neutral"}>{CALL[d.performance.call]?.label}</Badge>
          <span className="text-fg-2">{d.performance.why}</span>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
        <div role="tablist" className="flex gap-1">
          {(
            [
              ["analysis", "Analysis"],
              ["ads", `Ads${ads.length ? ` (${ads.length})` : ""}`],
              ["posts", `Posts${posts.length ? ` (${posts.length})` : ""}`],
              ["brand", `Brand${brandCount ? ` (${brandCount})` : ""}`],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn("-mb-px border-b-2 px-3 py-2 text-small transition-colors", tab === k ? "border-brand text-fg" : "border-transparent text-fg-2 hover:text-fg")}
            >
              {label}
            </button>
          ))}
        </div>
        {approved ? (
          <div className="flex gap-2 pb-2">
            {tab === "ads" || tab === "posts" ? (
              <Button size="sm" disabled={pending || working("dropship.content-pack")} onClick={() => run(() => relaunchAction(c.ref, "content"))}>
                {working("dropship.content-pack") ? "Ad Creator is writing" : "New ads and posts"}
              </Button>
            ) : null}
            {tab === "brand" ? (
              <Button size="sm" disabled={pending || working("dropship.brand-pack")} onClick={() => run(() => relaunchAction(c.ref, "brand"))}>
                {working("dropship.brand-pack") ? "Brand Designer is working" : "New brand kit"}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {tab === "analysis" ? <AnalysisTab d={d} /> : null}
      {tab === "ads" ? (
        ads.length ? (
          <div className="flex flex-col gap-6">
            {ads.some((a) => a.kind === "angle") ? (
              <section>
                <SectionTitle>Angles</SectionTitle>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {ads
                    .filter((a) => a.kind === "angle")
                    .map((a) => (
                      <Card key={a.id} className="flex flex-col gap-1 text-small">
                        <span className="font-medium text-fg">{a.title}</span>
                        <span className="text-fg-2">For: {str(a.body.audience)}</span>
                        <span className="text-fg-2">Pain: {str(a.body.pain)}</span>
                        <span className="text-fg-2">Promise: {str(a.body.promise)}</span>
                      </Card>
                    ))}
                </div>
              </section>
            ) : null}
            <section>
              <SectionTitle>Video ad scripts</SectionTitle>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {ads
                  .filter((a) => a.kind === "ad_script")
                  .map((a) => (
                    <Script key={a.id} a={a} />
                  ))}
              </div>
            </section>
            <section>
              <SectionTitle>Ad copy</SectionTitle>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
                {ads
                  .filter((a) => a.kind === "ad_copy")
                  .map((a) => (
                    <AdCopy key={a.id} a={a} />
                  ))}
              </div>
            </section>
          </div>
        ) : (
          <EmptyState title={working("dropship.content-pack") ? "The Ad Creator is writing" : "No ads yet"} body="Approve the product and the Ad Creator writes video ad scripts with hooks to test, and ad copy for Meta and TikTok." />
        )
      ) : null}
      {tab === "posts" ? (
        posts.length ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {posts.map((a) => (
              <Post key={a.id} a={a} />
            ))}
          </div>
        ) : (
          <EmptyState title="No posts yet" body="The Ad Creator plans organic posts for TikTok, Instagram and YouTube once the product is approved." />
        )
      ) : null}
      {tab === "brand" ? <BrandTab d={d} /> : null}
    </div>
  );
}
