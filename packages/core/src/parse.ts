import type { Part, Segment } from "./types.js";

const GROUP = /^\((.+)\)$/;
const SPREAD = /^\[\.\.\.([^\]]+)\]$/;
const TOKEN = /\[([^\]]+)\]/g;

/**
 * Parse a canonical path pattern (spec §4.2) into the segment IR (spec §4):
 * `/blog/[slug]`, `/files/[...path]`, `/(shop)/cart`, `/post-[id]`, `/about`, `/`.
 * Groups are stripped from `segments` and their names collected in `groups`.
 * Rejects illegal spread mixes such as `pre-[...x]` (spec §4.1).
 */
export function parsePath(pattern: string): {
	segments: Segment[];
	groups: string[];
} {
	const groups: string[] = [];
	const segments: Segment[] = [];

	for (const raw of pattern.split("/")) {
		if (raw.length === 0) continue; // leading/trailing/collapsed slashes

		const group = GROUP.exec(raw);
		if (group) {
			groups.push(group[1] as string);
			continue;
		}

		if (raw.includes("[...")) {
			const spread = SPREAD.exec(raw);
			if (!spread) {
				throw new Error(
					`[@routeur] Invalid spread segment "${raw}" in "${pattern}": a spread must own its whole segment, e.g. "[...name]".`,
				);
			}
			segments.push({ kind: "spread", name: spread[1] as string });
			continue;
		}

		segments.push({ kind: "normal", parts: parseParts(raw, pattern) });
	}

	return { segments, groups };
}

function parseParts(seg: string, pattern: string): Part[] {
	const parts: Part[] = [];
	let last = 0;
	TOKEN.lastIndex = 0;
	let match: RegExpExecArray | null = TOKEN.exec(seg);
	while (match !== null) {
		if (match.index > last) {
			parts.push({ kind: "static", name: seg.slice(last, match.index) });
		}
		const name = match[1] as string;
		if (name.includes("...")) {
			throw new Error(
				`[@routeur] Invalid spread segment "${seg}" in "${pattern}": a spread must own its whole segment, e.g. "[...name]".`,
			);
		}
		parts.push({ kind: "param", name });
		last = TOKEN.lastIndex;
		match = TOKEN.exec(seg);
	}
	if (last < seg.length) {
		parts.push({ kind: "static", name: seg.slice(last) });
	}
	return parts;
}
