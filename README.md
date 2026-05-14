# AS Global Addons

Cloudflare Worker endpoint for Shopify draft order add-on rules.

The Worker fetches the full Shopify draft order line item list, applies configured add-on rules, then calls `draftOrderUpdate` with the complete existing line item array plus any missing add-ons. Preserving the full line item array is the key safety requirement.

Current rule:

```text
If any tray SKU exists, add L-AS-FFC quantity 1 when missing.
```

Accessory add-on rule:

```text
AS-SUTT-* or AS-TUTT-* adds 2 x AS-WT per line quantity.
AS-C-* adds 4 x AS-WT per line quantity unless AS-CL-WT exists.
Tray SKUs add 1 x AS-WT and 1 x AS-MUDFLAP per line quantity.
AS-MUDFLAP-350 or AS-MUDFLAP-400 suppresses all AS-MUDFLAP additions.
Existing AS-WT and AS-MUDFLAP quantities are subtracted before adding missing quantities.
AS-WT and AS-MUDFLAP are added with a 100% automatic discount.
```

Primary endpoint:

```text
POST /webhooks/draft-orders
```

Fallback Flow endpoint:

```text
POST /flow/draft-order-addons
```

Legacy Flow compatibility endpoint:

```text
POST /flow/draft-order-final-fuel-check
```

Keep the Flow endpoints only as a fallback while webhook delivery is being proven.

## Stores

The same route supports both Shopify stores:

```text
autospec-group.myshopify.com
line-x-australia.myshopify.com
```

Webhook store routing is selected by Shopify's `X-Shopify-Shop-Domain` header. Flow fallback routing is selected by the `storeDomain` body field, with `X-Shopify-Shop-Domain` as a fallback.

## Shopify OAuth Install

The Worker uses Shopify OAuth to install the app and store per-shop Admin API tokens in Cloudflare KV.

Install URLs:

```text
https://<worker-host>/shopify/install?shop=autospec-group.myshopify.com
https://<worker-host>/shopify/install?shop=line-x-australia.myshopify.com
```

OAuth callback URL to configure in the Shopify Dev Dashboard:

```text
https://<worker-host>/shopify/callback
```

Requested scopes:

```text
read_draft_orders,write_draft_orders
```

## Shopify Webhooks

The Worker subscribes each store to:

```text
draft_orders/create
draft_orders/update
```

Webhook requests are validated using Shopify's `X-Shopify-Hmac-SHA256` header against the raw request body before JSON parsing.

Protected registration endpoint:

```text
POST /admin/register-webhooks
```

Headers:

```text
X-Autospec-Flow-Secret: <same value as FLOW_SHARED_SECRET>
```

The registration endpoint is idempotent: it creates missing subscriptions and reports `already_registered` when subscriptions already exist.

## Required Secrets

Set these with Wrangler secrets:

```bash
npx wrangler secret put FLOW_SHARED_SECRET
npx wrangler secret put SHOPIFY_CLIENT_ID
npx wrangler secret put SHOPIFY_CLIENT_SECRET
npx wrangler secret put OAUTH_STATE_SECRET
```

The OAuth install writes Shopify tokens into the `SHOPIFY_TOKENS` KV namespace.

## Variant IDs

Variant IDs are configured in `wrangler.json`.

Current `L-AS-FFC` add-on variants:

```text
autospec-group.myshopify.com: gid://shopify/ProductVariant/52009214443840
line-x-australia.myshopify.com: gid://shopify/ProductVariant/46912043614383
```

Current accessory add-on variants:

```text
autospec-group.myshopify.com AS-WT: gid://shopify/ProductVariant/50506355179840
autospec-group.myshopify.com AS-MUDFLAP: gid://shopify/ProductVariant/50595298017600
line-x-australia.myshopify.com AS-WT: gid://shopify/ProductVariant/44268756631727
line-x-australia.myshopify.com AS-MUDFLAP: gid://shopify/ProductVariant/44998037045423
```

Future add-on rules should use variant IDs, not product IDs.

## Shopify Flow Fallback Setup

Use this only if webhook delivery needs a temporary fallback.

Trigger:

```text
Draft order created
```

Optional condition:

```text
Line item SKU is one of the rule trigger SKUs
```

Action:

```text
Send HTTP request
```

Method:

```text
POST
```

URL:

```text
https://<worker-host>/flow/draft-order-addons
```

Headers:

```text
Content-Type: application/json
X-Autospec-Flow-Secret: <same value as FLOW_SHARED_SECRET>
```

Body:

```json
{
	"draftOrderId": "{{ draftOrder.id }}",
	"storeDomain": "{{ shop.myshopify_domain }}"
}
```

Create the same Flow in both stores.

## Local Checks

```bash
npm test
npm run check
```

## Future Changes

For repo handoff notes, implementation cautions, and the safe change workflow, read `AGENTS.md` first.

Most rule changes should be made in `src/index.ts` and covered by `src/index.test.ts`. The most important invariant is preserving every existing draft order line item when calling Shopify `draftOrderUpdate`.
