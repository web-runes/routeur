// Public type surface for @routeur/core.
// Runtime lives in the sibling modules; this file is types only.

// ── Route IR (spec §4) ──────────────────────────────────────────────────────

export type Part =
	| { kind: "static"; name: string }
	| { kind: "param"; name: string }; // required, single segment

export type Segment =
	| { kind: "normal"; parts: Part[] } // static | param | mixed
	| { kind: "spread"; name: string }; // [...name] — zero or more segments

export interface RouteRecord {
	/** stable unique id (file path or manual key) */
	id: string;
	/** groups already stripped */
	segments: Segment[];
	index: boolean;
	/** precomputed specificity (spec §5) */
	score: number[];
	meta: {
		/** captured group names — see spec §6.3 */
		groups: string[];
		[k: string]: unknown;
	};
	/** component chunk */
	loadComponent?: () => Promise<{ default: unknown }>;
	/** handlers chunk */
	loadHandlers?: () => Promise<HandlerModule>;
	// At least one of loadComponent / loadHandlers is present.
	// For colocated bindings these may resolve to the SAME specifier.
}

export type RouteManifest = RouteRecord[];

// ── Params & typed routes (spec §5.3, §10) ──────────────────────────────────

/** undefined only reachable for a spread at the base */
export type Params = Record<string, string | undefined>;

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type TrimSlashes<P extends string> = P extends `/${infer R}`
	? TrimSlashes<R>
	: P extends `${infer R}/`
		? TrimSlashes<R>
		: P;

// scan a single segment for [name] tokens (params), ignoring static text.
// `unknown` is the identity for `&`, so a token-free segment adds no params.
type TokenParams<S extends string> =
	S extends `${string}[${infer N}]${infer Post}`
		? { [K in N]: string } & TokenParams<Post>
		: unknown;

type SegmentParams<S extends string> = S extends `(${string})`
	? unknown // group — contributes nothing
	: S extends `[...${infer N}]`
		? { [K in N]: string | undefined } // spread — undefined at base
		: TokenParams<S>;

type PathParams<P extends string> = P extends `${infer Seg}/${infer Rest}`
	? SegmentParams<Seg> & PathParams<Rest>
	: SegmentParams<P>;

/**
 * Pure template-literal inference of a path's params (spec §10.2, Spike D):
 * `[x]→{x:string}`, `[...x]→{x:string|undefined}`, `post-[id]→{id:string}`,
 * static→`{}`, groups contribute nothing.
 */
export type ParamsOf<P extends string> = Simplify<PathParams<TrimSlashes<P>>>;

/** open; augmented by src/routes.gen.ts (spec §10) */
// biome-ignore lint/suspicious/noEmptyInterface: open for module augmentation
export interface RouteRegistry {}

/**
 * Resolve a path literal to its param shape. A registered file route resolves
 * through the registry; any other literal falls back to pure inference so the
 * manual API narrows without codegen (spec §6.1, §10.2).
 */
export type ParamsFor<P extends string> = P extends keyof RouteRegistry
	? RouteRegistry[P]
	: ParamsOf<P>;

// ── Route config (spec §7.6) ────────────────────────────────────────────────

type UnionToIntersection<U> = (
	U extends unknown
		? (k: U) => void
		: never
) extends (k: infer I) => void
	? I
	: never;

type MergeParts<T> =
	UnionToIntersection<{ [K in keyof T]: { v: T[K] } }[keyof T]> extends {
		v: infer M;
	}
		? M
		: never;

/**
 * open generic; each extension augments with ONE namespaced key (spec §7.6).
 * `_P` is unused in core but consumed by augmentations (e.g. `GetStaticPaths<P>`);
 * declaration merging is positional, so the name difference is irrelevant.
 */
// biome-ignore lint/suspicious/noEmptyInterface: open for module augmentation
export interface RouteConfigParts<_P extends string = string> {}

/** author-facing merged config — flat, per spec §7.6. `Record` when no extension augments it. */
export type RouteConfig<P extends string = string> =
	keyof RouteConfigParts<P> extends never
		? Record<string, unknown>
		: MergeParts<RouteConfigParts<P>>;

// ── Request context (spec §7) ───────────────────────────────────────────────

/** open for augmentation — see spec §7.2 */
// biome-ignore lint/suspicious/noEmptyInterface: open for module augmentation
export interface RouteContextExtensions {}

export interface RouteContext<P extends string = string>
	extends RouteContextExtensions {
	/** typed from the registry for a known path; Params otherwise */
	params: ParamsFor<P>;
	url: URL;
	request: Request;
	/** mutable; defaults to 200 / empty */
	response: { status: number; headers: Headers };
	/** the route's resolved `export const config` (spec §7.6) */
	config: RouteConfig<P>;
}

/** the context a dispatcher is handed before it opens a fresh `response` (spec §7.5) */
export type DispatchContext<P extends string = string> = Omit<
	RouteContext<P>,
	"response"
>;

export type RouteHandler<P extends string = string> = (
	ctx: RouteContext<P>,
) => Response | Promise<Response>;

export interface HandlerModule {
	POST?: RouteHandler;
	PUT?: RouteHandler;
	PATCH?: RouteHandler;
	DELETE?: RouteHandler;
	/** fallback for any method */
	ALL?: RouteHandler;
	/** allowed ONLY when the route has no component (spec §7, §8.3) */
	GET?: RouteHandler;
	/** static metadata for extensions — see spec §7.6 */
	config?: RouteConfig;
}

// ── Bindings (spec §8) ──────────────────────────────────────────────────────

export interface BindingBuild {
	/** component file extensions this binding owns */
	extensions: string[];
	/** may handlers/config share the component file? */
	colocated: boolean;
	/** module specifier of the runtime half — re-exported by routes.gen.ts (spec §9.2) */
	runtime: string;
}

export interface BindingRuntime {
	render(component: unknown, ctx: RouteContext): Response | Promise<Response>;
}

// ── Extensions & router (spec §7.7) ─────────────────────────────────────────

export type Next = () => Promise<Response>;

export interface Extension {
	name: string;
	request?: (
		ctx: RouteContext,
		route: RouteRecord,
		next: Next,
	) => Response | Promise<Response>;
}

export interface RouteMatch {
	record: RouteRecord;
	params: Params;
}

export interface Router {
	/** match a pathname to a route (trailing-slash-insensitive, spec §5.2) */
	match(pathname: string): RouteMatch | null;
	/** the manifest, sorted most-specific-first */
	routes: RouteRecord[];
	/** composed pipeline: config load → extension onion → terminal dispatch (spec §7.7) */
	handle(request: Request, binding: BindingRuntime): Promise<Response>;
}
