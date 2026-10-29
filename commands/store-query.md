---
description: Write a GraphQL Admin API query or bulk change for the store, validate it against the current schema, dry-run it, and only apply changes after your yes.
argument-hint: "[what to read or change, e.g. 'products with no images' or 'add 10% to compare-at prices in collection X']"
---

# Store query

Request: $ARGUMENTS

Follow the `shopify-admin-api` skill (and `store-data-scripts` for reports or CSV output).

1. **Clarify** which store, which records, and whether this reads or **changes** data.
2. **Look up the schema** with the Shopify Dev MCP tools (search docs / introspect the Admin
   API schema) for the current API version. Do not rely on memory for field names.
3. **Write the operation** with variables (never string-concatenate values into GraphQL).
   Paginate with `first`/`after` + `pageInfo`, or use a Bulk Operation for large data sets.
   Always request and check `userErrors` on mutations.
4. **Validate** the operation with the Dev MCP GraphQL validation tool if available.
5. **Credentials**: read the store domain and token from `.env`
   (`SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_TOKEN`). If missing, explain how to add them and
   stop. Never print the token.
6. **Read-only** requests: run it, summarise the result, and offer CSV output.
7. **Changes** (mutations):
   - Run the read side first and show how many records match and a sample of 5 with
     before → after values.
   - Save a backup of the current values to a local CSV/JSON file.
   - Ask: "Apply this change to N records on <store>?" and wait for an explicit yes.
   - Apply in small batches, respect rate limits, stop on errors, and report what changed
     and where the backup is.

Do not include customer personal data in the chat summary unless the user asked for it.
