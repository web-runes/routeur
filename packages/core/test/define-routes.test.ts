import assert from "node:assert/strict";
import { test } from "node:test";
import { defineRoutes } from "../dist/index.js";

test("parses + scores authored entries into records", () => {
	const [healthz, blog] = defineRoutes([
		{ path: "/healthz", GET: () => new Response("ok") },
		{ path: "/blog/[slug].json", GET: (ctx) => Response.json(ctx.params.slug) },
	]);
	assert.equal(healthz?.id, "/healthz");
	assert.deepEqual(healthz?.score, [3]);
	assert.equal(blog?.id, "/blog/[slug].json");
	assert.deepEqual(blog?.score, [3, 2]); // mixed: [slug].json
});

test("a component route wires loadComponent, an endpoint wires loadHandlers", async () => {
	const [page, api] = defineRoutes([
		{ path: "/", load: () => Promise.resolve({ default: () => "home" }) },
		{ path: "/api", POST: () => new Response("x") },
	]);
	assert.ok(page?.loadComponent);
	assert.equal(page?.loadHandlers, undefined);
	assert.equal(api?.loadComponent, undefined);
	assert.ok(api?.loadHandlers);
	assert.ok((await api.loadHandlers?.())?.POST);
});

test("component + GET is a build error", () => {
	assert.throws(
		() =>
			defineRoutes([
				{
					path: "/x",
					load: () => Promise.resolve({ default: () => "c" }),
					GET: () => new Response("g"),
				},
			]),
		/both a component and a GET handler/,
	);
});

test("config is carried onto the handler module", async () => {
	const [route] = defineRoutes([
		{ path: "/c", config: { cache: 5 }, POST: () => new Response("ok") },
	]);
	const mod = await route?.loadHandlers?.();
	assert.deepEqual(mod?.config, { cache: 5 });
});

test("index flag defaults to false and can be set", () => {
	const [a, b] = defineRoutes([
		{ path: "/", load: () => Promise.resolve({ default: () => "x" }) },
		{
			path: "/",
			index: true,
			load: () => Promise.resolve({ default: () => "x" }),
		},
	]);
	assert.equal(a?.index, false);
	assert.equal(b?.index, true);
});
