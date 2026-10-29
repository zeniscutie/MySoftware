---
name: shopify-functions
description: Writing Shopify Functions in JavaScript or Rust (compiled to WebAssembly) - discounts with the Discount Function API, delivery and payment customizations, cart and checkout validation, cart transforms - including input queries, outputs, local testing with shopify app function run, limits and plan requirements. Use for custom discount rules, hiding or renaming shipping/payment options, blocking invalid carts, or bundles.
---

# Shopify Functions

## When to Use

- Custom discount logic (tiered, bundle, customer-tag, metafield-driven), including shipping
  discounts.
- Hiding, renaming or reordering delivery or payment options.
- Validating the cart or checkout (minimums, maximums, restricted combinations).
- Cart transforms (bundles: expand or merge lines).

## How It Works

### What a Function is

A small program that Shopify runs inside checkout. It gets **input** (JSON shaped by your
GraphQL input query), returns **output** (a list of operations), and has no network access,
no clock and no randomness. It must finish within a strict instruction limit, so keep logic
simple and input queries small.

It lives in an app: `extensions/<name>/` with `shopify.extension.toml`, an input query
(`src/*.graphql`), and the code (`src/*.js` or `src/*.rs`).

### Pick the API

| Need | API (check current names in the docs) |
|---|---|
| Product, order and shipping discounts | Discount Function API — one function can return product, order and delivery discount candidates (target `cart.lines.discounts.generate.run`, plus a delivery target) |
| Change delivery options | Delivery Customization API |
| Change payment methods | Payment Customization API |
| Block checkout with an error | Cart and Checkout Validation API |
| Bundles / line changes | Cart Transform API |

Use the Shopify Dev MCP tools to read the current schema, targets and output shape for the API
version in `shopify.extension.toml`. These APIs are versioned and have changed in recent
releases (the older Product/Order/Shipping Discount APIs were replaced by the Discount Function
API). Some APIs, or using them in custom apps, depend on the store's Shopify plan; check before
building. A store can have a limited number of active discount functions.

### Language

- **JavaScript** (default from the generator): fastest to write; fine for most store rules.
- **Rust**: when the logic is heavy or close to the instruction limit. Build target
  `wasm32-wasip1`.

### Configuration

Pass settings (thresholds, percentages, tags) through a **metafield** on the discount or
customization, read it in the input query, and parse it defensively. Don't hard-code values the
store owners will want to change.

### Testing

1. Unit-test the pure logic (`run` function) with Vitest or `cargo test`, using JSON input
   fixtures with made-up data.
2. Run the compiled function locally:
   `shopify app function run --path extensions/<name> < fixture.json`.
3. Replay a real execution from the dev store: `shopify app function replay` (logs come from
   `shopify app dev`).
4. Test on the dev store's checkout before deploying.

### Safety

- A bug can give away discounts or block every checkout. Default to "no operation" when input
  is missing or unexpected.
- Deploying (`shopify app deploy`) changes checkout on every store where the app is installed;
  the MySoftware hook asks for approval first.

## Examples

### JavaScript discount: 10% off lines when the cart has 3+ items

```js
// extensions/tiered-discount/src/cart_lines_discounts_generate_run.js
// Shape of input/output follows the Discount Function API; confirm field names for your API version.
export function cartLinesDiscountsGenerateRun(input) {
  const quantity = input.cart.lines.reduce((sum, line) => sum + line.quantity, 0);
  if (quantity < 3) return { operations: [] };

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates: [
            {
              message: '10% off 3+ items',
              targets: input.cart.lines.map(line => ({ cartLine: { id: line.id } })),
              value: { percentage: { value: 10 } }
            }
          ],
          selectionStrategy: 'FIRST'
        }
      }
    ]
  };
}
```

### Vitest for the same function

```js
import { describe, it, expect } from 'vitest';
import { cartLinesDiscountsGenerateRun } from '../src/cart_lines_discounts_generate_run';

const cart = qty => ({ cart: { lines: [{ id: 'gid://shopify/CartLine/1', quantity: qty }] } });

describe('tiered discount', () => {
  it('does nothing under 3 items', () => {
    expect(cartLinesDiscountsGenerateRun(cart(2)).operations).toEqual([]);
  });
  it('adds a 10% product discount from 3 items', () => {
    const [op] = cartLinesDiscountsGenerateRun(cart(3)).operations;
    expect(op.productDiscountsAdd.candidates[0].value.percentage.value).toBe(10);
  });
});
```
