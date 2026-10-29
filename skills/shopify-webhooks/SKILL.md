---
name: shopify-webhooks
description: Receiving Shopify webhooks safely - subscribing in shopify.app.toml, verifying the X-Shopify-Hmac-Sha256 signature on the raw body, responding fast, deduplicating with X-Shopify-Webhook-Id, handling retries and out-of-order delivery, and the mandatory privacy webhooks. Use when reacting to orders, products, inventory, customers or app events.
---

# Shopify webhooks

## When to Use

- Doing something when an order is created/paid/fulfilled, a product or inventory changes, or
  the app is uninstalled.
- Debugging missing, duplicate or failing webhook deliveries.
- Reviewing any HTTP endpoint that receives Shopify webhooks.

## How It Works

### Subscribe

In an app built from the template, declare app-specific subscriptions in `shopify.app.toml`
(`[[webhooks.subscriptions]]` with `topics` and `uri`) and deploy. Use `filter` and
`include_fields` where available to receive less data.

### Verify every delivery

Shopify signs each request with `X-Shopify-Hmac-Sha256`: a **base64 HMAC-SHA256 of the raw
request body** using the app's **client secret**. Verify it **before** parsing JSON or doing
anything, with a constant-time comparison. Parsing and re-serialising the body breaks the
signature — use the raw bytes.

In the app template, `authenticate.webhook(request)` does this for you. Elsewhere, see the
example below.

### Respond fast, work later

Return `200` within a few seconds, then do slow work (API calls, emails, syncs) in a background
job or queue. Slow or failing endpoints get retried: Shopify retries failed deliveries
(currently up to 8 times over about 4 hours with backoff) and can remove subscriptions that
keep failing.

### Expect duplicates and disorder

- Deduplicate on `X-Shopify-Webhook-Id` (unique per delivery; store seen IDs for a few days).
- `X-Shopify-Event-Id` is shared by deliveries caused by the same store action across
  subscriptions — use it to correlate, not to dedupe.
- Deliveries can arrive out of order. Use the resource's `updated_at` (or re-fetch the resource
  from the Admin API) instead of assuming order.
- Webhooks can be missed. For anything important (orders, inventory) also run a periodic
  reconciliation job that queries the Admin API.

### Privacy webhooks

Apps that store customer data must handle `customers/data_request`, `customers/redact` and
`shop/redact` (configured as compliance topics in `shopify.app.toml`). They must verify HMAC
like any other webhook.

### Logging

Log topic, shop domain, webhook ID and outcome — not the payload, which may contain customer
personal data.

## Examples

### Node / Express-style HMAC verification

```js
import crypto from 'node:crypto';

export function isValidShopifyWebhook(rawBody, hmacHeader, secret) {
  if (typeof hmacHeader !== 'string' || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const received = Buffer.from(hmacHeader, 'base64');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

// app.post('/webhooks/orders-create', express.raw({ type: 'application/json' }), (req, res) => {
//   if (!isValidShopifyWebhook(req.body, req.get('X-Shopify-Hmac-Sha256'), process.env.SHOPIFY_CLIENT_SECRET)) {
//     return res.sendStatus(401);
//   }
//   const webhookId = req.get('X-Shopify-Webhook-Id');
//   if (alreadyProcessed(webhookId)) return res.sendStatus(200);
//   queue.add('orders-create', { webhookId, body: JSON.parse(req.body) });
//   res.sendStatus(200);
// });
```

### App template route

```ts
// app/routes/webhooks.orders.create.tsx
import type { ActionFunctionArgs } from 'react-router';
import { authenticate } from '../shopify.server';

export async function action({ request }: ActionFunctionArgs) {
  const { topic, shop, payload } = await authenticate.webhook(request); // verifies HMAC
  await enqueueOrderSync({ shop, orderId: payload.admin_graphql_api_id, topic });
  return new Response();
}
```
