import { describe, expect, it, vi } from "vitest";

import worker from "./index";

const env = {
	AUTOSPEC_STORE_DOMAIN: "autospec-group.myshopify.com",
	AUTOSPEC_ADMIN_ACCESS_TOKEN: "autospec-token",
	AUTOSPEC_FFC_VARIANT_ID: "gid://shopify/ProductVariant/52009214443840",
	AUTOSPEC_WT_VARIANT_ID: "gid://shopify/ProductVariant/50506355179840",
	AUTOSPEC_MUDFLAP_VARIANT_ID: "gid://shopify/ProductVariant/50595298017600",
	LINEX_STORE_DOMAIN: "line-x-australia.myshopify.com",
	LINEX_ADMIN_ACCESS_TOKEN: "linex-token",
	LINEX_FFC_VARIANT_ID: "gid://shopify/ProductVariant/222",
	LINEX_WT_VARIANT_ID: "gid://shopify/ProductVariant/333",
	LINEX_MUDFLAP_VARIANT_ID: "gid://shopify/ProductVariant/444",
	FLOW_SHARED_SECRET: "flow-secret",
	SHOPIFY_API_VERSION: "2026-04",
	SHOPIFY_CLIENT_SECRET: "client-secret",
	SHOPIFY_TOKENS: {
		get: vi.fn().mockResolvedValue(null),
	},
} as const;

function flowRequest(body: unknown, secret = "flow-secret") {
	return new Request("https://worker.example.com/flow/draft-order-addons", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-autospec-flow-secret": secret,
		},
		body: JSON.stringify(body),
	});
}

async function webhookRequest(body: Record<string, unknown>, overrides: HeadersInit = {}) {
	const rawBody = JSON.stringify(body);
	const headers = new Headers({
		"content-type": "application/json",
		"x-shopify-topic": "draft_orders/update",
		"x-shopify-shop-domain": "autospec-group.myshopify.com",
		"x-shopify-hmac-sha256": await hmacSha256Base64("client-secret", rawBody),
		...overrides,
	});

	return new Request("https://worker.example.com/webhooks/draft-orders", {
		method: "POST",
		headers,
		body: rawBody,
	});
}

