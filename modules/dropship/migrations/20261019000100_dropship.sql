-- dropship: products the teams find and analyse, the stores they're sold in, what the teams make for them
-- (ad scripts, ad copy, posts, store names, brand identity, layouts, creative briefs, reports) and daily store
-- numbers from Shopify and Meta Ads. Additive to schema v1.

-- A store: a niche store with several products, a one-product store, or a general store.
create table if not exists dropship_stores (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  ref             text not null,                 -- "st-3"
  kind            text not null check (kind in ('niche', 'single_product', 'general')),
  name            text not null,
  niche           text,
  status          text not null default 'planning' check (status in ('planning', 'live', 'paused', 'closed')),
  domain          text,
  brand           jsonb not null default '{}',   -- the chosen identity: palette, fonts, logo direction, tagline
  notes           text,
  created_by      text not null default 'system',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, ref)
);

-- A product from first sighting to live (or killed). Facts the scout and analyst gathered from the web are
-- UNTRUSTED data: they only reach tool-less model calls, fenced as data.
create table if not exists dropship_products (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references workspaces(id) on delete cascade,
  ref                text not null,              -- "pr-12"
  title              text not null,
  fingerprint        text not null,              -- normalised title, so the same product isn't added twice
  niche              text,
  status             text not null default 'found' check (status in (
                       'found', 'analyzing', 'needs_data', 'auto_rejected', 'awaiting_approval', 'approved', 'rejected',
                       'launching', 'live', 'paused', 'killed')),
  pitch              text,                       -- one line: what it is and why it sells
  sources            jsonb not null default '[]',-- [{kind, url, note}]
  supplier           jsonb,                      -- {name, url, cost, shippingCost, shippingDaysMin, shippingDaysMax, rating, orders}
  evidence           jsonb not null default '{}',-- what the scout saw: ads, engagement, trend direction
  analysis           jsonb,                      -- the analyst's facts, judgments and the scores worked out in code
  score              numeric,                    -- 0–100 overall, from code
  verdict            text check (verdict in ('pass', 'borderline', 'weak', 'fail', 'needs_data')),
  approval_ref       text,
  decision_note      text,
  store_id           uuid references dropship_stores(id) on delete set null,
  shopify_product_id text,
  found_by           text not null default 'system',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  decided_at         timestamptz,
  unique (workspace_id, ref),
  unique (workspace_id, fingerprint)
);
create index if not exists dropship_products_status_idx on dropship_products (workspace_id, status, updated_at desc);
create index if not exists dropship_products_shopify_idx on dropship_products (workspace_id, shopify_product_id) where shopify_product_id is not null;

-- What the teams made for a product or a store.
create table if not exists dropship_assets (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  product_id    uuid references dropship_products(id) on delete cascade,
  store_id      uuid references dropship_stores(id) on delete cascade,
  kind          text not null check (kind in (
                  'ad_script', 'ad_copy', 'organic_post', 'angle', 'store_name', 'brand_identity', 'store_layout',
                  'creative_brief', 'store_plan', 'report')),
  title         text not null,
  body          jsonb not null,
  problems      jsonb not null default '[]',     -- checks it failed (banned claims, bad colours); shown, never hidden
  status        text not null default 'draft' check (status in ('draft', 'approved', 'rejected', 'used')),
  run_id        uuid,
  created_by    text not null default 'system',
  created_at    timestamptz not null default now()
);
create index if not exists dropship_assets_product_idx on dropship_assets (workspace_id, product_id, kind, created_at desc);
create index if not exists dropship_assets_kind_idx on dropship_assets (workspace_id, kind, created_at desc);

-- Daily store numbers. source shopify: key = store product id ('store' for shop totals); source meta: key = ad id.
create table if not exists dropship_daily (
  workspace_id    uuid not null references workspaces(id) on delete cascade,
  day             date not null,
  source          text not null check (source in ('shopify', 'meta')),
  key             text not null,
  product_id      uuid references dropship_products(id) on delete set null,
  label           text,
  orders          int not null default 0,
  units           int not null default 0,
  revenue         numeric not null default 0,
  refunds         numeric not null default 0,
  spend           numeric not null default 0,
  impressions     bigint not null default 0,
  clicks          bigint not null default 0,
  purchases       numeric not null default 0,
  purchase_value  numeric not null default 0,
  currency        text,
  updated_at      timestamptz not null default now(),
  primary key (workspace_id, day, source, key)
);
create index if not exists dropship_daily_product_idx on dropship_daily (workspace_id, product_id, day desc);

-- Product approvals go through the same approvals queue as everything else, as kind 'product'.
alter table approvals drop constraint if exists approvals_kind_check;
alter table approvals add constraint approvals_kind_check
  check (kind in ('script', 'edit', 'post', 'dm_reply', 'comment_reply', 'campaign', 'spend', 'brand_change', 'product', 'other'));

alter table dropship_stores enable row level security;
alter table dropship_products enable row level security;
alter table dropship_assets enable row level security;
alter table dropship_daily enable row level security;
do $$
declare t text;
begin
  foreach t in array array['dropship_stores', 'dropship_products', 'dropship_assets', 'dropship_daily'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = 'member_all') then
      execute format('create policy member_all on %I for all using (aos_is_member(workspace_id)) with check (aos_is_member(workspace_id))', t);
    end if;
  end loop;
end $$;

-- A person's decision on a product approval, from any surface (Studio, Telegram, Discord, Claude Code, the CLI),
-- queues `dropship.sync-decisions` right away, so approved products start their launch without waiting for a schedule.
-- System bookkeeping (a newer analysis replacing the approval) doesn't.
create or replace function aos_dropship_product_decision() returns trigger
language plpgsql as $$
begin
  if coalesce(new.decided_by, '') = 'system' then
    return new;
  end if;
  insert into agent_runs (workspace_id, agent, job_id, trigger, status, input, dedupe_key, created_by)
  values (new.workspace_id, 'product_analyst', 'dropship.sync-decisions', 'event', 'queued', '{}'::jsonb, 'dropship-sync-decisions',
          coalesce(new.decided_by, 'system'))
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists dropship_product_decision on approvals;
create trigger dropship_product_decision
  after update of status on approvals
  for each row
  when (new.kind = 'product' and new.subject_type = 'dropship_product' and old.status = 'pending' and new.status <> 'pending')
  execute function aos_dropship_product_decision();
