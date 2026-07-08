// Spike A — key-per-extension config, merged flat (spec §7.6, revised).
// Confirms: (1) two INDEPENDENT extensions compose onto one RouteConfig<P>;
// (2) the prerender contribution surfaces as a FLAT top-level discriminated union
// (no doubled `prerender.prerender`); (3) `prerender: true ⟹ getStaticPaths` is a
// type error at author time; (4) params resolve for P inside getStaticPaths.
import type { RouteConfig } from "@fake/core"
import type { Equal, Expect, Simplify } from "./assert.ts"

type Config = RouteConfig<"/blog/[slug]">

// --- value-level authoring (how a route file writes `export const config`) ---

// dynamic prerender — flat, both extensions' fields side by side, params narrowed
export const dynamic: Config = {
  prerender: true,
  getStaticPaths: () => [{ params: { slug: "hello" } }],
  auth: { role: "admin" },
}

// @ts-expect-error not happy
export const missingPrerender: Config = {
	getStaticPaths: () => [{ params: { slug: "hello" } }],
	auth: { role: "admin" },
};

// prerender off + auth only
export const off: Config = { prerender: false, auth: { role: "editor" } }

// bare config (every field optional)
export const bare: Config = {}

// @ts-expect-error — coupling: prerender:true requires getStaticPaths
export const missingPaths: Config = { prerender: true }

export const wrongParam: Config = {
  prerender: true,
  // @ts-expect-error — params must match P ({slug}), not {nope}
  getStaticPaths: () => [{ params: { nope: "x" } }],
}

// @ts-expect-error — unknown fields rejected
export const unknownField: Config = { nope: 1 }

// --- type-level assertions ---

// auth (from ext #2) surfaces flat and optional: `auth?: { role: string }`
export type _Auth = Expect<Equal<Config["auth"], { role: string } | undefined>>

// the param-dependent field resolves getStaticPaths' params to { slug: string }
type DynamicArm = Extract<Config, { prerender: true }>
type EnumeratedParams = ReturnType<DynamicArm["getStaticPaths"]>[number]["params"]
export type _ParamsResolved = Expect<Equal<Simplify<EnumeratedParams>, { slug: string }>>

// `prerender` is a genuine TOP-LEVEL key of config (flat), not nested
export type _FlatKey = Expect<Equal<DynamicArm["prerender"], true>>
