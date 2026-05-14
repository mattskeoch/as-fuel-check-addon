const FLOW_ROUTE = "/flow/draft-order-addons";
const LEGACY_FLOW_ROUTE = "/flow/draft-order-final-fuel-check";
const OAUTH_INSTALL_ROUTE = "/shopify/install";
const OAUTH_CALLBACK_ROUTE = "/shopify/callback";
const WEBHOOK_DRAFT_ORDERS_ROUTE = "/webhooks/draft-orders";
const ADMIN_REGISTER_WEBHOOKS_ROUTE = "/admin/register-webhooks";
const SECRET_HEADER = "x-autospec-flow-secret";
const DEFAULT_SHOPIFY_API_VERSION = "2026-04";
const SHOPIFY_SCOPES = "read_draft_orders,write_draft_orders";
const FFC_SKU = "l-as-ffc";
const WHALE_TAIL_LOCK_SKU = "as-wt";
const CANOPY_LOCK_UPGRADE_SKU = "as-cl-wt";
const MUDFLAP_SKU = "as-mudflap";

const MUDFLAP_UPGRADE_SKUS = new Set(["as-mudflap-350", "as-mudflap-400"]);

const TRAY_SKUS = new Set([
	"as-att-2500-b",
	"as-att-2200-b",
	"as-att-2000-b",
	"as-spct-2000-b",
	"as-sct-2400-b",
	"as-dct-1700-b",
	"as-dct-1700-w",
	"as-3d-sb-1700-b",
	"as-2d-sb-1700-b",
	"as-at1880",
	"as-at2180",
	"as-at2480",
]);

const DRAFT_ORDER_WEBHOOK_TOPICS = new Set(["draft_orders/create", "draft_orders/update"]);
const DRAFT_ORDER_WEBHOOK_REGISTRATION_TOPICS = [
	"DRAFT_ORDERS_CREATE",
	"DRAFT_ORDERS_UPDATE",
] as const;

type AppEnv = Env & {
	AUTOSPEC_STORE_DOMAIN?: string;
	AUTOSPEC_ADMIN_ACCESS_TOKEN?: string;
	AUTOSPEC_FFC_VARIANT_ID?: string;
	AUTOSPEC_WT_VARIANT_ID?: string;
	AUTOSPEC_MUDFLAP_VARIANT_ID?: string;
	LINEX_STORE_DOMAIN?: string;
	LINEX_ADMIN_ACCESS_TOKEN?: string;
	LINEX_FFC_VARIANT_ID?: string;
	LINEX_WT_VARIANT_ID?: string;
	LINEX_MUDFLAP_VARIANT_ID?: string;
	FLOW_SHARED_SECRET?: string;
	SHOPIFY_API_VERSION?: string;
	SHOPIFY_CLIENT_ID?: string;
	SHOPIFY_CLIENT_SECRET?: string;
	OAUTH_STATE_SECRET?: string;
	SHOPIFY_TOKENS?: KVNamespace;
};

type StoreConfig = {
	storeDomain: string;
	legacyAdminAccessToken: string;
	finalFuelCheckVariantId: string;
	whaleTailLockVariantId: string;
	mudflapVariantId: string;
	apiVersion: string;
};

type AuthorizedStoreConfig = StoreConfig & {
	adminAccessToken: string;
};

type StoredToken = {
	accessToken: string;
	refreshToken?: string;
	expiresAt?: number;
	scope?: string;
	installedAt: string;
};

type MoneyInput = {
	amount: string;
	currencyCode: string;
};

type AttributeInput = {
	key: string;
	value: string;
};

type AppliedDiscount = {
	title?: string | null;
	description?: string | null;
	value?: number | null;
	valueType?: string | null;
	amountSet?: {
		presentmentMoney?: MoneyInput | null;
	} | null;
};

type DraftOrderLineItem = {
	variant?: {
		id: string;
		sku?: string | null;
	} | null;
	sku?: string | null;
	quantity: number;
	title?: string | null;
	custom?: boolean | null;
	customAttributes?: AttributeInput[] | null;
	appliedDiscount?: AppliedDiscount | null;
	originalUnitPriceWithCurrency?: MoneyInput | null;
	priceOverride?: MoneyInput | null;
	requiresShipping?: boolean | null;
	taxable?: boolean | null;
	weight?: {
		unit: string;
		value: number;
	} | null;
};

type DraftOrderLineItemInput = {
	variantId?: string;
	title?: string;
	quantity: number;
	customAttributes?: AttributeInput[];
	appliedDiscount?: {
		title?: string;
		description?: string;
		value: number;
		valueType: string;
		amountWithCurrency?: MoneyInput;
	};
	originalUnitPriceWithCurrency?: MoneyInput;
	priceOverride?: MoneyInput;
	requiresShipping?: boolean;
	sku?: string;
	taxable?: boolean;
	weight?: {
		unit: string;
		value: number;
	};
};

type AddonLine = {
	sku: string;
	variantId: string;
	quantity: number;
	free: boolean;
};

type AddonApplyResult =
	| {
			action: "added";
			addedSkus: {
				sku: string;
				quantity: number;
			}[];
			lineItemCount: number;
	  }
	| {
			action: "no_action";
			reason: "no_addon_trigger";
	  }
	| {
			action: "already_exists";
	  }
	| {
			action: "cleaned_up";
			reason: "consolidated_automatic_addons";
			lineItemCount: number;
	  };

