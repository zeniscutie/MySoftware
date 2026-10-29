---
name: store-data-scripts
description: Writing safe scripts for store operations and reporting in Python or Node - exports, sales and stock reports, CSV-driven bulk updates of prices, inventory, tags or metafields - with dry-run by default, backups, batching and no customer data leaks. Use for one-off or scheduled data jobs that don't need an app UI.
---

# Store data scripts

## When to Use

- Reports: sales by product, slow movers, low stock, products missing images/SEO/metafields.
- Exports to CSV/Excel for the business partner or accountant.
- Bulk updates from a CSV: prices, compare-at prices, tags, inventory, metafields.
- Scheduled jobs (cron, GitHub Actions) that check or fix store data.

## How It Works

### Language choice

- **Python** (`pandas`, `requests` or `httpx`) when the job is mostly analysis, joining CSVs,
  or producing spreadsheets.
- **Node** (built-in `fetch`) when it shares code with the app or is part of a JS project.

Either way, use the GraphQL Admin API patterns from the `shopify-admin-api` skill
(auth, pagination, rate limits, `userErrors`, Bulk Operations for large data).

### Project layout

```text
scripts/
  lib/shopify.(py|mjs)   one small API client (auth, retries, pagination)
  <job>.py|mjs           one file per job, with --help
tests/                   tests for parsing and transform logic (tdd-workflow)
output/                  reports and backups (gitignored)
.env                     SHOPIFY_STORE_DOMAIN + token or client id/secret (gitignored)
.env.example             the same keys with placeholder values (committed)
```

### Safety rules for scripts that change data

1. **Dry-run is the default.** Writing needs an explicit `--apply` flag.
2. **Show the plan**: count of records, a sample of 5 with before → after, and totals (e.g.
   "average price change +4.8%").
3. **Back up** current values to `output/backup-<job>-<timestamp>.csv` before writing.
4. **Batch and throttle**; stop at the first error or non-empty `userErrors`.
5. **Log** what changed (IDs, fields, old → new) to a file, without customer personal data.
6. **Make it re-runnable**: running twice must not double-apply (set absolute values, or check
   current state first).
7. Ask the user before running with `--apply` against the live store.

### Customer data

Order and customer exports contain personal data. Only export fields that are needed, keep
files in `output/` (gitignored), don't paste rows into chat, and delete files when done.

### Money

Shopify returns money as decimal strings. Use `Decimal` (Python) or integer cents (JS) — never
binary floats — for calculations, and round only at the end.

## Examples

### Python: dry-run price update from CSV

```python
# scripts/update_prices.py
"""Update variant prices from a CSV with columns sku,price. Dry-run unless --apply."""
import argparse, csv, datetime, os
from decimal import Decimal
from lib.shopify import gql, variants_by_sku  # small client per shopify-admin-api skill

parser = argparse.ArgumentParser()
parser.add_argument("csv_path")
parser.add_argument("--apply", action="store_true", help="write changes to the store")
args = parser.parse_args()

rows = {r["sku"].strip(): Decimal(r["price"]) for r in csv.DictReader(open(args.csv_path))}
current = variants_by_sku(list(rows))          # {sku: {"id":..., "product_id":..., "price": "19.90"}}
changes = [(sku, v, rows[sku]) for sku, v in current.items() if Decimal(v["price"]) != rows[sku]]

print(f"{len(changes)} of {len(rows)} SKUs would change")
for sku, v, new in changes[:5]:
    print(f"  {sku}: {v['price']} -> {new}")

if not args.apply:
    print("Dry run. Re-run with --apply to write.")
    raise SystemExit(0)

os.makedirs("output", exist_ok=True)
stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
with open(f"output/backup-prices-{stamp}.csv", "w", newline="") as f:
    w = csv.writer(f); w.writerow(["sku", "variant_id", "old_price"])
    for sku, v, _ in changes: w.writerow([sku, v["id"], v["price"]])
# ...then productVariantsBulkUpdate per product, checking userErrors after each call.
```

### Report: low stock to CSV (Node)

```js
// scripts/low-stock.mjs — node --env-file=.env scripts/low-stock.mjs 5
import { writeFileSync } from 'node:fs';
import { gql } from './lib/shopify.mjs';

const threshold = Number(process.argv[2] || 5);
const rows = [['sku', 'product', 'available']];
let after = null;
do {
  const { productVariants } = await gql(`query($after: String) {
    productVariants(first: 250, after: $after) {
      nodes { sku displayName inventoryQuantity }
      pageInfo { hasNextPage endCursor }
    }
  }`, { after });
  for (const v of productVariants.nodes) {
    if (v.inventoryQuantity !== null && v.inventoryQuantity <= threshold) rows.push([v.sku, v.displayName, v.inventoryQuantity]);
  }
  after = productVariants.pageInfo.hasNextPage ? productVariants.pageInfo.endCursor : null;
} while (after);
writeFileSync('output/low-stock.csv', rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'));
console.log(`${rows.length - 1} variants at or below ${threshold}`);
```
