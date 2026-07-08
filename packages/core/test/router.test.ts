import assert from "node:assert/strict";
import { test } from "node:test";
import {
	type BindingRuntime,
	createRouter,
	defineRoutes,
	type Extension,
	error,
	type RouteRecord,
	redirect,
} from "../dist/index.js";

const fakeBinding: BindingRuntime = {
	render: (component, ctx) =>
		new Response((component as (c: typeof ctx) => string)(ctx), {
			headers: { "content-type": "text/html" },
		}),
};

function get(url: string, method = "GET"): Request {
	return new Request(`https://x.test${url}`, { method });
}

test("matches and dispatches a component route (GET)", async () => {
	const manifest = defineRoutes([
		{ path: "/", load: () => Promise.resolve({ default: () => "home" }) },
	]);
	const router = createRouter(manifest);
	const res = await router.handle(get("/"), fakeBinding);
	assert.equal(res.status, 200);
	assert.equal(await res.text(), "home");
});

test("runs an endpoint (POST)", async () => {
	const manifest = defineRoutes([
		{
			path: "/api/posts",
			POST: () => new Response("created", { status: 201 }),
		},
	]);
	const router = createRouter(manifest);
	const res = await router.handle(get("/api/posts", "POST"), fakeBinding);
	assert.equal(res.status, 201);
	assert.equal(await res.text(), "created");
});

test("a path claimed by nothing else falls through to the catch-all spread", async () => {
	const manifest = defineRoutes([
		{
			path: "/[...all]",
			load: () => Promise.resolve({ default: () => "custom 404" }),
		},
	]);
	const router = createRouter(manifest);
	const res = await router.handle(get("/does/not/exist"), fakeBinding);
	// the root spread matches everything the more-specific routes didn't claim,
	// so it renders as a normal page (200); the page may set its own 404 status.
	assert.equal(res.status, 200);
	assert.equal(await res.text(), "custom 404");
});

test("unmatched path with no catch-all → plain 404", async () => {
	const manifest = defineRoutes([
		{ path: "/about", load: () => Promise.resolve({ default: () => "a" }) },
	]);
	const router = createRouter(manifest);
	const res = await router.handle(get("/missing"), fakeBinding);
	assert.equal(res.status, 404);
});

test("throw error renders the catch-all page at the thrown status", async () => {
	const manifest = defineRoutes([
		{ path: "/api/x", POST: () => error(422, "bad") },
		{
			path: "/[...all]",
			load: () =>
				Promise.resolve({
					default: (ctx: { response: { status: number } }) =>
						`error ${ctx.response.status}`,
				}),
		},
	]);
	const router = createRouter(manifest);
	const res = await router.handle(get("/api/x", "POST"), fakeBinding);
	assert.equal(res.status, 422);
	assert.equal(await res.text(), "error 422");
});

test("conflict detection: two records at the same path throw and name both", () => {
	assert.throws(
		() =>
			createRouter([
				...defineRoutes([{ path: "/dup", GET: () => new Response("a") }]),
				...defineRoutes([{ path: "/dup", GET: () => new Response("b") }]),
			]),
		/Route conflict.*\/dup/s,
	);
});

test("extensions compose as an onion around dispatch", async () => {
	const order: string[] = [];
	const outer: Extension = {
		name: "outer",
		request: async (_ctx, _route, next) => {
			order.push("outer:before");
			const res = await next();
			order.push("outer:after");
			return res;
		},
	};
	const inner: Extension = {
		name: "inner",
		request: async (_ctx, _route, next) => {
			order.push("inner:before");
			return next();
		},
	};
	const manifest = defineRoutes([
		{ path: "/", load: () => Promise.resolve({ default: () => "ok" }) },
	]);
	const router = createRouter(manifest, { extensions: [outer, inner] });
	const res = await router.handle(get("/"), fakeBinding);
	assert.equal(await res.text(), "ok");
	assert.deepEqual(order, ["outer:before", "inner:before", "outer:after"]);
});

test("an extension can short-circuit with a redirect", async () => {
	const gate: Extension = {
		name: "gate",
		request: () => redirect("/login"),
	};
	const manifest = defineRoutes([
		{
			path: "/account",
			load: () => Promise.resolve({ default: () => "secret" }),
		},
	]);
	const router = createRouter(manifest, { extensions: [gate] });
	const res = await router.handle(get("/account"), fakeBinding);
	assert.equal(res.status, 302);
	assert.equal(res.headers.get("Location"), "/login");
});

test("config is loaded off the route metadata and surfaced on ctx", async () => {
	let seen: unknown;
	const manifest: RouteRecord[] = [
		{
			id: "/cfg",
			segments: [{ kind: "normal", parts: [{ kind: "static", name: "cfg" }] }],
			index: false,
			score: [3],
			meta: { groups: [] },
			loadHandlers: () =>
				Promise.resolve({
					config: { flag: true },
					GET: (ctx) => {
						seen = ctx.config;
						return new Response("ok");
					},
				}),
		},
	];
	const router = createRouter(manifest);
	await router.handle(get("/cfg"), fakeBinding);
	assert.deepEqual(seen, { flag: true });
});