type DraftOrderPage = {
	id: string;
	lineItems: {
		nodes: DraftOrderLineItem[];
		pageInfo?: {
			hasNextPage: boolean;
			endCursor: string | null;
		};
	};
};

type WebhookSubscription = {
	id: string;
	topic: (typeof DRAFT_ORDER_WEBHOOK_REGISTRATION_TOPICS)[number];
	uri: string;
};

const DRAFT_ORDER_QUERY = `#graphql
	query DraftOrderForAddons($id: ID!, $after: String) {
		draftOrder(id: $id) {
			id
			lineItems(first: 250, after: $after) {
				nodes {
					variant {
						id
						sku
					}
					sku
					quantity
					title
					custom
					customAttributes {
						key
						value
					}
					appliedDiscount {
						title
						description
						value
						valueType
						amountSet {
							presentmentMoney {
								amount
								currencyCode
							}
						}
					}
					originalUnitPriceWithCurrency {
						amount
						currencyCode
					}
					priceOverride {
						amount
						currencyCode
					}
					requiresShipping
					taxable
					weight {
						unit
						value
					}
				}
				pageInfo {
					hasNextPage
					endCursor
				}
			}
		}
	}
`;

const DRAFT_ORDER_UPDATE_MUTATION = `#graphql
	mutation UpdateDraftOrderAddons($id: ID!, $input: DraftOrderInput!) {
		draftOrderUpdate(id: $id, input: $input) {
			draftOrder {
				id
			}
			userErrors {
				field
				message
			}
		}
	}
`;

const WEBHOOK_SUBSCRIPTIONS_QUERY = `#graphql
	query DraftOrderWebhookSubscriptions($topics: [WebhookSubscriptionTopic!]) {
		webhookSubscriptions(first: 100, topics: $topics) {
			nodes {
				id
				topic
				uri
			}
		}
	}
`;

const WEBHOOK_SUBSCRIPTION_CREATE_MUTATION = `#graphql
	mutation CreateDraftOrderWebhookSubscription(
		$topic: WebhookSubscriptionTopic!
		$webhookSubscription: WebhookSubscriptionInput!
	) {
		webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
			webhookSubscription {
				id
				topic
				uri
			}
			userErrors {
				field
				message
			}
		}
	}
`;

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === OAUTH_INSTALL_ROUTE) {
			return handleOAuthInstall(request, env, url);
		}

		if (url.pathname === OAUTH_CALLBACK_ROUTE) {
			return handleOAuthCallback(request, env, url);
		}

		if (url.pathname === WEBHOOK_DRAFT_ORDERS_ROUTE) {
			if (request.method !== "POST") {
				return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, {
					Allow: "POST",
				});
			}

			return handleDraftOrderWebhook(request, env);
		}

		if (url.pathname === ADMIN_REGISTER_WEBHOOKS_ROUTE) {
			if (request.method !== "POST") {
				return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, {
					Allow: "POST",
				});
			}

			return handleRegisterWebhooksRequest(request, env, url);
		}

		if (url.pathname === FLOW_ROUTE || url.pathname === LEGACY_FLOW_ROUTE) {
			if (request.method !== "POST") {
				return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, {
					Allow: "POST",
				});
			}

			return handleFlowRequest(request, env);
		}

		return jsonResponse({ ok: false, error: "not_found" }, 404);
	},
} satisfies ExportedHandler<AppEnv>;

async function handleOAuthInstall(request: Request, env: AppEnv, url: URL): Promise<Response> {
	if (request.method !== "GET") {
		return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, { Allow: "GET" });
	}

	const oauthConfig = getOAuthConfig(env);
	if (!oauthConfig) {
		return jsonResponse({ ok: false, error: "oauth_configuration_error" }, 500);
	}

	const storeDomain = normalizeStoreDomain(url.searchParams.get("shop") ?? "");
	const store = selectStoreConfig(env, storeDomain);
	if (!store) {
		return jsonResponse({ ok: false, error: "unknown_store_domain" }, 400);
	}

	const state = await createOAuthState(store.storeDomain, oauthConfig.stateSecret);
	const authorizeUrl = new URL(`https://${store.storeDomain}/admin/oauth/authorize`);
	authorizeUrl.searchParams.set("client_id", oauthConfig.clientId);
	authorizeUrl.searchParams.set("scope", SHOPIFY_SCOPES);
	authorizeUrl.searchParams.set("redirect_uri", `${url.origin}${OAUTH_CALLBACK_ROUTE}`);
	authorizeUrl.searchParams.set("state", state);

	return Response.redirect(authorizeUrl.toString(), 302);
}

async function handleOAuthCallback(request: Request, env: AppEnv, url: URL): Promise<Response> {
	if (request.method !== "GET") {
		return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, { Allow: "GET" });
	}

	const oauthConfig = getOAuthConfig(env);
	if (!oauthConfig || !env.SHOPIFY_TOKENS) {
		return jsonResponse({ ok: false, error: "oauth_configuration_error" }, 500);
	}

	const storeDomain = normalizeStoreDomain(url.searchParams.get("shop") ?? "");
	const code = url.searchParams.get("code") ?? "";
	const state = url.searchParams.get("state") ?? "";
	const hmac = url.searchParams.get("hmac") ?? "";

	const store = selectStoreConfig(env, storeDomain);
	if (!store) {
		return jsonResponse({ ok: false, error: "unknown_store_domain" }, 400);
	}

	if (!code || !state || !hmac) {
		return jsonResponse({ ok: false, error: "missing_oauth_callback_fields" }, 400);
	}

	const [stateOk, hmacOk] = await Promise.all([
		validateOAuthState(state, store.storeDomain, oauthConfig.stateSecret),
		validateShopifyCallbackHmac(url.searchParams, oauthConfig.clientSecret),
	]);

	if (!stateOk || !hmacOk) {
		console.warn("fuel_check.oauth_rejected", {
			storeDomain,
			stateOk,
			hmacOk,
		});
		return jsonResponse({ ok: false, error: "invalid_oauth_callback" }, 401);
	}

	const token = await exchangeAuthorizationCodeForToken(store, oauthConfig, code);
	await saveToken(env, store.storeDomain, token);

	console.log("fuel_check.oauth_installed", {
		storeDomain: store.storeDomain,
		scope: token.scope,
		expiresAt: token.expiresAt ?? null,
	});

	return htmlResponse(
		`Shopify install complete for ${escapeHtml(store.storeDomain)}. You can close this tab.`,
	);
}

