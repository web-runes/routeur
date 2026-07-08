import assert from "node:assert/strict";
import { test } from "node:test";
import {
	type BindingRuntime,
	type DispatchContext,
	dispatch,
	error,
	type RouteHandler,
	type RouteRecord,
	redirect,
} from "../dist/index.js";

// A fake binding that renders a component (a function of ctx → string body).
const fakeBinding: BindingRuntime = {
	render: (component, ctx) => {
		const body = (component as (c: typeof ctx) => string)(ctx);
		return new Response(body, { headers: { "content-type": "text/html" } });
	},
};

function baseCtx(url: string, method = "GET"): DispatchContext {
	const request = new Request(`https://x.test${url}`, { method });
	return { params: {}, url: new URL(request.url), request, config: {} };
}

function componentRoute(fn: (ctx: unknown) => string): RouteRecord {
	return {
		id: "/page",
		segments: [{ kind: "normal", parts: [{ kind: "static", name: "page" }] }],
		index: false,
		score: [3],
		meta: { groups: [] },
		loadComponent: () => Promise.resolve({ default: fn }),
	};
}

function handlerRoute(handlers: Record<string, RouteHandler>): RouteRecord {
	return {
		id: "/api",
		segments: [{ kind: "normal", parts: [{ kind: "static", name: "api" }] }],
		index: false,
		score: [3],
		meta: { groups: [] },
		loadHandlers: () => Promise.resolve(handlers),
	};
}

test("component is GET: renders buffered at 200", async () => {
	const route = componentRoute(() => "<h1>hi</h1>");
	const res = await dispatch(route, fakeBinding, baseCtx("/page"));
	assert.equal(res.status, 200);
	assert.equal(await res.text(), "<h1>hi</h1>");
	assert.equal(res.headers.get("content-type"), "text/html");
});

test("HEAD is treated as GET", async () => {
	const route = componentRoute(() => "body");
	const res = await dispatch(route, fakeBinding, baseCtx("/page", "HEAD"));
	assert.equal(res.status, 200);
});

test("page mutates ctx.response: status + headers folded in", async () => {
	const route = componentRoute((ctx) => {
		const c = ctx as { response: { status: number; headers: Headers } };
		c.response.status = 404;
		c.response.headers.set("cache-control", "public, max-age=300");
		return "not found body";
	});
	const res = await dispatch(route, fakeBinding, baseCtx("/page"));
	assert.equal(res.status, 404);
	assert.equal(res.headers.get("cache-control"), "public, max-age=300");
	assert.equal(res.headers.get("content-type"), "text/html");
	assert.equal(await res.text(), "not found body");
});

test("endpoint handler wins for its method", async () => {
	const route = handlerRoute({
		POST: async ({ request }) =>
			Response.json(await request.json(), { status: 201 }),
	});
	const request = new Request("https://x.test/api", {
		method: "POST",
		body: JSON.stringify({ ok: true }),
		headers: { "content-type": "application/json" },
	});
	const res = await dispatch(route, fakeBinding, {
		params: {},
		url: new URL(request.url),
		request,
		config: {},
	});
	assert.equal(res.status, 201);
	assert.deepEqual(await res.json(), { ok: true });
});

test("ALL is the fallback handler", async () => {
	const route = handlerRoute({ ALL: () => new Response("all") });
	const res = await dispatch(route, fakeBinding, baseCtx("/api", "DELETE"));
	assert.equal(await res.text(), "all");
});

test("unhandled method → 405 with Allow header", async () => {
	const route = handlerRoute({ POST: () => new Response("ok") });
	const res = await dispatch(route, fakeBinding, baseCtx("/api", "PUT"));
	assert.equal(res.status, 405);
	assert.equal(res.headers.get("Allow"), "POST");
});

test("405 Allow lists GET/HEAD for a component-only route on POST", async () => {
	const route = componentRoute(() => "x");
	const res = await dispatch(route, fakeBinding, baseCtx("/page", "POST"));
	assert.equal(res.status, 405);
	assert.equal(res.headers.get("Allow"), "GET, HEAD");
});

test("throw redirect → bodyless Location response", async () => {
	const handler: RouteHandler = () => redirect("/login", 303);
	const route = handlerRoute({ GET: handler });
	const res = await dispatch(route, fakeBinding, baseCtx("/api"));
	assert.equal(res.status, 303);
	assert.equal(res.headers.get("Location"), "/login");
	assert.equal(res.body, null);
});

test("throw error → status + body (no catch-all supplied to bare dispatch)", async () => {
	const handler: RouteHandler = () => error(422, "title required");
	const route = handlerRoute({ POST: handler });
	const res = await dispatch(route, fakeBinding, baseCtx("/api", "POST"));
	assert.equal(res.status, 422);
	assert.equal(await res.text(), "title required");
});

test("redirect thrown from inside a page render is caught (buffered)", async () => {
	const route = componentRoute(() => {
		redirect("/account");
		return "unreachable";
	});
	const res = await dispatch(route, fakeBinding, baseCtx("/page"));
	assert.equal(res.status, 302);
	assert.equal(res.headers.get("Location"), "/account");
});
