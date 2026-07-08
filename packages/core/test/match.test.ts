import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createMatcher,
	normalizePath,
	parsePath,
	type RouteRecord,
	scoreSegments,
	splitPath,
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

test("trailing-slash normalization strips one slash, preserves root", () => {
	assert.equal(normalizePath("/about/"), "/about");
	assert.equal(normalizePath("/about"), "/about");
	assert.equal(normalizePath("/"), "/");
	assert.deepEqual(splitPath("/blog/new/"), ["blog", "new"]);
	assert.deepEqual(splitPath("/"), []);
});

test("matches a static route", () => {
	const m = createMatcher([record("/about")]);
	assert.equal(m.match("/about")?.record.id, "/about");
	assert.equal(m.match("/nope"), null);
});

test("slash-insensitive matching", () => {
	const m = createMatcher([record("/about")]);
	assert.equal(m.match("/about/")?.record.id, "/about");
});

test("extracts a param", () => {
	const m = createMatcher([record("/blog/[slug]")]);
	assert.deepEqual(m.match("/blog/hello")?.params, { slug: "hello" });
});

test("extracts a mixed-segment param", () => {
	const m = createMatcher([record("/post-[id]")]);
	assert.deepEqual(m.match("/post-42")?.params, { id: "42" });
	assert.equal(m.match("/post42"), null);
});

test("groups do not affect the URL", () => {
	const m = createMatcher([record("/(shop)/cart")]);
	assert.equal(m.match("/cart")?.record.id, "/(shop)/cart");
});

test("spread: joins remaining path, undefined at the base", () => {
	const m = createMatcher([record("/files/[...path]")]);
	assert.deepEqual(m.match("/files/a/b/c")?.params, { path: "a/b/c" });
	assert.deepEqual(m.match("/files")?.params, { path: undefined });
	assert.deepEqual(m.match("/files/")?.params, { path: undefined });
});

test("most specific match wins", () => {
	const m = createMatcher([
		record("/blog/[slug]"),
		record("/blog/new"),
		record("/[...all]"),
	]);
	assert.equal(m.match("/blog/new")?.record.id, "/blog/new");
	assert.equal(m.match("/blog/other")?.record.id, "/blog/[slug]");
	assert.equal(m.match("/anything/else")?.record.id, "/[...all]");
});

test("no match returns null", () => {
	const m = createMatcher([record("/about")]);
	assert.equal(m.match("/missing"), null);
});
