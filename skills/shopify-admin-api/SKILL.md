---
name: shopify-admin-api
description: Reading and changing store data with the Shopify GraphQL Admin API - authentication (legacy shpat_ tokens or client-credentials tokens), API versions, pagination, rate limits, Bulk Operations, userErrors, GIDs, products, variants, inventory, metafields and orders. Use when writing any script or app code that talks to the Admin API.
---

# Shopify GraphQL Admin API

## When to Use

- Scripts or app code that read or change products, variants, inventory, collections,
  metafields, orders or customers.
- Writing or debugging GraphQL queries and mutations.
- Large exports or bulk edits.

## How It Works

### Always

- **GraphQL, not REST.** The REST Admin API is legacy.
- **Look up the schema first** with the Shopify Dev MCP tools (introspect / search docs) for
  the API version you pin. Validate operations with its GraphQL validation tool.
- **Pin the version** in the URL (`/admin/api/<YYYY-MM>/graphql.json`). Versions are released
  quarterly (January, April, July, October) and each is supported for about a year. Put the
  version in one config constant and check it is still supported when you touch the code.
- **Use variables**, never string-concatenate values into the query.
- **Check `userErrors`** on every mutation and treat a non-empty list as failure.
- **IDs are GIDs**: `gid://shopify/Product/1234567890`.

### Authentication

Credentials live in `.env` (gitignored), never in code:

| Setup | `.env` | How to get a token |
|---|---|---|
| Existing admin-created custom app (created before 2026) | `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_TOKEN` (`shpat_…`) | Use the token directly. It cannot be rotated; to replace it, create a new app. |
| App created in the Dev Dashboard (required for new apps since 1 Jan 2026) | `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET` | Client credentials grant: `POST https://<store>/admin/oauth/access_token` with `client_id`, `client_secret`, `grant_type=client_credentials`. Token lasts ~24 h; request a new one when it expires. Works when the app and the store belong to the same organisation. |
| Embedded app (Shopify app template) | handled by the template | `authenticate.admin(request)` gives an `admin.graphql` client. |

Send the token as the `X-Shopify-Access-Token` header. Never log it.

### Pagination

Connections take `first` (max 250) and `after`; read `pageInfo { hasNextPage endCursor }`
and loop until `hasNextPage` is false. Most "missing data" bugs are scripts that stop after
the first page.

### Rate limits

The GraphQL Admin API uses calculated query cost. Responses include
`extensions.cost.throttleStatus` (`currentlyAvailable`, `restoreRate`). On a `THROTTLED`
error, wait and retry with backoff. Request only the fields you need.

### Bulk Operations (large data)

For thousands of records use `bulkOperationRunQuery` (export) and
`bulkOperationRunMutation` (import from a staged JSONL upload via `stagedUploadsCreate`).
Poll the operation by ID (or subscribe to the `bulk_operations/finish` webhook), then download
the JSONL result from its `url`. Only one bulk query and one bulk mutation can run at a time
per store (check the docs for the current limit).

### Common objects

- Products and variants: `products`, `productVariants`; create/update with `productSet` (full
  upsert) or `productUpdate` / `productVariantsBulkUpdate`.
- Inventory: quantities belong to an `InventoryItem` at a `Location`. Use
  `inventorySetQuantities` (set absolute) or `inventoryAdjustQuantities` (delta), with a
  `reason`.
- Metafields: `metafieldsSet` (up to 25 per call) with `ownerId`, `namespace`, `key`, `type`,
  `value` (always a string).
- Orders and customers contain personal data: request only needed fields and don't log them.

### Changing live data

Dry-run by default (`--apply` flag to write), show a sample of before → after, back up
current values to a file, write in small batches, stop on the first `userErrors`. Ask the user
before running with `--apply` on the live store.

## Examples

### Node (built-in fetch) client with both auth modes

```js
// lib/shopify.mjs
const API_VERSION = '2026-10'; // check it is still supported (Dev MCP / docs)
const store = process.env.SHOPIFY_STORE_DOMAIN;
let cached = { token: process.env.SHOPIFY_ADMIN_TOKEN, expiresAt: Infinity };

async function accessToken() {
  if (cached.token && Date.now() < cached.expiresAt) return cached.token;
  const res = await fetch(`https://${store}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      grant_type: 'client_credentials'
    })
  });
  if (!res.ok) throw new Error(`token request failed: ${res.status}`);
  const body = await res.json();
  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 };
  return cached.token;
}

export async function gql(query, variables = {}) {
  const res = await fetch(`https://${store}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await accessToken() },
    body: JSON.stringify({ query, variables })
  });
  const body = await res.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
}
```

### Paginate all products without images

```js
const QUERY = `query($after: String) {
  products(first: 250, after: $after, query: "status:active") {
    nodes { id title handle media(first: 1) { nodes { id } } }
    pageInfo { hasNextPage endCursor }
  }
}`;
let after = null;
const missing = [];
do {
  const { products } = await gql(QUERY, { after });
  missing.push(...products.nodes.filter(p => p.media.nodes.length === 0));
  after = products.pageInfo.hasNextPage ? products.pageInfo.endCursor : null;
} while (after);
```

### Set a metafield and check userErrors

```js
const { metafieldsSet } = await gql(`mutation($m: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $m) { metafields { id } userErrors { field message } }
}`, { m: [{ ownerId: productId, namespace: 'custom', key: 'size_chart', type: 'multi_line_text_field', value: text }] });
if (metafieldsSet.userErrors.length) throw new Error(JSON.stringify(metafieldsSet.userErrors));
```
