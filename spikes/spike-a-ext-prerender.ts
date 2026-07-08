// Fake package #1 (stands in for @routeur/prerender). Owns the `prerender` key on
// RouteConfigParts; its value is a flat discriminated union. After Merge this
// surfaces as flat top-level `{ prerender: true, getStaticPaths }` on config, with
// the `prerender: true ⟹ getStaticPaths` coupling intact and params resolved for P.
declare module "@fake/core" {
  interface RouteConfigParts<P extends string> {
    prerender:
      | { prerender?: false; getStaticPaths?: never } // off ⟹ no enumerator
      | {
          prerender: true
          getStaticPaths: () => Array<{ params: import("@fake/core").ParamsFor<P> }>
        }
  }
}
