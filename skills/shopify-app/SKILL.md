---
name: shopify-app
description: Building a custom Shopify app for our own store with the Shopify CLI app template (TypeScript, React Router, Polaris, App Bridge) - scaffolding, shopify.app.toml config and scopes, authenticate.admin, extensions, local dev and safe deploys. Use when the work needs admin screens, background jobs, integrations with other services, webhooks, or hosting a Shopify Function or checkout extension.
---

# Shopify apps

## When to Use

- An admin page or tool the store owners use inside Shopify admin.
- Syncing data with another system (ERP, email platform, spreadsheet, 3PL).
- Reacting to store events (orders, inventory, products) with webhooks.
- Shipping Shopify Functions or checkout/theme app extensions (they live inside an app).

If the job is a one-off or scheduled data task with no UI, a script with the Admin API
(`shopify-admin-api` skill) is simpler.

## How It Works

### Create and run

```bash
shopify app init                 # choose the TypeScript template (React Router)
cd <app>
shopify app dev                  # tunnels, installs on the dev store, hot reload
shopify app generate extension   # functions, checkout UI, theme app extension, …
```

Develop against a **development store**. Install on the real store only when it is ready.

### Project map (template)

```text
shopify.app.toml        app config: client_id, scopes, webhooks, app URLs, access settings
app/routes/             React Router routes; app.*.tsx are embedded admin pages
app/shopify.server.ts   shopifyApp(...) setup: API version, session storage, auth
extensions/             functions and UI extensions, each with shopify.extension.toml
prisma/ (default)       session storage — swap for your database if needed
```

### Admin API calls inside the app

```ts
// app/routes/app.products.tsx
import type { LoaderFunctionArgs } from 'react-router';
import { authenticate } from '../shopify.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const res = await admin.graphql(`#graphql
    query { products(first: 10) { nodes { id title } } }`);
  const { data } = await res.json();
  return { products: data.products.nodes };
}
```

Every route that touches store data calls `authenticate.admin` (or `authenticate.webhook`,
`authenticate.public.appProxy` as appropriate). Never trust IDs or shop domains sent from the
browser without it.

### Config and scopes

- Declare scopes in `shopify.app.toml` (`[access_scopes] scopes = "read_products,write_products"`).
  Ask for the minimum; every `write_*` must be used.
- App-specific webhook subscriptions go in `shopify.app.toml` (`[[webhooks.subscriptions]]`),
  handled in routes with `authenticate.webhook` (see `shopify-webhooks`).
- Secrets (client secret, database URL, third-party keys) go in environment variables / the
  host's secret store, never in the repo. `shopify app env show` prints them — don't paste
  its output into files or chat.

### UI

Use Polaris web components / App Bridge as the template sets them up so the app looks like
Shopify admin. Keep forms accessible (labels, errors next to fields).

### Testing

- Unit-test business logic in plain modules with Vitest (`tdd-workflow`), mocking `admin.graphql`.
- Exercise routes on the dev store with `shopify app dev`.

### Deploying

- `shopify app deploy` releases a new app version (config + all extensions) to every store the
  app is installed on. The MySoftware hook blocks it until the user explicitly approves.
- Hosting the web part (Fly.io, Render, a VPS, etc.) is separate; keep production env vars in
  the host's secret settings.
- Before deploying: `verification-loop`, `shopify-security-reviewer`, and a check that
  `shopify.app.toml` scopes and webhook URLs point at production, not a tunnel.

### Look things up

The template, CLI flags and APIs change often. Check the Shopify Dev MCP tools and the
template's README for the current way to do things before following memory.

## Examples

Generate a discount function inside the app and run it locally:

```bash
shopify app generate extension --template discount --name tiered-discount
shopify app function run --path extensions/tiered-discount < extensions/tiered-discount/input.json
```

Minimal webhook subscription in `shopify.app.toml`:

```toml
[webhooks]
api_version = "2026-10"

  [[webhooks.subscriptions]]
  topics = ["orders/create"]
  uri = "/webhooks/orders/create"
```
