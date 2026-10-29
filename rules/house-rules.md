## MySoftware house rules

1. Plan before changes that touch more than a couple of files (`/plan-feature`). Wait for a yes before editing.
2. Logic gets tests first (`/tdd`): scripts, app code, Shopify Functions. Theme markup gets Theme Check and a preview instead.
3. Work on a development store, an unpublished theme or `shopify theme dev` first. Never push to the live theme, publish a theme, or deploy/release an app without the user's explicit yes.
4. Ask before anything that changes live store data in bulk, changes prices or inventory, or emails customers. Dry-run first and show a sample of what will change.
5. No secrets in code or chat output. Tokens live in `.env` and are read from the environment.
6. Prefer the GraphQL Admin API. Check current API shapes with the Shopify Dev MCP tools instead of memory, and pin the API version.
7. Customer data (names, emails, addresses, orders) stays out of logs, commits and test fixtures. Use made-up data.
8. Before saying work is done, verify it (`verification-loop` skill) and say what was and wasn't checked.