describe("draft order add-ons Flow endpoint", () => {
	it("preserves every existing draft order line item and appends L-AS-FFC once", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json({
					data: {
						draftOrder: {
							id: "gid://shopify/DraftOrder/1",
							lineItems: {
								nodes: [
									{
										id: "gid://shopify/DraftOrderLineItem/1",
										variant: { id: "gid://shopify/ProductVariant/111", sku: "AS-ATT-2500-B" },
										sku: "AS-ATT-2500-B",
										quantity: 2,
										title: "Tray",
										custom: false,
										customAttributes: [],
										appliedDiscount: null,
										originalUnitPriceWithCurrency: null,
										requiresShipping: true,
										taxable: true,
										weight: null,
									},
									{
										id: "gid://shopify/DraftOrderLineItem/2",
										variant: null,
										sku: "CUSTOM-FEE",
										quantity: 1,
										title: "Custom fitting fee",
										custom: true,
										customAttributes: [{ key: "source", value: "sales" }],
										appliedDiscount: null,
										originalUnitPriceWithCurrency: { amount: "50.00", currencyCode: "AUD" },
										requiresShipping: false,
										taxable: true,
										weight: null,
									},
								],
							},
						},
					},
				}),
			)
			.mockResolvedValueOnce(
				Response.json({
					data: {
						draftOrderUpdate: {
							draftOrder: { id: "gid://shopify/DraftOrder/1" },
							userErrors: [],
						},
					},
				}),
			);

		vi.stubGlobal("fetch", fetchMock);

		const response = await worker.fetch(
			flowRequest({
				draftOrderId: "gid://shopify/DraftOrder/1",
				storeDomain: "autospec-group.myshopify.com",
			}) as any,
			env as any,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({ action: "added" });
		expect(fetchMock).toHaveBeenCalledTimes(2);

		const updateBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
		expect(updateBody.variables.input.lineItems).toEqual([
			{
				variantId: "gid://shopify/ProductVariant/111",
				quantity: 2,
				customAttributes: [],
			},
			{
				title: "Custom fitting fee",
				quantity: 1,
				customAttributes: [{ key: "source", value: "sales" }],
				originalUnitPriceWithCurrency: { amount: "50.00", currencyCode: "AUD" },
				requiresShipping: false,
				sku: "CUSTOM-FEE",
				taxable: true,
			},
			{
				variantId: "gid://shopify/ProductVariant/52009214443840",
				quantity: 1,
			},
			{
				variantId: "gid://shopify/ProductVariant/50506355179840",
				quantity: 2,
				appliedDiscount: {
					title: "Automatic add-on",
					value: 100,
					valueType: "PERCENTAGE",
				},
			},
			{
				variantId: "gid://shopify/ProductVariant/50595298017600",
				quantity: 2,
				appliedDiscount: {
					title: "Automatic add-on",
					value: 100,
					valueType: "PERCENTAGE",
				},
			},
		]);
	});

	it("adds free whale tail locks from canopy and toolbox quantities after subtracting existing locks", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json({
					data: {
						draftOrder: {
							id: "gid://shopify/DraftOrder/1",
							lineItems: {
								nodes: [
									testLineItem("AS-C-1400-B", 1),
									testLineItem("AS-TUTT-900-B", 1),
									testLineItem("AS-WT", 2, "gid://shopify/ProductVariant/50506355179840"),
								],
							},
						},
					},
				}),
			)
			.mockResolvedValueOnce(
				Response.json({
					data: {
						draftOrderUpdate: {
							draftOrder: { id: "gid://shopify/DraftOrder/1" },
							userErrors: [],
						},
					},
				}),
			);

		vi.stubGlobal("fetch", fetchMock);

		const response = await worker.fetch(
			flowRequest({
				draftOrderId: "gid://shopify/DraftOrder/1",
				storeDomain: "autospec-group.myshopify.com",
			}) as any,
			env as any,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			action: "added",
			addedSkus: [{ sku: "AS-WT", quantity: 4 }],
		});

		const updateBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
		expect(updateBody.variables.input.lineItems.at(-1)).toEqual({
			variantId: "gid://shopify/ProductVariant/50506355179840",
			quantity: 4,
			appliedDiscount: {
				title: "Automatic add-on",
				value: 100,
				valueType: "PERCENTAGE",
			},
		});
	});

	it("merges extra free whale tail lock quantity into the existing automatic add-on line", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json({
					data: {
						draftOrder: {
							id: "gid://shopify/DraftOrder/1",
							lineItems: {
								nodes: [
									testLineItem("AS-DCT-1700-B", 1),
									testLineItem("AS-C-1000-B", 1),
									testLineItem("AS-WT", 1, "gid://shopify/ProductVariant/50506355179840", {
										title: "Automatic add-on",
										value: 100,
										valueType: "PERCENTAGE",
									}),
									testLineItem("L-AS-FFC", 1, "gid://shopify/ProductVariant/52009214443840"),
									testLineItem("AS-MUDFLAP", 1, "gid://shopify/ProductVariant/50595298017600", {
										title: "Automatic add-on",
										value: 100,
										valueType: "PERCENTAGE",
									}),
								],
							},
						},
					},
				}),
			)
			.mockResolvedValueOnce(
				Response.json({
					data: {
						draftOrderUpdate: {
							draftOrder: { id: "gid://shopify/DraftOrder/1" },
							userErrors: [],
						},
					},
				}),
			);

		vi.stubGlobal("fetch", fetchMock);

		const response = await worker.fetch(
			flowRequest({
				draftOrderId: "gid://shopify/DraftOrder/1",
				storeDomain: "autospec-group.myshopify.com",
			}) as any,
			env as any,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			action: "added",
			addedSkus: [{ sku: "AS-WT", quantity: 4 }],
		});

		const updateBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
		const lineItems = updateBody.variables.input.lineItems;
		expect(
			lineItems.filter(
				(lineItem: { variantId?: string }) =>
					lineItem.variantId === "gid://shopify/ProductVariant/50506355179840",
			),
		).toEqual([
			{
				variantId: "gid://shopify/ProductVariant/50506355179840",
				quantity: 5,
				customAttributes: [],
				appliedDiscount: {
					title: "Automatic add-on",
					value: 100,
					valueType: "PERCENTAGE",
				},
			},
		]);
		expect(lineItems).toHaveLength(5);
	});

	it("merges existing free add-on lines even when Shopify returns no discount title", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json({
					data: {
						draftOrder: {
							id: "gid://shopify/DraftOrder/1",
							lineItems: {
								nodes: [
									testLineItem("AS-DCT-1700-B", 1),
									testLineItem("AS-C-1000-B", 1),
									testLineItem("AS-WT", 1, "gid://shopify/ProductVariant/50506355179840", {
										title: null,
										value: 100,
										valueType: "PERCENTAGE",
									}),
									testLineItem("L-AS-FFC", 1, "gid://shopify/ProductVariant/52009214443840"),
									testLineItem("AS-MUDFLAP", 1, "gid://shopify/ProductVariant/50595298017600", {
										title: null,
										value: 100,
										valueType: "PERCENTAGE",
									}),
								],
							},
						},
					},
				}),
			)
			.mockResolvedValueOnce(
				Response.json({
					data: {
						draftOrderUpdate: {
							draftOrder: { id: "gid://shopify/DraftOrder/1" },
							userErrors: [],
						},
					},
				}),
			);

		vi.stubGlobal("fetch", fetchMock);

		const response = await worker.fetch(
			flowRequest({
				draftOrderId: "gid://shopify/DraftOrder/1",
				storeDomain: "autospec-group.myshopify.com",
			}) as any,
			env as any,
		);

		expect(response.status).toBe(200);

		const updateBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
		expect(
			updateBody.variables.input.lineItems.filter(
				(lineItem: { variantId?: string }) =>
					lineItem.variantId === "gid://shopify/ProductVariant/50506355179840",
			),
		).toEqual([
			{
				variantId: "gid://shopify/ProductVariant/50506355179840",
				quantity: 5,
				customAttributes: [],
				appliedDiscount: {
					value: 100,
					valueType: "PERCENTAGE",
				},
			},
		]);
	});

	it("consolidates duplicate automatic add-on lines owned by the Worker", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json({
					data: {
						draftOrder: {
							id: "gid://shopify/DraftOrder/1",
							lineItems: {
								nodes: [
									testLineItem("AS-DCT-1700-B", 1),
									testLineItem("AS-C-1000-B", 1),
									testLineItem("AS-WT", 1, "gid://shopify/ProductVariant/50506355179840", {
										title: "Automatic add-on",
										value: 100,
										valueType: "PERCENTAGE",
									}),
									testLineItem("AS-WT", 4, "gid://shopify/ProductVariant/50506355179840", {
										title: "Automatic add-on",
										value: 100,
										valueType: "PERCENTAGE",
									}),
									testLineItem("L-AS-FFC", 1, "gid://shopify/ProductVariant/52009214443840"),
									testLineItem("AS-MUDFLAP", 1, "gid://shopify/ProductVariant/50595298017600", {
										title: "Automatic add-on",
										value: 100,
										valueType: "PERCENTAGE",
									}),
								],
							},
						},
					},
				}),
			)
			.mockResolvedValueOnce(
				Response.json({
					data: {
						draftOrderUpdate: {
							draftOrder: { id: "gid://shopify/DraftOrder/1" },
							userErrors: [],
						},
					},
				}),
			);

		vi.stubGlobal("fetch", fetchMock);

		const response = await worker.fetch(
			flowRequest({
				draftOrderId: "gid://shopify/DraftOrder/1",
				storeDomain: "autospec-group.myshopify.com",
			}) as any,
			env as any,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			action: "cleaned_up",
			reason: "consolidated_automatic_addons",
		});

		const updateBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
		const lineItems = updateBody.variables.input.lineItems;
		expect(
			lineItems.filter(
				(lineItem: { variantId?: string }) =>
					lineItem.variantId === "gid://shopify/ProductVariant/50506355179840",
			),
		).toEqual([
			{
				variantId: "gid://shopify/ProductVariant/50506355179840",
				quantity: 5,
				customAttributes: [],
				appliedDiscount: {
					title: "Automatic add-on",
					value: 100,
					valueType: "PERCENTAGE",
				},
			},
		]);
		expect(lineItems).toHaveLength(5);
	});

	it("suppresses mudflap additions when a mudflap upgrade is already selected", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json({
					data: {
						draftOrder: {
							id: "gid://shopify/DraftOrder/1",
							lineItems: {
								nodes: [
									testLineItem("AS-DCT-1700-B", 1),
									testLineItem("AS-MUDFLAP-350", 1),
								],
							},
						},
					},
				}),
			)
			.mockResolvedValueOnce(
				Response.json({
					data: {
						draftOrderUpdate: {
							draftOrder: { id: "gid://shopify/DraftOrder/1" },
							userErrors: [],
						},
					},
				}),
			);

		vi.stubGlobal("fetch", fetchMock);

		const response = await worker.fetch(
			flowRequest({
				draftOrderId: "gid://shopify/DraftOrder/1",
				storeDomain: "autospec-group.myshopify.com",
			}) as any,
			env as any,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			action: "added",
			addedSkus: [
				{ sku: "L-AS-FFC", quantity: 1 },
				{ sku: "AS-WT", quantity: 1 },
			],
		});

		const updateBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
		expect(updateBody.variables.input.lineItems).not.toContainEqual(
			expect.objectContaining({
				variantId: "gid://shopify/ProductVariant/50595298017600",
			}),
		);
	});

	it("does not update Shopify when L-AS-FFC already exists", async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce(
			Response.json({
				data: {
					draftOrder: {
						id: "gid://shopify/DraftOrder/1",
						lineItems: {
							nodes: [
								{
									variant: { id: "gid://shopify/ProductVariant/111", sku: "as-att-2500-b" },
									sku: "as-att-2500-b",
									quantity: 1,
									title: "Tray",
									custom: false,
									customAttributes: [],
									appliedDiscount: null,
									originalUnitPriceWithCurrency: null,
									requiresShipping: true,
									taxable: true,
									weight: null,
								},
								{
									variant: {
										id: "gid://shopify/ProductVariant/52009214443840",
										sku: "L-AS-FFC",
									},
									sku: "L-AS-FFC",
									quantity: 1,
									title: "Final fuel check",
									custom: false,
									customAttributes: [],
									appliedDiscount: null,
									originalUnitPriceWithCurrency: null,
									requiresShipping: true,
									taxable: true,
									weight: null,
								},
								{
									variant: {
										id: "gid://shopify/ProductVariant/50506355179840",
										sku: "AS-WT",
									},
									sku: "AS-WT",
									quantity: 1,
									title: "Whale Tail Lock",
									custom: false,
									customAttributes: [],
									appliedDiscount: null,
									originalUnitPriceWithCurrency: null,
									requiresShipping: true,
									taxable: true,
									weight: null,
								},
								{
									variant: {
										id: "gid://shopify/ProductVariant/50595298017600",
										sku: "AS-MUDFLAP",
									},
									sku: "AS-MUDFLAP",
									quantity: 1,
									title: "Mudflaps",
									custom: false,
									customAttributes: [],
									appliedDiscount: null,
									originalUnitPriceWithCurrency: null,
									requiresShipping: true,
									taxable: true,
									weight: null,
								},
							],
						},
					},
				},
			}),
		);

		vi.stubGlobal("fetch", fetchMock);

		const response = await worker.fetch(
			flowRequest({
				draftOrderId: "gid://shopify/DraftOrder/1",
				storeDomain: "autospec-group.myshopify.com",
			}) as any,
			env as any,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({ action: "already_exists" });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("keeps the legacy final-fuel-check endpoint working while Flows are migrated", async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce(
			Response.json({
				data: {
					draftOrder: {
						id: "gid://shopify/DraftOrder/1",
						lineItems: {
							nodes: [
								{
									variant: { id: "gid://shopify/ProductVariant/111", sku: "as-att-2500-b" },
									sku: "as-att-2500-b",
									quantity: 1,
									title: "Tray",
									custom: false,
									customAttributes: [],
									appliedDiscount: null,
									originalUnitPriceWithCurrency: null,
									requiresShipping: true,
									taxable: true,
									weight: null,
								},
								{
									variant: {
										id: "gid://shopify/ProductVariant/52009214443840",
										sku: "L-AS-FFC",
									},
									sku: "L-AS-FFC",
									quantity: 1,
									title: "Final fuel check",
									custom: false,
									customAttributes: [],
									appliedDiscount: null,
									originalUnitPriceWithCurrency: null,
									requiresShipping: true,
									taxable: true,
									weight: null,
								},
								{
									variant: {
										id: "gid://shopify/ProductVariant/50506355179840",
										sku: "AS-WT",
									},
									sku: "AS-WT",
									quantity: 1,
									title: "Whale Tail Lock",
									custom: false,
									customAttributes: [],
									appliedDiscount: null,
									originalUnitPriceWithCurrency: null,
									requiresShipping: true,
									taxable: true,
									weight: null,
								},
								{
									variant: {
										id: "gid://shopify/ProductVariant/50595298017600",
										sku: "AS-MUDFLAP",
									},
									sku: "AS-MUDFLAP",
									quantity: 1,
									title: "Mudflaps",
									custom: false,
									customAttributes: [],
									appliedDiscount: null,
									originalUnitPriceWithCurrency: null,
									requiresShipping: true,
									taxable: true,
									weight: null,
								},
							],
						},
					},
				},
			}),
		);

		vi.stubGlobal("fetch", fetchMock);

		const response = await worker.fetch(
			new Request("https://worker.example.com/flow/draft-order-final-fuel-check", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-autospec-flow-secret": "flow-secret",
				},
				body: JSON.stringify({
					draftOrderId: "gid://shopify/DraftOrder/1",
					storeDomain: "autospec-group.myshopify.com",
				}),
			}) as any,
			env as any,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({ action: "already_exists" });
	});

	it("exchanges a Shopify OAuth callback code and stores the token in KV", async () => {
		const put = vi.fn();
		const oauthEnv = {
			...env,
			SHOPIFY_CLIENT_ID: "client-id",
			SHOPIFY_CLIENT_SECRET: "client-secret",
			OAUTH_STATE_SECRET: "state-secret",
			SHOPIFY_TOKENS: {
				put,
			},
		};

		const installResponse = await worker.fetch(
			new Request(
				"https://worker.example.com/shopify/install?shop=autospec-group.myshopify.com",
			) as any,
			oauthEnv as any,
		);

		expect(installResponse.status).toBe(302);
		const redirectUrl = new URL(installResponse.headers.get("location") ?? "");
		const state = redirectUrl.searchParams.get("state") ?? "";
		const callbackParams = new URLSearchParams({
			code: "auth-code",
			shop: "autospec-group.myshopify.com",
			state,
			timestamp: "1760000000",
		});
		callbackParams.set("hmac", await hmacSha256Hex("client-secret", callbackParams.toString()));

		const fetchMock = vi.fn().mockResolvedValueOnce(
			Response.json({
				access_token: "shpat-token",
				refresh_token: "shprt-token",
				expires_in: 3600,
				scope: "read_draft_orders,write_draft_orders",
			}),
		);

		vi.stubGlobal("fetch", fetchMock);

		const callbackResponse = await worker.fetch(
			new Request(`https://worker.example.com/shopify/callback?${callbackParams}`) as any,
			oauthEnv as any,
		);

		expect(callbackResponse.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://autospec-group.myshopify.com/admin/oauth/access_token",
			expect.objectContaining({
				method: "POST",
			}),
		);
		expect(put).toHaveBeenCalledWith(
			"shopify-token:autospec-group.myshopify.com",
			expect.stringContaining('"accessToken":"shpat-token"'),
		);
	});
});

