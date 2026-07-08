import { parsePath } from "./parse.js";
import type { Params, ParamsFor, RouteRegistry } from "./types.js";

/**
 * Build a URL for a registered route path, substituting its params (spec §10).
 * Restricted to `keyof RouteRegistry` so unknown paths and bad params are type errors.
 */
export function href<P extends keyof RouteRegistry & string>(
	path: P,
	params: ParamsFor<P>,
): string {
	const { segments } = parsePath(path);
	const values = params as Params;
	const out: string[] = [];
	for (const seg of segments) {
		if (seg.kind === "spread") {
			const value = values[seg.name];
			if (value !== undefined && value !== "") out.push(value);
			continue;
		}
		out.push(
			seg.parts
				.map((p) => (p.kind === "static" ? p.name : (values[p.name] ?? "")))
				.join(""),
		);
	}
	return `/${out.join("/")}`;
}