async function handleFlowRequest(request: Request, env: AppEnv): Promise<Response> {
	if (!env.FLOW_SHARED_SECRET) {
		console.error("fuel_check.configuration_error", { reason: "missing FLOW_SHARED_SECRET" });
		return jsonResponse({ ok: false, error: "configuration_error" }, 500);
	}

	if (request.headers.get(SECRET_HEADER) !== env.FLOW_SHARED_SECRET) {
		console.warn("fuel_check.rejected", { reason: "invalid_secret" });
		return jsonResponse({ ok: false, error: "unauthorized" }, 401);
	}

	const payload = await readPayload(request);
	if (!payload.ok) {
		return jsonResponse({ ok: false, error: payload.error }, 400);
	}

	const draftOrderId = typeof payload.value.draftOrderId === "string" ? payload.value.draftOrderId.trim() : "";
	const storeDomain = normalizeStoreDomain(
		typeof payload.value.storeDomain === "string"
			? payload.value.storeDomain
			: request.headers.get("x-shopify-shop-domain") ?? "",
	);

	console.log("fuel_check.incoming", { storeDomain, draftOrderId });

	if (!draftOrderId) {
		return jsonResponse({ ok: false, error: "missing_draft_order_id" }, 400);
	}

	try {
		const result = await applyDraftOrderAddons(env, storeDomain, draftOrderId, "flow");
		return jsonResponse({ ok: true, ...result });
	} catch (error) {
		if (error instanceof ClientError) {
			return jsonResponse({ ok: false, error: error.code }, error.status);
		}

		console.error("fuel_check.error", {
			storeDomain,
			draftOrderId,
			error: error instanceof Error ? error.message : String(error),
		});
		return jsonResponse({ ok: false, error: "shopify_graphql_error" }, 502);
	}
}

async function handleDraftOrderWebhook(request: Request, env: AppEnv): Promise<Response> {
	if (!env.SHOPIFY_CLIENT_SECRET) {
		console.error("addons.webhook_configuration_error", {
			reason: "missing SHOPIFY_CLIENT_SECRET",
		});
		return jsonResponse({ ok: false, error: "configuration_error" }, 500);
	}

	const rawBody = await request.arrayBuffer();
	const hmac = request.headers.get("x-shopify-hmac-sha256") ?? "";
	const hmacOk = await validateShopifyWebhookHmac(rawBody, hmac, env.SHOPIFY_CLIENT_SECRET);
	if (!hmacOk) {
		console.warn("addons.webhook_rejected", { reason: "invalid_hmac" });
		return jsonResponse({ ok: false, error: "unauthorized" }, 401);
	}

	const topic = (request.headers.get("x-shopify-topic") ?? "").toLowerCase();
	const storeDomain = normalizeStoreDomain(request.headers.get("x-shopify-shop-domain") ?? "");

	if (!DRAFT_ORDER_WEBHOOK_TOPICS.has(topic)) {
		console.log("addons.webhook_ignored", { storeDomain, topic, reason: "unsupported_topic" });
		return jsonResponse({ ok: true, action: "ignored", reason: "unsupported_topic" });
	}

	const bodyText = new TextDecoder().decode(rawBody);
	let payload: Record<string, unknown>;
	try {
		const parsed = JSON.parse(bodyText);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("Webhook payload was not an object");
		}
		payload = parsed as Record<string, unknown>;
	} catch {
		console.warn("addons.webhook_rejected", { storeDomain, topic, reason: "invalid_json_body" });
		return jsonResponse({ ok: false, error: "invalid_json_body" }, 400);
	}

	const draftOrderId = getWebhookDraftOrderId(payload);
	console.log("addons.webhook_incoming", { storeDomain, topic, draftOrderId });

	if (!draftOrderId) {
		return jsonResponse({ ok: true, action: "ignored", reason: "missing_draft_order_id" });
	}

	try {
		const result = await applyDraftOrderAddons(env, storeDomain, draftOrderId, "webhook");
		return jsonResponse({ ok: true, ...result });
	} catch (error) {
		if (error instanceof ClientError) {
			return jsonResponse({ ok: false, error: error.code }, error.status);
		}

		if (isDraftOrderNotFoundError(error)) {
			console.warn("addons.webhook_draft_order_not_found", { storeDomain, topic, draftOrderId });
			return jsonResponse({ ok: true, action: "ignored", reason: "draft_order_not_found" });
		}

		console.error("addons.webhook_error", {
			storeDomain,
			topic,
			draftOrderId,
			error: error instanceof Error ? error.message : String(error),
		});
		return jsonResponse({ ok: false, error: "shopify_graphql_error" }, 502);
	}
}