describe("draft order add-ons Shopify webhook endpoint", () => {
	it("validates Shopify HMAC and applies add-ons on draft order update", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				Response.json({
					data: {
						draftOrder: {
							id: "gid://shopify/DraftOrder/123",
							lineItems: {
								nodes: [testLineItem("AS-C-1000-B", 1)],
							},
						},
					},
				}),
			)
			.mockResolvedValueOnce(
				Response.json({
					data: {
						draftOrderUpdate: {
							draftOrder: { id: "gid://shopify/DraftOrder/123" },
							userErrors: [],
						},
					},
				}),
			);

		vi.stubGlobal("fetch", fetchMock);

		const response = await worker.fetch(
			(await webhookRequest({
				id: 123,
				admin_graphql_api_id: "gid://shopify/DraftOrder/123",
			})) as any,
			env as any,
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			action: "added",
			addedSkus: [{ sku: "AS-WT", quantity: 4 }],
		});

		const updateBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
		expect(updateBody.variables.id).toBe("gid://shopify/DraftOrder/123");
		expect(updateBody.variables.input.lineItems).toEqual([
			{
				variantId: "gid://shopify/ProductVariant/AS-C-1000-B",
				quantity: 1,
				customAttributes: [],
			},
			{
				variantId: "gid://shopify/ProductVariant/50506355179840",
				quantity: 4,
				appliedDiscount: {
					title: "Automatic add-on",
					value: 100,
					valueType: "PERCENTAGE",
				},
			},
		]);
	});

	it("rejects draft order webhooks with an invalid Shopify HMAC", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const response = await worker.fetch(
			(await webhookRequest(
				{
					id: 123,
					admin_graphql_api_id: "gid://shopify/DraftOrder/123",
				},
				{ "x-shopify-hmac-sha256": "bad-hmac" },
			)) as any,
			env as any,
		);

		expect(response.status).toBe(401);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

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

async function hmacSha256Base64(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
	let binary = "";
	for (const byte of new Uint8Array(signature)) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary);
}

function testLineItem(
	sku: string,
	quantity: number,
	variantId = `gid://shopify/ProductVariant/${sku}`,
	appliedDiscount: Record<string, unknown> | null = null,
) {
	return {
		variant: { id: variantId, sku },
		sku,
		quantity,
		title: sku,
		custom: false,
		customAttributes: [],
		appliedDiscount,
		originalUnitPriceWithCurrency: null,
		requiresShipping: true,
		taxable: true,
		weight: null,
	};
}
