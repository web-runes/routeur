import type { RouteRecord, Segment } from "./types.js";

/**
 * Per-segment specificity (spec §5): static(3) > mixed(2) > param(1) > spread(0).
 */
export function scoreSegments(segments: Segment[]): number[] {
	return segments.map((seg) => {
		if (seg.kind === "spread") return 0;
		const hasStatic = seg.parts.some((p) => p.kind === "static");
		const hasParam = seg.parts.some((p) => p.kind === "param");
		if (hasStatic && hasParam) return 2;
		if (hasParam) return 1;
		return 3;
	});
}

/**
 * Order two records most-specific-first (spec §5): compare scores position by
 * position (earlier segments dominate); the shorter/exact route wins a prefix
 * tie; an index route breaks a remaining tie in favour of the exact match.
 * Suitable for `Array#sort`.
 */
export function compareRecords(a: RouteRecord, b: RouteRecord): number {
	const n = Math.min(a.score.length, b.score.length);
	for (let i = 0; i < n; i++) {
		const av = a.score[i] as number;
		const bv = b.score[i] as number;
		if (av !== bv) return bv - av; // higher score first
	}
	if (a.score.length !== b.score.length) return a.score.length - b.score.length; // shorter first
	if (a.index !== b.index) return a.index ? -1 : 1; // index first
	return 0;
}
