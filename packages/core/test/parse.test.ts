import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePath } from "../dist/index.js";

test("static segment", () => {
	assert.deepEqual(parsePath("/about"), {
		segments: [{ kind: "normal", parts: [{ kind: "static", name: "about" }] }],
		groups: [],
	});
});

test("index / root has no segments", () => {
	assert.deepEqual(parsePath("/"), { segments: [], groups: [] });
});

test("param segment", () => {
	assert.deepEqual(parsePath("/blog/[slug]"), {
		segments: [
			{ kind: "normal", parts: [{ kind: "static", name: "blog" }] },
			{ kind: "normal", parts: [{ kind: "param", name: "slug" }] },
		],
		groups: [],
	});
});

test("spread segment", () => {
	assert.deepEqual(parsePath("/files/[...path]"), {
		segments: [
			{ kind: "normal", parts: [{ kind: "static", name: "files" }] },
			{ kind: "spread", name: "path" },
		],
		groups: [],
	});
});

test("group is stripped and captured", () => {
	assert.deepEqual(parsePath("/(shop)/cart"), {
		segments: [{ kind: "normal", parts: [{ kind: "static", name: "cart" }] }],
		groups: ["shop"],
	});
});

test("mixed segment: static + param", () => {
	assert.deepEqual(parsePath("/post-[id]"), {
		segments: [
			{
				kind: "normal",
				parts: [
					{ kind: "static", name: "post-" },
					{ kind: "param", name: "id" },
				],
			},
		],
		groups: [],
	});
});

test("mixed segment: param + static suffix (.json)", () => {
	assert.deepEqual(parsePath("/blog/[slug].json"), {
		segments: [
			{ kind: "normal", parts: [{ kind: "static", name: "blog" }] },
			{
				kind: "normal",
				parts: [
					{ kind: "param", name: "slug" },
					{ kind: "static", name: ".json" },
				],
			},
		],
		groups: [],
	});
});

test("nested path → three segments", () => {
	const { segments } = parsePath("/a/b/c");
	assert.equal(segments.length, 3);
});

test("rejects a spread fused with siblings (pre-[...x])", () => {
	assert.throws(
		() => parsePath("/pre-[...x]"),
		/spread must own its whole segment/,
	);
	assert.throws(
		() => parsePath("/[...x]-suf"),
		/spread must own its whole segment/,
	);
});
