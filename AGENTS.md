# AS Global Addons Agent Notes

Keep the codebase clean: no temporary files, no dead code, no dead folders, and no unused template leftovers.

## Project Purpose

This repo is the Cloudflare Worker for Autospec Shopify draft order add-ons.

Live Worker:

```text
https://as-global-addons.matt-skeoch.workers.dev
```

The Worker listens for Shopify draft order create/update webhooks from two stores and applies required add-on products to the draft order:

```text
autospec-group.myshopify.com
line-x-australia.myshopify.com
```

The core safety requirement is that `draftOrderUpdate` receives the complete rebuilt draft order `lineItems` array. Never update with only the new add-on line, because Shopify treats `DraftOrderInput.lineItems` as the replacement list.

## Current Behavior

Primary route:

```text
POST /webhooks/draft-orders
```

Fallback Flow route:

```text
POST /flow/draft-order-addons
```

Legacy Flow route kept for compatibility:

```text
POST /flow/draft-order-final-fuel-check
```

Protected webhook registration route:

```text
POST /admin/register-webhooks
```

The registration route is authenticated with `X-Autospec-Flow-Secret` and is idempotent.

## Add-On Rules

Tray SKUs add:

```text
L-AS-FFC x 1
AS-WT x tray quantity, free via 100% discount
AS-MUDFLAP x tray quantity, free via 100% discount
```

Canopy SKUs:

```text
AS-C-* adds AS-WT x 4 per line quantity unless AS-CL-WT exists
```

Under tray toolbox SKUs:

```text
AS-SUTT-* or AS-TUTT-* adds AS-WT x 2 per line quantity
```

Mudflap upgrades:

```text
AS-MUDFLAP-350 or AS-MUDFLAP-400 suppresses all AS-MUDFLAP additions
```

Existing `AS-WT` and `AS-MUDFLAP` quantities are subtracted before adding missing quantities.

## Important Implementation Notes

- Source file: `src/index.ts`.
- Tests: `src/index.test.ts`.
- Store-specific variant IDs are configured in `wrangler.json`.
- Shopify OAuth secrets are Cloudflare Worker secrets, not checked into the repo.
- `SHOPIFY_TOKENS` KV is configured, but the live Worker can also use legacy token secrets if KV has no token.
- Webhook HMAC validation must use the raw request body and `X-Shopify-Hmac-SHA256`.
- Webhook store routing uses `X-Shopify-Shop-Domain`.
- Flow fallback store routing uses the JSON `storeDomain` field.
- SKU comparisons are normalized to lowercase.
- Free add-on lines are merged by configured add-on variant ID plus a 100% percentage discount. Do not rely on the discount title, because Shopify may return it as null or altered.
- The Worker consolidates duplicate automatic `AS-WT`/`AS-MUDFLAP` lines it owns on the next save/webhook.
- Manual paid lines for the same products should not be merged unless they have the configured free add-on variant ID and 100% discount.

## Safe Change Workflow

Before changing rule behavior, add or update tests in `src/index.test.ts`.

Run:

```bash
npm test
npm run check
```

Deploy:

```bash
npm run deploy
```

If webhook subscriptions need to be recreated, call the protected registration endpoint after deploy:

```bash
curl -X POST "https://as-global-addons.matt-skeoch.workers.dev/admin/register-webhooks" \
  -H "X-Autospec-Flow-Secret: <FLOW_SHARED_SECRET>" \
  -H "Content-Type: application/json"
```

Expected result should show each store with `DRAFT_ORDERS_CREATE` and `DRAFT_ORDERS_UPDATE` as either `registered` or `already_registered`.

## Sales Team UX

In Shopify Admin, add-ons are applied by webhook after the draft order save. Staff may need to save and refresh the draft order page before seeing added products, although Shopify sometimes updates quickly enough that it appears without an obvious refresh.