async function handleRegisterWebhooksRequest(
	request: Request,
	env: AppEnv,
	url: URL,
): Promise<Response> {
	if (!env.FLOW_SHARED_SECRET) {
		console.error("addons.register_webhooks_configuration_error", {
			reason: "missing FLOW_SHARED_SECRET",
		});
		return jsonResponse({ ok: false, error: "configuration_error" }, 500);
	}

	if (request.headers.get(SECRET_HEADER) !== env.FLOW_SHARED_SECRET) {
		console.warn("addons.register_webhooks_rejected", { reason: "invalid_secret" });
		return jsonResponse({ ok: false, error: "unauthorized" }, 401);
	}

	const callbackUrl = `${url.origin}${WEBHOOK_DRAFT_ORDERS_ROUTE}`;
	const stores = getConfiguredStores(env);
	const results = [];

	for (const store of stores) {
		const authorizedStore = await getAuthorizedStoreConfig(env, store);
		if (!authorizedStore) {
			results.push({
				storeDomain: store.storeDomain,
				ok: false,
				error: "shopify_token_not_installed",
			});
			continue;
		}

		try {
			results.push({
				storeDomain: store.storeDomain,
				ok: true,
				webhooks: await ensureDraftOrderWebhookSubscriptions(authorizedStore, callbackUrl),
			});
		} catch (error) {
			console.error("addons.register_webhooks_error", {
				storeDomain: store.storeDomain,
				error: error instanceof Error ? error.message : String(error),
			});
			results.push({
				storeDomain: store.storeDomain,
				ok: false,
				error: "shopify_graphql_error",
			});
		}
	}

	const ok = results.every((result) => result.ok);
	return jsonResponse({ ok, callbackUrl, results }, ok ? 200 : 502);
}

async function applyDraftOrderAddons(
	env: AppEnv,
	storeDomain: string,
	draftOrderId: string,
	source: "flow" | "webhook",
): Promise<AddonApplyResult> {
	const store = selectStoreConfig(env, storeDomain);
	if (!store) {
		console.warn("addons.rejected", { storeDomain, draftOrderId, source, reason: "unknown_store" });
		throw new ClientError("unknown_store_domain", 400);
	}

	if (
		!store.finalFuelCheckVariantId ||
		!store.whaleTailLockVariantId ||
		!store.mudflapVariantId
	) {
		console.error("addons.configuration_error", {
			storeDomain,
			draftOrderId,
			source,
			missingVariantId: !store.finalFuelCheckVariantId,
			missingWhaleTailLockVariantId: !store.whaleTailLockVariantId,
			missingMudflapVariantId: !store.mudflapVariantId,
		});
		throw new ClientError("configuration_error", 500);
	}

	const authorizedStore = await getAuthorizedStoreConfig(env, store);
	if (!authorizedStore) {
		console.error("addons.configuration_error", {
			storeDomain,
			draftOrderId,
			source,
			reason: "missing_shopify_token",
		});
		throw new ClientError("shopify_token_not_installed", 500);
	}

	const lineItems = await fetchAllDraftOrderLineItems(authorizedStore, draftOrderId);
	const addonLines = calculateAddonLines(lineItems, store);

	const rebuilt = buildDraftOrderLineItems(lineItems, addonLines);

	if (addonLines.length === 0 && !rebuilt.changed) {
		if (!hasAddonRuleTrigger(lineItems)) {
			console.log("addons.no_action", {
				storeDomain,
				draftOrderId,
				source,
				reason: "no_addon_trigger",
			});
			return { action: "no_action", reason: "no_addon_trigger" };
		}

		console.log("addons.already_exists", { storeDomain, draftOrderId, source });
		return { action: "already_exists" };
	}

	await updateDraftOrderLineItems(authorizedStore, draftOrderId, rebuilt.lineItems);

	if (addonLines.length === 0 && rebuilt.changed) {
		console.log("addons.cleaned_up", {
			storeDomain,
			draftOrderId,
			source,
			reason: "consolidated_automatic_addons",
		});
		return {
			action: "cleaned_up",
			reason: "consolidated_automatic_addons",
			lineItemCount: rebuilt.lineItems.length,
		};
	}

	console.log("addons.added", { storeDomain, draftOrderId, source });
	return {
		action: "added",
		addedSkus: addonLines.map((addonLine) => ({
			sku: addonLine.sku,
			quantity: addonLine.quantity,
		})),
		lineItemCount: rebuilt.lineItems.length,
	};
}

async function ensureDraftOrderWebhookSubscriptions(
	store: AuthorizedStoreConfig,
	callbackUrl: string,
) {
	const data = await shopifyGraphql<{
		webhookSubscriptions: {
			nodes: WebhookSubscription[];
		};
	}>(store, WEBHOOK_SUBSCRIPTIONS_QUERY, {
		topics: DRAFT_ORDER_WEBHOOK_REGISTRATION_TOPICS,
	});

	const registeredWebhooks = [];
	for (const topic of DRAFT_ORDER_WEBHOOK_REGISTRATION_TOPICS) {
		const existing = data.webhookSubscriptions.nodes.find(
			(webhook) => webhook.topic === topic && webhook.uri === callbackUrl,
		);
		if (existing) {
			registeredWebhooks.push({
				id: existing.id,
				topic,
				uri: existing.uri,
				action: "already_registered",
			});
			continue;
		}

		const created = await createWebhookSubscription(store, topic, callbackUrl);
		registeredWebhooks.push({
			id: created.id,
			topic,
			uri: created.uri,
			action: "registered",
		});
	}

	return registeredWebhooks;
}

