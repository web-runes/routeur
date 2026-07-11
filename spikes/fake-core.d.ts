// Stand-in for the published `@routeur/core`. Ambient (script-style: no top-level
// import/export) so the "extension package" files can augment `@fake/core` the
// way a real `@routeur/prerender` / `@routeur/auth` augments `@routeur/core`.
//
// Config-typing model (spec §7.6, revised): each extension augments the open
// `RouteConfigParts<P>` interface with ONE distinctly-named key whose value is
// that extension's flat contribution (and may itself be a discriminated union).
// The author-facing `RouteConfig<P>` MERGES those values, so the author writes a
// flat config — `{ prerender: true, getStaticPaths, auth: {...} }` — with no
// doubled `prerender.prerender`, while the interface stays open/composable and
// each contribution's coupling (prerender ⟹ getStaticPaths) is preserved.
declare module "@fake/core" {
  export type ParamsFor<P extends string> = P extends `${string}[${infer K}]${string}`
    ? { [Key in K]: string }
    : Record<string, never>

  // --- config merge internals (module-private) ---
  type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
    k: infer I,
  ) => void
    ? I
    : never
  // Intersect every key's contribution VALUE while preserving a contribution that
  // is itself a union: wrap under `v` so the union can't flatten into sibling
  // contributions, UnionToIntersection, then unwrap. => A & (B | C), a flat,
  // coupled top-level union.
  type Merge<T> = UnionToIntersection<{ [K in keyof T]: { v: T[K] } }[keyof T]> extends {
    v: infer M
  }
    ? M
    : never

  // Open + augmentable: one distinct key per extension. Two extensions never
  // collide because each owns its own key (unlike a single shared `config` slot).
  export interface RouteConfigParts<P extends string = string> {}

  // Author-facing merged config. Route files write `satisfies RouteConfig<'/x'>`.
  export type RouteConfig<P extends string = string> = keyof RouteConfigParts<P> extends never
    ? Record<string, never>
    : Merge<RouteConfigParts<P>>
}
