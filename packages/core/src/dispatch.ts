import { HttpError, Redirect } from "./errors.js";
import type {
	BindingRuntime,
	DispatchContext,
	HandlerModule,
	RouteContext,
	RouteHandler,
	RouteRecord,
} from "./types.js";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Method = (typeof METHODS)[number];

/** Merge render-produced headers with page-set `ctx.response` headers; the page wins. */
export function mergeHeaders(base: Headers, override: Headers): Headers {
	const merged = new Headers(base);
	for (const [key, value] of override) merged.set(key, value);
	return merged;
}

/** Compute the `Allow` header for a 405 (spec §7.5). */
export function allowed(
	handlers: HandlerModule | null,
	component: unknown,
): string {
	const methods = new Set<string>();
	if (component !== undefined) {
		methods.add("GET");
		methods.add("HEAD");
	}
	if (handlers) {
		if (handlers.ALL) for (const m of METHODS) methods.add(m);
		for (const m of METHODS) {
			if (handlers[m]) methods.add(m);
		}
		if (methods.has("GET")) methods.add("HEAD");
	}
	return [...methods].join(", ");
}

/** Optional catch-all renderer supplied by the router (spec §7.5). */
export type RenderError = (
	status: number,
	body?: BodyInit,
) => Promise<Response>;

/**
 * Terminal dispatch against a pre-built context (spec §7.5). Resolves the method,
 * renders a component GET buffered so `ctx.response` is final, folds status/headers,
 * returns 405 with `Allow`, and catches the two throwables.
 */
export async function dispatchWith(
	route: RouteRecord,
	binding: BindingRuntime,
	ctx: RouteContext,
	renderError?: RenderError,
): Promise<Response> {
	const requestMethod =
		ctx.request.method === "HEAD" ? "GET" : ctx.request.method;
	const method = requestMethod as Method;
	const handlers = route.loadHandlers ? await route.loadHandlers() : null;
	const component = route.loadComponent
		? (await route.loadComponent()).default
		: undefined;

	try {
		const fn: RouteHandler | undefined = handlers?.[method] ?? handlers?.ALL;
		if (fn) return await fn(ctx);

		if (method === "GET" && component !== undefined) {
			const rendered = await binding.render(component, ctx); // BUFFERED → ctx.response now final
			return new Response(rendered.body, {
				status: ctx.response.status,
				headers: mergeHeaders(rendered.headers, ctx.response.headers),
			});
		}

		return new Response(null, {
			status: 405,
			headers: { Allow: allowed(handlers, component) },
		});
	} catch (e) {
		if (e instanceof Redirect) {
			return new Response(null, {
				status: e.status,
				headers: { Location: e.location },
			});
		}
		if (e instanceof HttpError) {
			return renderError
				? await renderError(e.status, e.body)
				: new Response(e.body ?? null, { status: e.status });
		}
		throw e;
	}
}

/**
 * Terminal dispatch that opens a fresh `response` from a base context (spec §7.5, §11.3).
 * The bare export used by callers that want rendering without the extension chain.
 */
export function dispatch(
	route: RouteRecord,
	binding: BindingRuntime,
	base: DispatchContext,
): Promise<Response> {
	const ctx: RouteContext = {
		...base,
		response: { status: 200, headers: new Headers() },
	};
	return dispatchWith(route, binding, ctx);
}