async function createWebhookSubscription(
	store: AuthorizedStoreConfig,
	topic: (typeof DRAFT_ORDER_WEBHOOK_REGISTRATION_TOPICS)[number],
	callbackUrl: string,
) {
	const data = await shopifyGraphql<{
		webhookSubscriptionCreate: {
			webhookSubscription: WebhookSubscription | null;
			userErrors: { field: string[] | null; message: string }[];
		};
	}>(store, WEBHOOK_SUBSCRIPTION_CREATE_MUTATION, {
		topic,
		webhookSubscription: {
			uri: callbackUrl,
		},
	});

	const userErrors = data.webhookSubscriptionCreate.userErrors;
	if (userErrors.length > 0 || !data.webhookSubscriptionCreate.webhookSubscription) {
		console.error("addons.register_webhooks_user_errors", {
			storeDomain: store.storeDomain,
			topic,
			userErrors,
		});
		throw new Error(`Shopify webhook subscription user errors: ${JSON.stringify(userErrors)}`);
	}

	return data.webhookSubscriptionCreate.webhookSubscription;
}

async function fetchAllDraftOrderLineItems(store: AuthorizedStoreConfig, draftOrderId: string) {
	const lineItems: DraftOrderLineItem[] = [];
	let after: string | null = null;

	do {
		const data: { draftOrder: DraftOrderPage | null } = await shopifyGraphql(
			store,
			DRAFT_ORDER_QUERY,
			{
				id: draftOrderId,
				after,
			},
		);

		if (!data.draftOrder) {
			throw new Error(`Draft order not found: ${draftOrderId}`);
		}

		lineItems.push(...data.draftOrder.lineItems.nodes);
		after = data.draftOrder.lineItems.pageInfo?.hasNextPage
			? data.draftOrder.lineItems.pageInfo.endCursor
			: null;
	} while (after);

	return lineItems;
}

async function updateDraftOrderLineItems(
	store: AuthorizedStoreConfig,
	draftOrderId: string,
	lineItems: DraftOrderLineItemInput[],
) {
	const data = await shopifyGraphql<{
		draftOrderUpdate: {
			userErrors: { field: string[] | null; message: string }[];
		};
	}>(store, DRAFT_ORDER_UPDATE_MUTATION, {
		id: draftOrderId,
		input: { lineItems },
	});

	const userErrors = data.draftOrderUpdate.userErrors;
	if (userErrors.length > 0) {
		console.error("fuel_check.shopify_user_errors", { draftOrderId, userErrors });
		throw new Error(`Shopify user errors: ${JSON.stringify(userErrors)}`);
	}
}

async function shopifyGraphql<T>(
	store: AuthorizedStoreConfig,
	query: string,
	variables: Record<string, unknown>,
): Promise<T> {
	const response = await fetch(
		`https://${store.storeDomain}/admin/api/${store.apiVersion}/graphql.json`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-shopify-access-token": store.adminAccessToken,
			},
			body: JSON.stringify({ query, variables }),
		},
	);

	const body = (await response.json()) as { data?: T; errors?: unknown };

	if (!response.ok || body.errors) {
		console.error("fuel_check.shopify_graphql_errors", {
			storeDomain: store.storeDomain,
			status: response.status,
			errors: body.errors,
		});
		throw new Error(`Shopify GraphQL failed with status ${response.status}`);
	}

	if (!body.data) {
		throw new Error("Shopify GraphQL response did not include data");
	}

	return body.data;
}

function toDraftOrderLineItemInput(lineItem: DraftOrderLineItem): DraftOrderLineItemInput {
	const input: DraftOrderLineItemInput = {
		quantity: lineItem.quantity,
	};

	if (lineItem.variant?.id) {
		input.variantId = lineItem.variant.id;
	} else {
		input.title = lineItem.title ?? "Custom item";
		if (lineItem.originalUnitPriceWithCurrency) {
			input.originalUnitPriceWithCurrency = lineItem.originalUnitPriceWithCurrency;
		}
		copyDefined(input, "requiresShipping", lineItem.requiresShipping);
		copyDefined(input, "sku", lineItem.sku);
		copyDefined(input, "taxable", lineItem.taxable);
		copyDefined(input, "weight", lineItem.weight);
	}

	if (lineItem.customAttributes) {
		input.customAttributes = lineItem.customAttributes;
	}

	if (lineItem.appliedDiscount?.value != null && lineItem.appliedDiscount.valueType) {
		input.appliedDiscount = {
			value: lineItem.appliedDiscount.value,
			valueType: lineItem.appliedDiscount.valueType,
		};
		copyDefined(input.appliedDiscount, "title", lineItem.appliedDiscount.title);
		copyDefined(input.appliedDiscount, "description", lineItem.appliedDiscount.description);

		if (lineItem.appliedDiscount.amountSet?.presentmentMoney) {
			input.appliedDiscount.amountWithCurrency = lineItem.appliedDiscount.amountSet.presentmentMoney;
		}
	}

	if (lineItem.variant?.id && lineItem.priceOverride) {
		input.priceOverride = lineItem.priceOverride;
	}

	return input;
}

