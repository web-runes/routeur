// Stand-in for @routeur/core's public types (spec §7, §10). Ambient so the SFC and
// the SSR script can `import ... from "@routeur/core"`.
declare module "@routeur/core" {
  export type Params = Record<string, string | undefined>

  // Open registry, augmented by the generated file (see routes.gen.d.ts).
  export interface RouteRegistry {}
  export type ParamsFor<P extends string> = P extends keyof RouteRegistry
    ? RouteRegistry[P]
    : Params

  export interface RouteContextExtensions {}
  export interface RouteContext<P extends string = string> extends RouteContextExtensions {
    params: ParamsFor<P>
    url: URL
    request: Request
    response: { status: number; headers: Headers }
  }
}
