import { parsePath } from "./parse.js";
import { scoreSegments } from "./score.js";
import type {
	HandlerModule,
	RouteConfig,
	RouteHandler,
	RouteManifest,
	RouteRecord,
} from "./types.js";

/**
 * A hand-authored route entry (spec §6.1). Carries the path as a string literal
 * so each handler/config is typed for that path with no codegen. Provide a
 * component via `load` OR a `GET` handler, but not both (spec §7.1, §8.3).
 */
export interface RouteInput<P extends string = string> {
	path: P;
	index?: boolean;
	/** component chunk loader (this IS GET) */
	load?: () => Promise<{ default: unknown }>;
	GET?: RouteHandler<P>;
	POST?: RouteHandler<P>;
	PUT?: RouteHandler<P>;
	PATCH?: RouteHandler<P>;
	DELETE?: RouteHandler<P>;
	ALL?: RouteHandler<P>;
	config?: RouteConfig<P>;
}

const HANDLER_METHODS = [
	"GET",
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
	"ALL",
] as const;

function toRecord(input: RouteInput): RouteRecord {
	const { segments, groups } = parsePath(input.path);

	if (input.load && (input.GET || input.ALL)) {
		throw new Error(
			`[@routeur] Route "${input.path}" has both a component and a ${
				input.GET ? "GET" : "ALL"
			} handler. The component is the GET handler; remove one. ` +
				"POST/PUT/PATCH/DELETE may coexist with a component; GET/ALL may not.",
		);
	}

	const handlerModule: HandlerModule = {};
	let hasHandlers = false;
	for (const method of HANDLER_METHODS) {
		const fn = input[method];
		if (fn) {
			handlerModule[method] = fn;
			hasHandlers = true;
		}
	}
	if (input.config !== undefined) {
		handlerModule.config = input.config;
		hasHandlers = true;
	}

	return {
		id: input.path,
		segments,
		index: input.index ?? false,
		score: scoreSegments(segments),
		meta: { groups },
		loadComponent: input.load,
		loadHandlers: hasHandlers
			? () => Promise.resolve(handlerModule)
			: undefined,
	};
}

/**
 * Hand-written producer of the manifest (spec §6.1): parse + score each authored
 * entry into a `RouteRecord`, identical to what the file scanner emits. Each
 * entry's params are inferred from its path literal — no registry needed (§10.2).
 *
 * The path literals are captured in a separate string-tuple `P` (read straight
 * from each `path` position) so each entry's handlers type against their own path
 * without the circular inference of an indexed `T[K]["path"]`.
 */
export function defineRoutes<const P extends readonly string[]>(
	routes: { readonly [K in keyof P]: RouteInput<P[K]> },
): RouteManifest {
	return (routes as readonly RouteInput[]).map(toRecord);
}
