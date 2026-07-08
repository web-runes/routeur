import assert from "node:assert/strict";
import { test } from "node:test";
import {
	compareRecords,
	parsePath,
	type RouteRecord,
	scoreSegments,
} from "../dist/index.js";

function record(path: string, index = false): RouteRecord {
	const { segments, groups } = parsePath(path);
	return {
		id: path,
		segments,
		index,
		score: scoreSegments(segments),
		meta: { groups },
	};
}

test("per-segment specificity: static(3) > mixed(2) > param(1) > spread(0)", () => {
	assert.deepEqual(scoreSegments(parsePath("/about").segments), [3]);
	assert.deepEqual(scoreSegments(parsePath("/post-[id]").segments), [2]);
	assert.deepEqual(scoreSegments(parsePath("/[slug]").segments), [1]);
	assert.deepEqual(scoreSegments(parsePath("/[...all]").segments), [0]);
	assert.deepEqual(scoreSegments(parsePath("/blog/[slug]").segments), [3, 1]);
});

test("static beats param at the deciding position", () => {
	// /blog/new [3,3] beats /blog/[slug] [3,1]
	const sorted = [record("/blog/[slug]"), record("/blog/new")].sort(
		compareRecords,
	);
	assert.deepEqual(
		sorted.map((r) => r.id),
		["/blog/new", "/blog/[slug]"],
	);
});

test("index route beats a root spread on a prefix tie", () => {
	const sorted = [record("/[...all]"), record("/", true)].sort(compareRecords);
	assert.deepEqual(
		sorted.map((r) => r.id),
		["/", "/[...all]"],
	);
});

test("shorter/exact route wins over a trailing spread", () => {
	// /a [3] vs /a/[...rest] [3,0] both match /a; the exact one is more specific.
	const sorted = [record("/a/[...rest]"), record("/a")].sort(compareRecords);
	assert.deepEqual(
		sorted.map((r) => r.id),
		["/a", "/a/[...rest]"],
	);
});

test("full ranking is stable and specificity-ordered", () => {
	const sorted = [
		record("/[...all]"),
		record("/blog/[slug]"),
		record("/blog/new"),
		record("/post-[id]"),
	].sort(compareRecords);
	assert.deepEqual(
		sorted.map((r) => r.id),
		["/blog/new", "/blog/[slug]", "/post-[id]", "/[...all]"],
	);
});