function calculateAddonLines(lineItems: DraftOrderLineItem[], store: StoreConfig): AddonLine[] {
	const skus = lineItems.flatMap((lineItem) => [
		normalizeSku(lineItem.sku),
		normalizeSku(lineItem.variant?.sku),
	]);
	const uniqueSkus = new Set(skus);
	const addonLines: AddonLine[] = [];

	if (skus.some((sku) => TRAY_SKUS.has(sku)) && !uniqueSkus.has(FFC_SKU)) {
		addonLines.push({
			sku: "L-AS-FFC",
			variantId: store.finalFuelCheckVariantId,
			quantity: 1,
			free: false,
		});
	}

	const { wtQty, mfQty } = calculateAccessoryAddonQuantities(lineItems);
	if (wtQty > 0) {
		addonLines.push({
			sku: "AS-WT",
			variantId: store.whaleTailLockVariantId,
			quantity: wtQty,
			free: true,
		});
	}

	if (mfQty > 0) {
		addonLines.push({
			sku: "AS-MUDFLAP",
			variantId: store.mudflapVariantId,
			quantity: mfQty,
			free: true,
		});
	}

	return addonLines;
}

function calculateAccessoryAddonQuantities(lineItems: DraftOrderLineItem[]) {
	let wtRequired = 0;
	let mfRequired = 0;
	let canopyQty = 0;
	let existingWt = 0;
	let existingMudflap = 0;
	let hasCanopyLockUpgrade = false;
	let hasMudflapUpgrade = false;

	for (const lineItem of lineItems) {
		const sku = normalizeSku(lineItem.sku || lineItem.variant?.sku);
		if (!sku) {
			continue;
		}

		if (sku === WHALE_TAIL_LOCK_SKU) {
			existingWt += lineItem.quantity;
			continue;
		}

		if (sku === CANOPY_LOCK_UPGRADE_SKU) {
			hasCanopyLockUpgrade = true;
			continue;
		}

		if (sku === MUDFLAP_SKU) {
			existingMudflap += lineItem.quantity;
			continue;
		}

		if (MUDFLAP_UPGRADE_SKUS.has(sku)) {
			hasMudflapUpgrade = true;
			continue;
		}

		if (sku.startsWith("as-sutt-") || sku.startsWith("as-tutt-")) {
			wtRequired += lineItem.quantity * 2;
			continue;
		}

		if (sku.startsWith("as-c-")) {
			canopyQty += lineItem.quantity;
			continue;
		}

		if (TRAY_SKUS.has(sku)) {
			wtRequired += lineItem.quantity;
			mfRequired += lineItem.quantity;
		}
	}

	if (!hasCanopyLockUpgrade) {
		wtRequired += canopyQty * 4;
	}

	if (hasMudflapUpgrade) {
		mfRequired = 0;
	}

	return {
		wtQty: Math.max(0, wtRequired - existingWt),
		mfQty: Math.max(0, mfRequired - existingMudflap),
	};
}

function hasAddonRuleTrigger(lineItems: DraftOrderLineItem[]) {
	return lineItems.some((lineItem) => {
		const sku = normalizeSku(lineItem.sku || lineItem.variant?.sku);
		return (
			TRAY_SKUS.has(sku) ||
			sku.startsWith("as-sutt-") ||
			sku.startsWith("as-tutt-") ||
			sku.startsWith("as-c-")
		);
	});
}

function toAddonLineItemInput(addonLine: AddonLine): DraftOrderLineItemInput {
	const input: DraftOrderLineItemInput = {
		variantId: addonLine.variantId,
		quantity: addonLine.quantity,
	};

	if (addonLine.free) {
		input.appliedDiscount = {
			title: "Automatic add-on",
			value: 100,
			valueType: "PERCENTAGE",
		};
	}

	return input;
}

function buildDraftOrderLineItems(lineItems: DraftOrderLineItem[], addonLines: AddonLine[]) {
	const rebuiltLineItems: DraftOrderLineItemInput[] = [];
	const mergeableAddonIndexes = new Map<string, number>();
	let changed = false;

	for (const lineItem of lineItems) {
		const ownedAddonKey = getOwnedAutomaticAddonKey(lineItem);
		if (ownedAddonKey) {
			const existingIndex = mergeableAddonIndexes.get(ownedAddonKey);
			if (existingIndex != null) {
				rebuiltLineItems[existingIndex].quantity += lineItem.quantity;
				changed = true;
				continue;
			}
		}

		const rebuiltLineItem = toDraftOrderLineItemInput(lineItem);
		if (ownedAddonKey) {
			mergeableAddonIndexes.set(ownedAddonKey, rebuiltLineItems.length);
		}
		rebuiltLineItems.push(rebuiltLineItem);
	}

	for (const addonLine of addonLines) {
		const mergeIndex = addonLine.free ? mergeableAddonIndexes.get(addonLine.variantId) : undefined;
		if (mergeIndex != null) {
			rebuiltLineItems[mergeIndex].quantity += addonLine.quantity;
			changed = true;
			continue;
		}

		rebuiltLineItems.push(toAddonLineItemInput(addonLine));
	}

	return {
		lineItems: rebuiltLineItems,
		changed,
	};
}

function getOwnedAutomaticAddonKey(lineItem: DraftOrderLineItem): string {
	if (!lineItem.variant?.id || !isAutomaticAddonDiscount(lineItem.appliedDiscount)) {
		return "";
	}

	return lineItem.variant.id;
}

function isAutomaticAddonDiscount(discount: AppliedDiscount | null | undefined): boolean {
	return (
		discount?.title === "Automatic add-on" &&
		discount.value === 100 &&
		discount.valueType === "PERCENTAGE"
	);
}

function selectStoreConfig(env: AppEnv, storeDomain: string): StoreConfig | null {
	return getConfiguredStores(env).find((store) => store.storeDomain === storeDomain) ?? null;
}

