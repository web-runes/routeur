import { compareRecords } from "./score.js";
import type { Params, RouteMatch, RouteRecord, Segment } from "./types.js";

/** Strip a single trailing slash, preserving root `/` (spec §5.2). */
export function normalizePath(pathname: string): string {
	if (pathname.length > 1 && pathname.endsWith("/"))
		return pathname.slice(0, -1);
	return pathname;
}

/** Split a pathname into its URL segments (root → `[]`). */
export function splitPath(pathname: string): string[] {
	const normalized = normalizePath(pathname);
	if (normalized === "/" || normalized === "") return [];
	return normalized.replace(/^\//, "").split("/");
}

const RESERVED = /[.*+?^${}()|[\]\\]/g;
function escapeRegExp(literal: string): string {
	return literal.replace(RESERVED, "\\$&");
}

type SegmentMatcher = (urlSegment: string) => Params | null;

function compileNormalSegment(
	seg: Extract<Segment, { kind: "normal" }>,
): SegmentMatcher {
	const [only] = seg.parts;
	if (seg.parts.length === 1 && only?.kind === "static") {
		return (urlSegment) => (urlSegment === only.name ? {} : null);
	}
	if (seg.parts.length === 1 && only?.kind === "param") {
		return (urlSegment) => ({ [only.name]: urlSegment });
	}
	// mixed → per-segment regex, e.g. post-[id] → ^post-(?<id>[^/]+)$ (spec §5.1)
	const source = `^${seg.parts
		.map((p) =>
			p.kind === "static" ? escapeRegExp(p.name) : `(?<${p.name}>[^/]+)`,
		)
		.join("")}$`;
	const regExp = new RegExp(source);
	return (urlSegment) => {
		const match = regExp.exec(urlSegment);
		return match ? { ...match.groups } : null;
	};
}

interface CompiledRoute {
	record: RouteRecord;
	spreadIndex: number;
	matchers: (SegmentMatcher | null)[]; // null at the spread position
}

function compile(record: RouteRecord): CompiledRoute {
	return {
		record,
		spreadIndex: record.segments.findIndex((s) => s.kind === "spread"),
		matchers: record.segments.map((s) =>
			s.kind === "spread" ? null : compileNormalSegment(s),
		),
	};
}

function runMatch(
	compiled: CompiledRoute,
	urlSegments: string[],
): Params | null {
	const { record, spreadIndex, matchers } = compiled;
	const segments = record.segments;

	if (spreadIndex === -1) {
		if (urlSegments.length !== segments.length) return null;
		const params: Params = {};
		for (let i = 0; i < segments.length; i++) {
			const result = (matchers[i] as SegmentMatcher)(urlSegments[i] as string);
			if (result === null) return null;
			Object.assign(params, result);
		}
		return params;
	}

	// One spread owns a whole segment and matches zero or more (Astro semantics).
	const prefix = spreadIndex;
	const suffix = segments.length - spreadIndex - 1;
	if (urlSegments.length < prefix + suffix) return null;

	const params: Params = {};
	for (let i = 0; i < prefix; i++) {
		const result = (matchers[i] as SegmentMatcher)(urlSegments[i] as string);
		if (result === null) return null;
		Object.assign(params, result);
	}
	for (let j = 0; j < suffix; j++) {
		const matcher = matchers[spreadIndex + 1 + j] as SegmentMatcher;
		const result = matcher(
			urlSegments[urlSegments.length - suffix + j] as string,
		);
		if (result === null) return null;
		Object.assign(params, result);
	}
	const middle = urlSegments.slice(prefix, urlSegments.length - suffix);
	const spread = segments[spreadIndex] as Extract<Segment, { kind: "spread" }>;
	// joined string, or undefined at the base — this is what lets one [...x] serve its own base path.
	params[spread.name] = middle.length > 0 ? middle.join("/") : undefined;
	return params;
}

export interface Matcher {
	match(pathname: string): RouteMatch | null;
	routes: RouteRecord[];
}

/**
 * Build a matcher from a manifest (spec §5.1): sort by specificity once, compile
 * a matcher per route, linear-scan on request. Most specific match wins.
 */
export function createMatcher(records: RouteRecord[]): Matcher {
	const sorted = [...records].sort(compareRecords);
	const compiled = sorted.map(compile);
	return {
		routes: sorted,
		match(pathname) {
			const urlSegments = splitPath(pathname);
			for (const route of compiled) {
				const params = runMatch(route, urlSegments);
				if (params !== null) return { record: route.record, params };
			}
			return null;
		},
	};
}
