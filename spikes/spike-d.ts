// Spike D — prove `ParamsOf<P>` computes the runtime param shape purely from a
// path literal (spec §5.3, §10): [x]→{x:string}, [...x]→{x:string|undefined},
// post-[id]→{id:string}, static→{}, composed across `/`-separated segments,
// with groups `(g)` contributing nothing.
import type { Equal, Expect, Simplify } from "./assert.ts"

// --- the type under test ---------------------------------------------------

// Required params inside one (non-spread) segment: extract every `[name]`.
// Mixed segments (`post-[id]`) and hypothetical multi-param segments both work.
type SegRequired<S extends string> = S extends `${string}[${infer Name}]${infer Rest}`
  ? { [K in Name]: string } & SegRequired<Rest>
  : {}

// One segment → its param contribution. A whole-segment spread is optional;
// the parser forbids fusing a spread with statics (`pre-[...x]`), so `[...x]`
// only ever appears as an entire segment.
type SegParam<S extends string> = S extends `[...${infer Name}]`
  ? { [K in Name]: string | undefined }
  : SegRequired<S>

// Split on `/` and intersect each segment's contribution.
type ParamsRaw<P extends string> = P extends `${infer Head}/${infer Tail}`
  ? SegParam<Head> & ParamsRaw<Tail>
  : SegParam<P>

type ParamsOf<P extends string> = Simplify<ParamsRaw<P>>

// --- assertions ------------------------------------------------------------

// single kinds
export type _Slug = Expect<Equal<ParamsOf<"/blog/[slug]">, { slug: string }>>
export type _Spread = Expect<
  Equal<ParamsOf<"/files/[...path]">, { path: string | undefined }>
>
export type _Mixed = Expect<Equal<ParamsOf<"/post-[id]">, { id: string }>>
export type _Static = Expect<Equal<ParamsOf<"/about">, {}>>
export type _Root = Expect<Equal<ParamsOf<"/">, {}>>

// composition across multiple segments
export type _TwoParams = Expect<
  Equal<ParamsOf<"/shop/[category]/[item]">, { category: string; item: string }>
>
export type _MixedNested = Expect<
  Equal<ParamsOf<"/blog/[slug]/post-[id]">, { slug: string; id: string }>
>
export type _SpreadAfterParam = Expect<
  Equal<ParamsOf<"/u/[user]/[...rest]">, { user: string; rest: string | undefined }>
>

// groups contribute no params (they are stripped from the URL, spec §4.1)
export type _Group = Expect<Equal<ParamsOf<"/(shop)/cart">, {}>>
export type _GroupWithParam = Expect<
  Equal<ParamsOf<"/(shop)/[item]">, { item: string }>
>

// catch-all page key
export type _CatchAll = Expect<
  Equal<ParamsOf<"/[...all]">, { all: string | undefined }>
>