function getConfiguredStores(env: AppEnv): StoreConfig[] {
	const apiVersion = env.SHOPIFY_API_VERSION || DEFAULT_SHOPIFY_API_VERSION;
	return [
		{
			storeDomain: normalizeStoreDomain(env.AUTOSPEC_STORE_DOMAIN ?? ""),
			legacyAdminAccessToken: env.AUTOSPEC_ADMIN_ACCESS_TOKEN ?? "",
			finalFuelCheckVariantId: env.AUTOSPEC_FFC_VARIANT_ID ?? "",
			whaleTailLockVariantId: env.AUTOSPEC_WT_VARIANT_ID ?? "",
			mudflapVariantId: env.AUTOSPEC_MUDFLAP_VARIANT_ID ?? "",
			apiVersion,
		},
		{
			storeDomain: normalizeStoreDomain(env.LINEX_STORE_DOMAIN ?? ""),
			legacyAdminAccessToken: env.LINEX_ADMIN_ACCESS_TOKEN ?? "",
			finalFuelCheckVariantId: env.LINEX_FFC_VARIANT_ID ?? "",
			whaleTailLockVariantId: env.LINEX_WT_VARIANT_ID ?? "",
			mudflapVariantId: env.LINEX_MUDFLAP_VARIANT_ID ?? "",
			apiVersion,
		},
	].filter((store) => store.storeDomain);
}

async function getAuthorizedStoreConfig(
	env: AppEnv,
	store: StoreConfig,
): Promise<AuthorizedStoreConfig | null> {
	const token = await getUsableToken(env, store);
	if (!token) {
		return null;
	}

	return {
		...store,
		adminAccessToken: token,
	};
}

async function getUsableToken(env: AppEnv, store: StoreConfig): Promise<string | null> {
	const storedToken = await loadToken(env, store.storeDomain);
	if (!storedToken) {
		return store.legacyAdminAccessToken || null;
	}

	const refreshThresholdMs = 5 * 60 * 1000;
	if (!storedToken.expiresAt || storedToken.expiresAt - Date.now() > refreshThresholdMs) {
		return storedToken.accessToken;
	}

	if (!storedToken.refreshToken) {
		return storedToken.accessToken;
	}

	const oauthConfig = getOAuthConfig(env);
	if (!oauthConfig) {
		return storedToken.accessToken;
	}

	const refreshedToken = await refreshToken(store, oauthConfig, storedToken.refreshToken);
	await saveToken(env, store.storeDomain, refreshedToken);

	return refreshedToken.accessToken;
}

async function loadToken(env: AppEnv, storeDomain: string): Promise<StoredToken | null> {
	const rawToken = await env.SHOPIFY_TOKENS?.get(tokenKey(storeDomain));
	if (!rawToken) {
		return null;
	}

	try {
		const token = JSON.parse(rawToken) as Partial<StoredToken>;
		if (typeof token.accessToken !== "string") {
			return null;
		}

		return token as StoredToken;
	} catch {
		return null;
	}
}

async function saveToken(env: AppEnv, storeDomain: string, token: StoredToken): Promise<void> {
	if (!env.SHOPIFY_TOKENS) {
		throw new Error("SHOPIFY_TOKENS KV binding is missing");
	}

	await env.SHOPIFY_TOKENS.put(tokenKey(storeDomain), JSON.stringify(token));
}

async function exchangeAuthorizationCodeForToken(
	store: StoreConfig,
	oauthConfig: OAuthConfig,
	code: string,
): Promise<StoredToken> {
	const body = new URLSearchParams({
		client_id: oauthConfig.clientId,
		client_secret: oauthConfig.clientSecret,
		code,
		expiring: "1",
	});

	return postTokenRequest(store, body);
}

async function refreshToken(
	store: StoreConfig,
	oauthConfig: OAuthConfig,
	refreshTokenValue: string,
): Promise<StoredToken> {
	const body = new URLSearchParams({
		client_id: oauthConfig.clientId,
		client_secret: oauthConfig.clientSecret,
		grant_type: "refresh_token",
		refresh_token: refreshTokenValue,
	});

	return postTokenRequest(store, body);
}

async function postTokenRequest(store: StoreConfig, body: URLSearchParams): Promise<StoredToken> {
	const response = await fetch(`https://${store.storeDomain}/admin/oauth/access_token`, {
		method: "POST",
		headers: {
			accept: "application/json",
			"content-type": "application/x-www-form-urlencoded",
		},
		body,
	});

	const tokenBody = (await response.json()) as {
		access_token?: string;
		refresh_token?: string;
		expires_in?: number;
		scope?: string;
		error?: string;
		error_description?: string;
	};

	if (!response.ok || !tokenBody.access_token) {
		console.error("fuel_check.oauth_token_error", {
			storeDomain: store.storeDomain,
			status: response.status,
			error: tokenBody.error,
			errorDescription: tokenBody.error_description,
		});
		throw new Error(`Shopify OAuth token request failed with status ${response.status}`);
	}

	const now = Date.now();
	return {
		accessToken: tokenBody.access_token,
		refreshToken: tokenBody.refresh_token,
		expiresAt: tokenBody.expires_in ? now + tokenBody.expires_in * 1000 : undefined,
		scope: tokenBody.scope,
		installedAt: new Date(now).toISOString(),
	};
}

type OAuthConfig = {
	clientId: string;
	clientSecret: string;
	stateSecret: string;
};

