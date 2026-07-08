import { test } from "node:test";
import {
	href,
	type ParamsOf,
	type RouteContext,
	type RouteHandler,
} from "../dist/index.js";

// Register a file route so href/ParamsFor have a closed set to check against.
declare module "../dist/index.js" {
	interface RouteRegistry {
		"/blog/[slug]": { slug: string };
	}
}

// ── compile-time equality helpers ───────────────────────────────────────────
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;
type Expect<T extends true> = T;

// ── ParamsOf: pure template-literal inference (spec §10.2) ───────────────────
export type _Param = Expect<Equal<ParamsOf<"/blog/[slug]">, { slug: string }>>;
export type _Spread = Expect<
	Equal<ParamsOf<"/files/[...path]">, { path: string | undefined }>
>;
export type _Mixed = Expect<Equal<ParamsOf<"/post-[id]">, { id: string }>>;
// a static path has no params (keyof its ParamsOf is never)
export type _Static = Expect<Equal<keyof ParamsOf<"/about">, never>>;
export type _Multi = Expect<
	Equal<
		ParamsOf<"/[org]/[repo]/post-[id]">,
		{ org: string; repo: string; id: string }
	>
>;
export type _Group = Expect<Equal<keyof ParamsOf<"/(shop)/cart">, never>>;

// ── RouteContext<P> narrows params from the literal ──────────────────────────
export type _CtxParams = Expect<
	Equal<RouteContext<"/blog/[slug]">["params"], { slug: string }>
>;

// A handler keyed by its path sees narrowed params.
const _handler: RouteHandler<"/files/[...path]"> = (ctx) => {
	const path: string | undefined = ctx.params.path;
	return new Response(path ?? "base");
};

// ── href: closed set + param checking (spec §10) ─────────────────────────────
export function _hrefChecks() {
	href("/blog/[slug]", { slug: "hello" }); // ok

	// @ts-expect-error — missing required param
	href("/blog/[slug]", {});

	// @ts-expect-error — unknown path (not in the registry)
	href("/not/registered", {});
}

test("type-level assertions compile", () => {
	// The assertions above are checked by `tsc --build`; this keeps a runtime test present.
	void _handler;
	void _hrefChecks;
});
