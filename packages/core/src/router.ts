import { dispatchWith, mergeHeaders, type RenderError } from "./dispatch.js";
import { HttpError, Redirect } from "./errors.js";
import { createMatcher } from "./match.js";
import type {
	BindingRuntime,
	Extension,
	Next,
	RouteConfig,
	RouteContext,
	RouteManifest,
	RouteRecord,
	Router,
} from "./types.js";

/** Canonical path string for a record (groups stripped), used for conflict detection. */
function canonicalPath(record: RouteRecord): string {
	const path = record.segments
		.map((seg) =>
			seg.kind === "spread"
				? `[...${seg.name}]`
				: seg.parts
						.map((p) => (p.kind === "static" ? p.name : `[${p.name}]`))
						.join(""),
		)
		.join("/");
	return `/${path}`;
}

/** Two records normalizing to the same path is a build error naming both (spec §6.2). */
function detectConflicts(manifest: RouteManifest): void {
	const seen = new Map<string, string>();
	for (const record of manifest) {
		const key = canonicalPath(record);
		const prev = seen.get(key);
		if (prev !== undefined) {
			throw new Error(
				`[@routeur] Route conflict: "${key}" is defined by both "${prev}" and "${record.id}".`,
			);
		}
		seen.set(key, record.id);
	}
}

async function loadConfig(record: RouteRecord): Promise<RouteConfig> {
	const fromHandlers = record.loadHandlers
		? (await record.loadHandlers()).config
		: undefined;
	if (fromHandlers !== undefined) return fromHandlers;
	if (record.loadComponent) {
		const mod = (await record.loadComponent()) as { config?: RouteConfig };
		if (mod.config !== undefined) return mod.config;
	}
	return {} as RouteConfig;
}

/**
 * Compose a manifest + extensions into a `Router` (spec §7.7): merge with conflict
 * detection, sort by specificity, and expose `match`, `routes`, and `handle` — the
 * pipeline of config load → extension onion → terminal dispatch.
 */
export function createRouter(
	manifest: RouteManifest,
	opts?: { extensions?: Extension[] },
): Router {
	detectConflicts(manifest);
	const matcher = createMatcher(manifest);
	const extensions = opts?.extensions ?? [];

	// The designated catch-all: a root spread route (spec §7.4).
	const catchAll = matcher.routes.find(
		(r) => r.segments.length === 1 && r.segments[0]?.kind === "spread",
	);

	async function renderErrorResponse(
		request: Request,
		url: URL,
		status: number,
		binding: BindingRuntime,
		body?: BodyInit,
	): Promise<Response> {
		if (catchAll?.loadComponent) {
			const component = (await catchAll.loadComponent()).default;
			const ctx: RouteContext = {
				params: {},
				url,
				request,
				config: {} as RouteConfig,
				response: { status, headers: new Headers() },
			};
			const rendered = await binding.render(component, ctx);
			return new Response(rendered.body, {
				status: ctx.response.status,
				headers: mergeHeaders(rendered.headers, ctx.response.headers),
			});
		}
		return new Response(body ?? null, { status });
	}

	async function handle(
		request: Request,
		binding: BindingRuntime,
	): Promise<Response> {
		const url = new URL(request.url);
		const matched = matcher.match(url.pathname);
		if (matched === null) {
			return renderErrorResponse(request, url, 404, binding);
		}

		const { record, params } = matched;
		const config = await loadConfig(record);
		const ctx: RouteContext = {
			params,
			url,
			request,
			config,
			response: { status: 200, headers: new Headers() },
		};
		const renderError: RenderError = (status, body) =>
			renderErrorResponse(request, url, status, binding, body);

		try {
			let next: Next = () => dispatchWith(record, binding, ctx, renderError);
			for (let i = extensions.length - 1; i >= 0; i--) {
				const ext = extensions[i] as Extension;
				const hook = ext.request;
				if (!hook) continue;
				const downstream = next;
				next = () => Promise.resolve(hook(ctx, record, downstream));
			}
			return await next();
		} catch (e) {
			if (e instanceof Redirect) {
				return new Response(null, {
					status: e.status,
					headers: { Location: e.location },
				});
			}
			if (e instanceof HttpError) {
				return renderError(e.status, e.body);
			}
			throw e;
		}
	}

	return {
		match: (pathname) => matcher.match(pathname),
		routes: matcher.routes,
		handle,
	};
}
