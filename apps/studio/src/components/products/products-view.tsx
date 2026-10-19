"use client";
import Link from "next/link";
import { useState } from "react";
import { Check, RefreshCw, Search, X } from "lucide-react";
import type { ProductCard, ProductsData } from "@/server/queries/products";
import { decideProductAction, huntAction, reanalyzeAction, syncStoreAction } from "@/server/actions/products";
import { Badge, Button, Card, Input, MetricCard, Textarea, cn } from "@/components/ui";
import { PageHeader, SectionTitle } from "@/components/shell/page-header";
import { EmptyState } from "@/components/content/shared";
import { CALL, ScoreBar, ScoreRing, SourceLinks, StatusBadge, useAction, usd } from "./shared";

function HuntBar() {
  const [focus, setFocus] = useState("");
  const { pending, run } = useAction();
  return (
    <form
      className="flex w-full max-w-md items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => huntAction(focus), () => setFocus(""));
      }}
    >
      <Input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Optional focus, e.g. LED skincare" maxLength={300} aria-label="What to hunt for" />
      <Button type="submit" variant="primary" disabled={pending}>
        <Search className="size-4" strokeWidth={1.75} />
        {pending ? "Starting" : "Find products"}
      </Button>
    </form>
  );
}

/** A product waiting for the owner: the numbers that matter, the reasons, and approve or reject. */
function DecisionCard({ p }: { p: ProductCard }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const { pending, run } = useAction();
  return (
    <Card signal className="flex flex-col gap-4">
      <div className="flex items-start gap-4">
        <ScoreRing score={p.score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/products/${p.ref}`} className="text-h3 font-medium text-fg hover:underline">
              {p.title}
            </Link>
            {p.verdict === "borderline" ? <Badge tone="warning">Borderline</Badge> : <Badge tone="success">Strong pick</Badge>}
            {p.niche ? <Badge>{p.niche}</Badge> : null}
          </div>
          {p.pitch ? <p className="mt-1 text-small text-fg-2">{p.pitch}</p> : null}
        </div>
      </div>

      {p.profit ? (
        <dl className="grid grid-cols-2 gap-3 rounded-md bg-surface-2 p-3 text-small sm:grid-cols-4">
          <div>
            <dt className="text-caption text-fg-3">Sell at</dt>
            <dd className="tabular text-fg">{usd(p.profit.sellPrice)}</dd>
          </div>
          <div>
            <dt className="text-caption text-fg-3">Landed cost</dt>
            <dd className="tabular text-fg">
              {usd(p.profit.landedCost)} <span className="text-fg-3">({p.profit.markup}x)</span>
            </dd>
          </div>
          <div>
            <dt className="text-caption text-fg-3">Profit per sale</dt>
            <dd className="tabular text-fg">{usd(p.profit.grossProfit)}</dd>
          </div>
          <div>
            <dt className="text-caption text-fg-3">Break-even ROAS</dt>
            <dd className="tabular text-fg">{Number.isFinite(p.profit.breakEvenRoas) ? p.profit.breakEvenRoas : "–"}</dd>
          </div>
        </dl>
      ) : null}

      {p.scores ? (
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <ScoreBar label="Profit" value={p.scores.profit} />
          <ScoreBar label="Saturation" value={p.scores.saturation} invert hint="Lower is better" />
          <ScoreBar label="Viral" value={p.scores.viral} />
          <ScoreBar label="Risk" value={p.scores.risk} invert hint="Lower is better" />
        </div>
      ) : null}

      {p.bestAngle ? (
        <p className="text-small text-fg-2">
          <span className="text-fg-3">Best angle: </span>
          {p.bestAngle}
        </p>
      ) : null}
      {p.gaps.length ? <p className="text-caption text-warning">Couldn't confirm: {p.gaps.slice(0, 3).join("; ")}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SourceLinks sources={p.sources} />
        <div className="flex items-center gap-2">
          <Link href={`/products/${p.ref}`} className="text-small text-fg-2 hover:text-fg">
            Full analysis
          </Link>
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => setRejecting((r) => !r)}>
            <X className="size-4" strokeWidth={1.75} />
            Reject
          </Button>
          <Button variant="primary" size="sm" disabled={pending} onClick={() => run(() => decideProductAction(p.ref, "approved"))}>
            <Check className="size-4" strokeWidth={1.75} />
            {pending ? "Saving" : "Approve"}
          </Button>
        </div>
      </div>
      {rejecting ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => decideProductAction(p.ref, "rejected", note), () => setRejecting(false));
          }}
        >
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why not? (optional; the team learns from it if you save it as a lesson)" maxLength={2000} className="min-h-16" />
          <div className="flex justify-end">
            <Button type="submit" variant="danger" size="sm" disabled={pending}>
              Reject {p.ref}
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

function Row({ p, extra }: { p: ProductCard; extra?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-border py-3 last:border-b-0">
      <span className="w-12 shrink-0 text-caption text-fg-3 tabular">{p.ref}</span>
      <Link href={`/products/${p.ref}`} className="min-w-0 flex-1 truncate text-small text-fg hover:underline">
        {p.title}
      </Link>
      {p.niche ? <span className="hidden text-caption text-fg-3 sm:inline">{p.niche}</span> : null}
      {p.score !== null ? <span className="w-14 text-right text-small tabular text-fg-2">{p.score}/100</span> : null}
      <StatusBadge status={p.status} />
      {extra}
    </li>
  );
}

function Reanalyze({ refId }: { refId: string }) {
  const { pending, run } = useAction();
  return (
    <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => reanalyzeAction(refId))} title="Analyse again">
      <RefreshCw className="size-3.5" strokeWidth={1.75} />
    </Button>
  );
}

function Numbers({ data }: { data: ProductsData }) {
  const perf = data.performance;
  const { pending, run } = useAction();
  const net = perf?.products.reduce((n, p) => n + (p.netProfit ?? 0), 0) ?? null;
  return (
    <section>
      <SectionTitle
        action={
          data.connected.shopify || data.connected.meta ? (
            <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => syncStoreAction())}>
              <RefreshCw className="size-3.5" strokeWidth={1.75} />
              Sync now
            </Button>
          ) : null
        }
      >
        Store numbers
      </SectionTitle>
      {!data.connected.shopify && !data.connected.meta ? (
        <EmptyState
          title="Connect Shopify and Meta Ads"
          body='Set providers.commerce to "shopify" and providers.adsAnalytics to "meta" in your config, add the keys to .env, and the Store Analyst will show profit, ROAS and what to scale or kill here.'
        />
      ) : !perf ? (
        <EmptyState title="No numbers yet" body="The first sync runs every 3 hours, or press Sync now. Put the product ref (like pr-12) in your Meta campaign names so spend is matched to products." />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard label={`Revenue, ${perf.windowDays} days`} value={usd(perf.store.revenue)} hint={`${perf.store.orders} orders`} />
            <MetricCard label="Ad spend" value={usd(perf.store.spend)} hint={perf.store.unmatchedSpend ? `${usd(perf.store.unmatchedSpend)} not matched to a product` : undefined} />
            <MetricCard label="Store ROAS" value={perf.store.spend ? (perf.store.revenue / perf.store.spend).toFixed(2) : "–"} />
            <MetricCard label="Net profit (matched)" value={usd(net)} hint="After product, shipping, fees, refunds and ads" />
          </div>
          {perf.products.length ? (
            <Card padded={false} className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-small">
                <thead className="text-left text-caption text-fg-3">
                  <tr className="border-b border-border">
                    <th className="px-4 py-2.5 font-normal">Product</th>
                    <th className="px-3 py-2.5 text-right font-normal">Revenue</th>
                    <th className="px-3 py-2.5 text-right font-normal">Spend</th>
                    <th className="px-3 py-2.5 text-right font-normal">ROAS</th>
                    <th className="px-3 py-2.5 text-right font-normal">Break-even</th>
                    <th className="px-3 py-2.5 text-right font-normal">CPA</th>
                    <th className="px-3 py-2.5 text-right font-normal">Net</th>
                    <th className="px-4 py-2.5 font-normal">Call</th>
                  </tr>
                </thead>
                <tbody>
                  {perf.products.map((p) => (
                    <tr key={p.ref} className="border-b border-border last:border-b-0">
                      <td className="max-w-[220px] truncate px-4 py-2.5">
                        <Link href={`/products/${p.ref}`} className="hover:underline">
                          {p.title}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular">{usd(p.revenue > 0 ? p.revenue : p.purchaseValue)}</td>
                      <td className="px-3 py-2.5 text-right tabular">{usd(p.spend)}</td>
                      <td className="px-3 py-2.5 text-right tabular">{p.roas ?? "–"}</td>
                      <td className="px-3 py-2.5 text-right tabular text-fg-2">{p.breakEvenRoas ?? "–"}</td>
                      <td className="px-3 py-2.5 text-right tabular">{usd(p.cpa)}</td>
                      <td className={cn("px-3 py-2.5 text-right tabular", (p.netProfit ?? 0) < 0 && "text-danger")}>{usd(p.netProfit)}</td>
                      <td className="px-4 py-2.5" title={p.why}>
                        <Badge tone={CALL[p.call]?.tone ?? "neutral"}>{CALL[p.call]?.label ?? p.call}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}
        </div>
      )}
    </section>
  );
}

export function ProductsView({ data }: { data: ProductsData }) {
  const [showPassed, setShowPassed] = useState(false);
  const r = data.rules;
  const rulesLine = `$${r.minSellPrice}–$${r.maxSellPrice}, ${r.minMarkup}x markup, delivery within ${r.maxShippingDays} days${r.focus.length ? `, focus: ${r.focus.join(", ")}${r.anyNiche ? " (plus any niche)" : ""}` : ""}`;

  if (!data.on) {
    return (
      <>
        <PageHeader title="Products" description="Your dropshipping teams: product research, ads, brand and store numbers." />
        <EmptyState
          title="Turn on the dropshipping teams"
          body="Add `dropship: { enabled: true }` under modules in config/attentionos.config.ts and restart (./aos restart). See docs/dropshipping.md for every setting."
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-12">
      <PageHeader title="Products" description={`What your teams found and how it's selling. Your rules: ${rulesLine}.`} actions={<HuntBar />} />

      <section>
        <SectionTitle count={data.waiting.length}>Waiting for your OK</SectionTitle>
        {data.waiting.length ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {data.waiting.map((p) => (
              <DecisionCard key={p.ref} p={p} />
            ))}
          </div>
        ) : (
          <EmptyState
            title="Nothing waiting"
            body={data.pipeline.length ? `${data.pipeline.length} product${data.pipeline.length === 1 ? " is" : "s are"} being found or analysed. Strong picks show up here.` : "Press Find products and the Product Scout goes hunting. Products that pass your rules show up here."}
          />
        )}
      </section>

      {data.launching.length ? (
        <section>
          <SectionTitle count={data.launching.length}>Launching</SectionTitle>
          <Card padded={false} className="px-4">
            <ul>
              {data.launching.map((p) => (
                <Row key={p.ref} p={p} />
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      {data.live.length ? (
        <section>
          <SectionTitle count={data.live.length}>Live</SectionTitle>
          <Card padded={false} className="px-4">
            <ul>
              {data.live.map((p) => (
                <Row key={p.ref} p={p} />
              ))}
            </ul>
          </Card>
        </section>
      ) : null}

      <Numbers data={data} />

      <section>
        <SectionTitle count={data.pipeline.length}>In the pipeline</SectionTitle>
        {data.pipeline.length ? (
          <Card padded={false} className="px-4">
            <ul>
              {data.pipeline.map((p) => (
                <Row key={p.ref} p={p} extra={p.status === "needs_data" ? <Reanalyze refId={p.ref} /> : null} />
              ))}
            </ul>
          </Card>
        ) : (
          <p className="text-small text-fg-2">Nothing being analysed right now.</p>
        )}
      </section>

      {data.stores.length ? (
        <section>
          <SectionTitle count={data.stores.length}>Stores</SectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.stores.map((s) => (
              <Card key={s.ref} className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-h3 font-medium text-fg">{s.name}</span>
                  <Badge tone={s.status === "live" ? "success" : "neutral"}>{s.status}</Badge>
                </div>
                <span className="text-small text-fg-2">
                  {s.kind === "single_product" ? "One-product store" : s.kind === "niche" ? `Niche store${s.niche ? `: ${s.niche}` : ""}` : "General store"} · {s.products} product{s.products === 1 ? "" : "s"}
                </span>
                {s.domain ? <span className="text-caption text-fg-3">{s.domain}</span> : null}
              </Card>
            ))}
          </div>
        </section>
      ) : null}

      {data.passed.length ? (
        <section>
          <SectionTitle
            count={data.passed.length}
            action={
              <Button variant="ghost" size="sm" onClick={() => setShowPassed((s) => !s)}>
                {showPassed ? "Hide" : "Show"}
              </Button>
            }
          >
            Passed on
          </SectionTitle>
          {showPassed ? (
            <Card padded={false} className="px-4">
              <ul>
                {data.passed.map((p) => (
                  <Row key={p.ref} p={p} extra={p.status !== "killed" ? <Reanalyze refId={p.ref} /> : null} />
                ))}
              </ul>
            </Card>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