function getOAuthConfig(env: AppEnv): OAuthConfig | null {
	if (!env.SHOPIFY_CLIENT_ID || !env.SHOPIFY_CLIENT_SECRET) {
		return null;
	}

	return {
		clientId: env.SHOPIFY_CLIENT_ID,
		clientSecret: env.SHOPIFY_CLIENT_SECRET,
		stateSecret: env.OAUTH_STATE_SECRET || env.FLOW_SHARED_SECRET || env.SHOPIFY_CLIENT_SECRET,
	};
}

async function createOAuthState(storeDomain: string, stateSecret: string): Promise<string> {
	const payload = {
		shop: storeDomain,
		ts: Date.now(),
		nonce: crypto.randomUUID(),
	};
	const encodedPayload = base64UrlEncode(JSON.stringify(payload));
	const signature = await hmacSha256Hex(stateSecret, encodedPayload);

	return `${encodedPayload}.${signature}`;
}

async function validateOAuthState(
	state: string,
	storeDomain: string,
	stateSecret: string,
): Promise<boolean> {
	const [encodedPayload, signature] = state.split(".");
	if (!encodedPayload || !signature) {
		return false;
	}

	const expectedSignature = await hmacSha256Hex(stateSecret, encodedPayload);
	if (!timingSafeEqual(signature, expectedSignature)) {
		return false;
	}

	try {
		const payload = JSON.parse(base64UrlDecode(encodedPayload)) as { shop?: string; ts?: number };
		const maxAgeMs = 10 * 60 * 1000;

		return (
			normalizeStoreDomain(payload.shop ?? "") === storeDomain &&
			typeof payload.ts === "number" &&
			Date.now() - payload.ts <= maxAgeMs
		);
	} catch {
		return false;
	}
}

async function validateShopifyCallbackHmac(
	searchParams: URLSearchParams,
	clientSecret: string,
): Promise<boolean> {
	const hmac = searchParams.get("hmac") ?? "";
	const message = [...searchParams.entries()]
		.filter(([key]) => key !== "hmac" && key !== "signature")
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, value]) => `${key}=${value}`)
		.join("&");
	const expectedHmac = await hmacSha256Hex(clientSecret, message);

	return timingSafeEqual(hmac, expectedHmac);
}

async function validateShopifyWebhookHmac(
	rawBody: ArrayBuffer,
	hmac: string,
	clientSecret: string,
): Promise<boolean> {
	if (!hmac) {
		return false;
	}

	const expectedHmac = await hmacSha256Base64(clientSecret, rawBody);
	return timingSafeEqual(hmac, expectedHmac);
}

function getWebhookDraftOrderId(payload: Record<string, unknown>): string {
	const graphqlId = payload.admin_graphql_api_id;
	if (typeof graphqlId === "string" && graphqlId.startsWith("gid://shopify/DraftOrder/")) {
		return graphqlId;
	}

	const legacyId = payload.id;
	if (typeof legacyId === "number" && Number.isFinite(legacyId)) {
		return `gid://shopify/DraftOrder/${legacyId}`;
	}

	if (typeof legacyId === "string" && /^\d+$/.test(legacyId)) {
		return `gid://shopify/DraftOrder/${legacyId}`;
	}

	return "";
}

function isDraftOrderNotFoundError(error: unknown): boolean {
	return error instanceof Error && error.message.startsWith("Draft order not found:");
}

async function readPayload(request: Request): Promise<
	| {
			ok: true;
			value: Record<string, unknown>;
	  }
	| {
			ok: false;
			error: string;
	  }
> {
	try {
		const value = await request.json();
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			return { ok: false, error: "invalid_json_body" };
		}

		return { ok: true, value: value as Record<string, unknown> };
	} catch {
		return { ok: false, error: "invalid_json_body" };
	}
}

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}) {
	return Response.json(body, {
		status,
		headers: {
			...headers,
			"cache-control": "no-store",
		},
	});
}

function htmlResponse(message: string) {
	return new Response(
		`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Shopify Install Complete</title></head><body><p>${message}</p></body></html>`,
		{
			headers: {
				"cache-control": "no-store",
				"content-type": "text/html; charset=utf-8",
			},
		},
	);
}

function normalizeStoreDomain(value: string) {
	return value
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, "")
		.replace(/\/.*$/, "");
}

function normalizeSku(value: string | null | undefined) {
	return value?.trim().toLowerCase() ?? "";
}

function copyDefined<T extends object, K extends string, V>(
	target: T,
	key: K,
	value: V | null | undefined,
): void {
	if (value != null) {
		(target as Record<K, V>)[key] = value;
	}
}

function tokenKey(storeDomain: string) {
	return `shopify-token:${normalizeStoreDomain(storeDomain)}`;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));

	return [...new Uint8Array(signature)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

async function hmacSha256Base64(secret: string, message: ArrayBuffer): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, message);

	return arrayBufferToBase64(signature);
}

function arrayBufferToBase64(value: ArrayBuffer): string {
	let binary = "";
	for (const byte of new Uint8Array(value)) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function timingSafeEqual(left: string, right: string): boolean {
	if (left.length !== right.length) {
		return false;
	}

	let result = 0;
	for (let index = 0; index < left.length; index += 1) {
		result |= left.charCodeAt(index) ^ right.charCodeAt(index);
	}

	return result === 0;
}

function base64UrlEncode(value: string): string {
	return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): string {
	const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), "=");
	return atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

class ClientError extends Error {
	constructor(
		readonly code: string,
		readonly status: number,
	) {
		super(code);
	}
}
