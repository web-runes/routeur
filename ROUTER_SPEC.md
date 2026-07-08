# `@routeur` — Server Routing Library Specification

**Status:** Draft · **Audience:** implementers · **Scope:** design contract, not implementation

A framework-agnostic server routing library. Routes are authored file-based (folder,
flat, or both) or manually; they render UI-framework components (React, Vue, …) or act as
HTTP endpoints; and they are mounted into a server via adapters (Hono, Express, …).

> Placeholder scope: `@routeur`. Rename before publishing.

---

## 1. Goals and non-goals

### In scope

- **Route sources:** file-based (folder convention, flat convention, or both) and a manual API, freely mixable.
- **UI framework bindings** ("route" side): React, Vue, and others render a route's component to HTML.
- **Server adapters** ("using" side): Hono, Express, raw Node, and others mount routes as request handlers.
- **Route features:** static, index, slugs, spread/rest slugs, groups, mixed, nested (path nesting).
- **HTTP endpoints:** routes may export method handlers (`POST`/`PUT`/…) returning a `Response`; a component *is* the `GET` handler.
- **Customizable HTTP status / headers**, via a mutable per-request `response` on pages and returned `Response`s on endpoints — no config object.
- **Typed params:** generics where the path is a literal, codegen where it is not.
- **Extensions:** cross-cutting behavior (auth, caching, prerendering) attaches *on top* via a typed per-route
  `config` and request hooks passed to `createRouter` (§7.6–7.7). Prerendering is itself an extension
  (`@routeur/prerender`, §11), not a core feature.
- **Configurable** conventions, directories, extensions, generated-file location, etc.
- **Bundler integration:** a Vite plugin performing codegen, code splitting, typed routes, and HMR.

### Out of scope

- **Nested routes** in the react-router sense — parent/child route composition, shared layouts, `<Outlet>`.
  Note the deliberate distinction from **nested** (supported): nested *URL paths* from nested folders are in scope;
  nested *route rendering with layouts* is not.
- **Layouts.**
- **Data fetching / loaders.** Components receive `params` + `request` and are responsible for their own data.
  Core also ships **no built-in middleware**; cross-cutting request behavior is added by extensions (§7.7), not baked
  into core.
- **Mixed-framework routing.** One binding — one UI framework — per app. React `.tsx` and Vue `.vue` route files
  can't be mixed under a single router; the plugin takes exactly one binding (§8, §9.2).

---

## 2. Architecture — the two seams

The design hangs on two contracts. They make the *bindings × adapters* matrix additive (M + N) rather than
multiplicative (M × N).

### Seam 1 — the route manifest

Every route **source** compiles to one normalized structure (`RouteRecord[]`). Every route **consumer**
(the matcher, the adapters) reads only that structure. Sources never know about adapters; adapters never know
about files. Convention parsing and specificity scoring happen at **build time**; the runtime only builds a
matcher from already-normalized data.

### Seam 2 — the Web `Request`/`Response` boundary

Route resolution always produces a standard `Response`. Adapters bridge that `Response` to their platform.
Because both sides speak the web-standard interface, **any binding composes with any adapter**. The one platform
that isn't web-standard (Node/Express) gets a single `web ⇄ node` bridge in `@routeur/node`, reused by `@routeur/express`,
rather than the bridge being smeared across every binding.

```
 sources ─────────────┐                        ┌───────────── consumers
                       │                        │
 fs (folder/flat)      │                        │   matcher (core)
 manual (defineRoutes) ├──▶  RouteRecord[]  ──▶  ├──▶  adapters (hono/express/node)
 custom convention     │     (Seam 1)           │        │
                       │                        │        ▼  Web Response (Seam 2)
                       └────────────────────────┘   bindings render component → Response
```

### Beyond the seams — extensions

Cross-cutting concerns are **not** in core. `createRouter` accepts extensions (§7.7) that wrap dispatch with
request hooks and augment a typed per-route `config` (§7.6); prerendering is one such extension (§11). This keeps
the core a pure matcher + dispatcher — auth, caching, and prerender live in their own packages and attach on top,
using the same open-interface + module-augmentation mechanism the context and typed routes already use.

---

## 3. Package layout

Strict DAG. Nothing depends on a binding or an adapter; the application composes those leaves.

| Package         | Responsibility                                                                             | Depends on             |
|-----------------|--------------------------------------------------------------------------------------------|------------------------|
| `@routeur/core`     | IR types, matcher + ranking, `defineRoutes`, `createRouter` (+ extension composition), dispatch, `redirect`/`error`, `RouteConfig`/`Extension`/binding interfaces | — (zero runtime deps) |
| `@routeur/fs`       | Convention parsers (folder/flat/custom) → manifest + generated file. Reads a `BindingBuild`. Bundler-agnostic. | `@routeur/core` |
| `@routeur/vite`     | Thin Vite wrapper over `@routeur/fs`: writes `routes.gen.ts`, code-split, typegen, HMR          | `@routeur/fs`, `@routeur/core` |
| `@routeur/react`    | Binding — runtime half (default export). Build half at `@routeur/react/plugin`.                 | `@routeur/core`, react     |
| `@routeur/vue`      | Binding — runtime half (default export). Build half at `@routeur/vue/plugin`.                   | `@routeur/core`, vue       |
| `@routeur/hono`     | Adapter: router + `BindingRuntime` → Hono handler                                           | `@routeur/core`, hono      |
| `@routeur/node`     | Adapter: raw Node handler; hosts the `web ⇄ node` bridge                                    | `@routeur/core`            |
| `@routeur/express`  | Adapter: Express middleware (thin over `@routeur/node`)                                         | `@routeur/node`, express   |
| `@routeur/prerender`| Extension: `collectPaths(router)` + augments `RouteConfig` with `prerender`/`getStaticPaths` (§11) | `@routeur/core`      |

`@routeur/fs` is separate from `@routeur/vite` so a future `@routeur/webpack` / `@routeur/rspack` reuses all convention logic and
only reimplements the generate mechanics. Each binding splits into a build half (`@routeur/*/plugin`) the plugin reads,
and a runtime half the adapter calls (§8); the build half's `runtime` specifier is what the generated file
re-exports, so `render` never enters the plugin's own graph. **Extensions** are their own packages (`@routeur/prerender`,
and e.g. an illustrative `@routeur/auth`); core ships none of them.

---

## 4. Route IR

A route is a list of **segments**, with groups stripped and index-ness flagged. This structured form — not a
pattern string — is the canonical IR. String syntaxes and file conventions are *parsers* that produce it.

```ts
type Part =
  | { kind: 'static'; name: string }
  | { kind: 'param';  name: string }        // required, single segment

type Segment =
  | { kind: 'normal'; parts: Part[] }        // static | param | mixed
  | { kind: 'spread'; name: string }         // [...name] — zero or more segments

interface RouteRecord {
  id: string                 // stable unique id (file path or manual key)
  segments: Segment[]        // groups already stripped
  index: boolean
  score: number[]            // precomputed specificity (§5)
  meta: {
    groups: string[]         // captured group names — see §6.3
    [k: string]: unknown
  }
  loadComponent?: () => Promise<{ default: unknown }>   // component chunk
  loadHandlers?:  () => Promise<HandlerModule>          // handlers chunk
  // At least one of loadComponent / loadHandlers is present.
  // For colocated bindings these may resolve to the SAME specifier.
}

type RouteManifest = RouteRecord[]
```

### 4.1 Feature → IR mapping

| Feature          | Example              | IR                                                            |
|------------------|----------------------|--------------------------------------------------------------|
| static           | `/about`             | `normal` with one `static` part                              |
| index            | `/` (folder root)    | `index: true`; segments are the parent path                  |
| slug             | `/blog/[slug]`       | `normal` with one `param` part                               |
| spread / rest    | `/files/[...path]`   | `spread` segment — zero or more segments; value is a `string` (joined), `undefined` at base |
| group            | `/(shop)/cart`       | stripped from `segments`; name kept in `meta.groups`         |
| mixed            | `/post-[id]`         | `normal` with multiple parts: `[{static:'post-'},{param:'id'}]` |
| nested (path)    | `/a/b/c`             | three segments                                               |

A `spread` segment matches **zero or more** URL segments (Astro semantics). Its captured value is the remaining
path **joined as a string** (`/files/a/b` → `path: 'a/b'`), and **`undefined` at the base** (`/files` → `path:
undefined`), which is what lets one `[...path]` file also serve its own base path. That single construct covers the
base path and the catch-all case; there is no separate optional or one-or-more variant.

**Constraint:** mixed combines static + required `param` parts only within a single segment. A `spread` owns a
whole segment and cannot be fused with siblings; the parser rejects `pre-[...x]` and `[...x]-suf`.

### 4.2 Canonical string syntax

Used by the manual API and as typed-route keys. Bracket family — chosen because it composes with mixed
segments where `:slug` cannot:

```
/about              static
/blog/[slug]        param
/files/[...path]    spread
/(shop)/cart        group (→ /cart)
/post-[id]          mixed
```

---

## 5. Matching and ranking

When several routes match, the most specific wins. Score each segment, then compare routes **position by
position** (earlier segments dominate); index vs non-index breaks remaining ties in favor of the exact match.

```
static (3)  >  mixed (2)  >  param (1)  >  spread (0)
```

Examples:

- Path `/blog/new`: `/blog/new` → `[3,3]` beats `/blog/[slug]` → `[3,1]` at position 2. Static wins.
- Path `/`: an `index` route beats `/[...all]` → `[0]`. The spread only catches what nothing more specific claimed
  — the natural shape of a catch-all 404.

### 5.1 Engine

Ship the simple, obviously-correct version first: sort the manifest by `score` once, compile a matcher per route,
linear-scan on request. A radix trie (segment-per-level; buckets for static-map / mixed-regex-list / param /
spread, with backtracking for spread) is a drop-in optimization behind the same interface once route counts are
large. Do not start with the trie.

Mixed segments compile to a per-segment regex, e.g. `post-[id]` → `^post-(?<id>[^/]+)$`.

### 5.2 Trailing slashes

`match()` is **trailing-slash-insensitive**: the matcher normalizes the incoming pathname once — strip a single
trailing slash, except preserve root `/` — before matching, so `/about` and `/about/` resolve to the same route,
and `/` remains the base for an index route or a `spread` at root. This is internal normalization, not a policy.

The router deliberately has **no trailing-slash option** and takes no position on canonicalization. Deciding that
`/about/` should redirect to `/about` (or the reverse) is request preprocessing — the adapter's or host's job, not
the router's: Hono's `trimTrailingSlash` / `appendTrailingSlash` middleware, Express equivalents, or (in an Astro
app) Astro's `trailingSlash` config. See §12.

### 5.3 Params (runtime shape)

```ts
type Params = Record<string, string | undefined>   // undefined only reachable for a spread at the base
```

A `spread` param is the remaining path joined as a `string` (e.g. `'a/b/c'`), or `undefined` when the base path is
matched. All other params are always present strings. This mirrors Astro's rest parameters. Static typing of this
shape is covered in §10.

---

## 6. Route sources

All sources emit `RouteRecord[]`; they are unified at the manifest level and freely mixable.

### 6.1 Manual API — `defineRoutes`

`defineRoutes` is the **hand-written producer** of the manifest, the counterpart to the file scanner. It is not
magic: roughly `(records) => records.map(parseAndScore)`. It runs string paths through the same parser + scorer the
scanner uses, so a manual route is indistinguishable from a file route by the time it reaches the router. Because
each entry's `path` is a **string literal**, `defineRoutes` also infers that entry's param type (§10) and types its
handlers — no codegen needed on this path.

```ts
// src/routes.manual.ts
import { defineRoutes } from '@routeur/core'

export default defineRoutes([
  { path: '/healthz', GET: () => new Response('ok') },
  {
    path: '/blog/[slug].json',
    GET: (ctx) => Response.json({ slug: ctx.params.slug }),
    //   ctx.params.slug is inferred as string from the literal path
  },
])
```

An authored entry (`{ path, load?, POST?, PUT?, …, config? }`, or a `load` **or** a `GET` but not both —
§7.1) is compiled to a `RouteRecord` (segments + loaders). If you only use files, you never touch `defineRoutes`.

### 6.2 Composing fs + manual (canonical example)

```ts
// src/server.ts
import { manifest as fsRoutes, binding } from './routes.gen.ts'  // scanned + binding re-export
import manualRoutes from './routes.manual.ts'                       // hand-written
import { createRouter } from '@routeur/core'
import { honoHandler } from '@routeur/hono'

const router = createRouter([...fsRoutes, ...manualRoutes]) // merge + conflict-check
app.all('*', honoHandler({ router, binding }))
```

`createRouter` merges the arrays and runs conflict detection: two records normalizing to the same path is a build
error that names both origins. This is what makes "folder + flat + manual at once" safe.

### 6.3 File conventions

A convention is a function `(ctx: { filePath, relativePath }) => ParsedRoute | null`. Ship two, allow custom.

**Folder** (Next-ish, no layouts):

```
src/routes/about/index.tsx     → /about
src/routes/blog/[slug].tsx     → /blog/[slug]
src/routes/files/[...path].tsx → /files/[...path]
src/routes/(shop)/cart.tsx     → /cart      (meta.groups: ['shop'])
```

**Flat** (Remix-ish): `.` separates segments; needs a dot-escape rule for literal dots.

```
src/routes/blog.[slug].tsx     → /blog/[slug]
src/routes/blog._index.tsx     → /blog (index)
```

**Both** = run both parsers, merge, and detect conflicts (same rule as §6.2).

**Groups as an adapter hook.** Layouts are out of scope, so groups do not affect URLs — but `meta.groups` lets an
adapter act on them: mount everything in `(api)` under different middleware, apply auth to `(admin)`, etc. Groups
gain a purpose beyond folder tidiness without introducing layouts.

---

## 7. The request pipeline (handlers, status, config, extensions)

Status/headers are **not** a config object. There are two shapes of route logic, and a hard rule that keeps them
from overlapping:

- A **component** *is* the `GET` handler. Present a component and the binding renders it for `GET`.
- **Endpoint handlers** (`POST`/`PUT`/`PATCH`/`DELETE`/`ALL`) return a `Response` and coexist with a component.
- A route may **not** declare both a component and an explicit `GET`/`ALL` handler — that is ambiguous and throws
  at build/dev time (§7.4, §8.3). This is what lets `render()`/`view()` not exist: no handler ever needs to render
  the component, because a handler and the component are never the same method on the same route.

```ts
type Params = Record<string, string | undefined>

interface RouteRegistry {}                             // open; augmented by src/routes.gen.ts (§10)
type ParamsFor<P extends string> = P extends keyof RouteRegistry ? RouteRegistry[P] : Params

interface RouteConfig<P extends string = string> {}    // open generic; extensions augment (§7.6)
interface RouteContextExtensions {}                    // open for augmentation — see §7.2

interface RouteContext<P extends string = string> extends RouteContextExtensions {
  params: ParamsFor<P>          // typed from the registry for a known path; Params otherwise
  url: URL
  request: Request
  response: { status: number; headers: Headers }   // mutable; defaults to 200 / empty
  config: RouteConfig<P>        // the route's resolved `export const config` (§7.6)
}

type RouteHandler<P extends string = string> =
  (ctx: RouteContext<P>) => Response | Promise<Response>   // endpoints return a Response. No View.

interface HandlerModule {
  POST?: RouteHandler
  PUT?: RouteHandler
  PATCH?: RouteHandler
  DELETE?: RouteHandler
  ALL?: RouteHandler                // fallback for any method
  GET?: RouteHandler                // allowed ONLY when the route has no component
  config?: RouteConfig              // static metadata for extensions — see §7.6
  // note: getStaticPaths is NOT a core export; it lives inside `config`, owned by @routeur/prerender (§11)
}
```

A route file types its props/handlers/config by passing **its own path** as the generic —
`RouteContext<'/blog/[slug]'>`, `RouteHandler<'/account'>`, `RouteConfig<'/blog/[slug]'>` — the same annotation
style Vue's `defineProps<T>()` and Astro's `interface Props` already use. The path resolves to concrete params
through the registry that the generated file augments (§10). No per-route generated type to import, no wrapper
function. This is the through-line of the whole typing design: **every per-route annotation is keyed by the path
literal.**

A **page** customizes its own response by mutating `ctx.response` (status and headers) during render — the exact
mental model of Astro's `Astro.response`, made portable across bindings. The binding renders **buffered** (fully,
then flushes), so whatever the component set on `ctx.response` is known before the final `Response` is built. See
§7.3 for the streaming trade-off.

To **abort** — from an endpoint handler or from within a page render — throw one of two sentinels from `@routeur/core`:

```ts
function redirect(location: string, status?: 301 | 302 | 303 | 307 | 308): never   // → bodyless redirect
function error(status: number, body?: BodyInit): never                              // → renders the [...all] page at `status`
```

`redirect` short-circuits to a `Location` response; `error` renders the designated catch-all page (§7.4) at the
given status. Both are caught in dispatch (§7.5).

### 7.1 Reading/writing `response` per binding

`ctx.response` is a plain, mutable data field — not a method — so the context stays augmentable (§7.2). Both
bindings pass the whole `RouteContext` to the component as **root props**, so it's read the same way on either side:

- **React**: destructure a typed props param — `function Page({ params, response }: RouteContext<'/blog/[slug]'>)`.
- **Vue**: `const { params, response } = defineProps<RouteContext<'/blog/[slug]'>>()`.

Mutating `response` from a Vue SFC works directly (`response.status = 404`, `response.headers.set(...)`): Vue's
component props are `shallowReactive`, so nested mutation isn't guarded and needs no composable or `provide`/
`inject`. Endpoint handlers receive `ctx` directly and can mutate `ctx.response` too, though they more often just
return a `Response`.

### 7.2 Extending the context (module augmentation)

`RouteContext` extends an open `RouteContextExtensions` interface, so an adapter or the application can add fields
via TS module augmentation. Core guarantees `params`/`url`/`request`/`response`; whatever augments the interface
must be populated by the adapter that builds the context.

```ts
// user or adapter
declare module '@routeur/core' {
  interface RouteContextExtensions {
    locals: Record<string, unknown>   // e.g. adapter-provided platform values
  }
}
```

Because data fetching and middleware are out of scope, augmentation mainly surfaces adapter/platform values (a
Hono adapter exposing `env`, a Node adapter exposing the raw `req`, etc.) rather than user-loaded data.

### 7.3 Buffered rendering

A page can set its status *during* render, so the status isn't known until render completes — which is
incompatible with streaming SSR, where headers flush first. Pages therefore render **buffered** by default: render
to completion, read `ctx.response`, then send. Streaming SSR is a later opt-in that trades away mid-render status
changes. For a server that mirrors Astro's model, buffered is a comfortable default, not a real loss.

### 7.4 Examples (consumer side)

Plain page — the component is `GET`, renders at 200, nothing else needed:

```tsx
// src/routes/index.tsx
import type { RouteContext } from '@routeur/core'
export default function Home(_: RouteContext<'/'>) {   // params: {}
  return <main><h1>The Blog</h1><PostList /></main>
}
```

Soft 404 with a real body + a cache header — mutate `ctx.response`, still render the component's own markup:

```tsx
// src/routes/blog/[slug].tsx
import type { RouteContext } from '@routeur/core'
export default async function Post({ params, response }: RouteContext<'/blog/[slug]'>) {
  const post = await getPost(params.slug)   // params.slug: string
  if (!post) {
    response.status = 404
    return <NotFound slug={params.slug} />
  }
  response.headers.set('cache-control', 'public, max-age=300')
  return <Article post={post} />
}
```

Component + `POST` on one route path — the component is `GET`, `POST` sits in a sibling file (Vue, `colocated:
false`). The SFC types its props with the same path generic via Vue's standard `defineProps`:

```vue
<!-- src/routes/account.vue  (GET) -->
<script setup lang="ts">
import type { RouteContext } from '@routeur/core'
const { response } = defineProps<RouteContext<'/account'>>()
response.headers.set('cache-control', 'private, no-store')
const user = await getCurrentUser()
</script>
<template><ProfileForm :user="user" /></template>
```

```ts
// src/routes/account.ts  (POST) — coexists with account.vue
import { redirect, type RouteHandler } from '@routeur/core'
export const POST: RouteHandler = async ({ request }) => {
  await saveProfile(await request.formData())
  return redirect('/account', 303)   // Post/Redirect/Get
}
```

Abort before rendering — `throw redirect(...)` from inside a page (catchable because rendering is buffered):

```tsx
// src/routes/login.tsx
import { redirect } from '@routeur/core'
import type { RouteContext } from '@routeur/core'
export default async function Login({ request }: RouteContext<'/login'>) {
  if (await isAuthed(request)) throw redirect('/account')
  return <LoginForm />
}
```

Pure endpoint — no component, so `GET` is allowed here; unhandled methods get an automatic `405`:

```ts
// src/routes/api/posts.ts
import { error, type RouteHandler } from '@routeur/core'
export const GET: RouteHandler = async () => Response.json(await listPosts())
export const POST: RouteHandler = async ({ request }) => {
  const draft = await request.json()
  if (!draft.title) throw error(422, 'title required')
  return Response.json(await createPost(draft), { status: 201 })
}
```

The catch-all page — `error()` and unmatched paths render this at the thrown/`404` status:

```tsx
// src/routes/[...all].tsx
import type { RouteContext } from '@routeur/core'
export default function CatchAll({ url }: RouteContext<'/[...all]'>) {   // params.all: string | undefined
  return <main><h1>404</h1><p>No page at {url.pathname}</p></main>
}
```

### 7.5 Dispatch

No `view`, no `View`; a page is auto-rendered buffered, `ctx.response` is folded into the final `Response`, and the
two throwables are caught here.

```ts
async function dispatch(route, binding, base): Promise<Response> {
  const ctx       = { ...base, response: { status: 200, headers: new Headers() } }
  const method    = ctx.request.method === 'HEAD' ? 'GET' : ctx.request.method
  const handlers  = route.loadHandlers  ? await route.loadHandlers()  : null
  const component = route.loadComponent ? (await route.loadComponent()).default : undefined

  try {
    const fn = handlers?.[method] ?? handlers?.ALL
    if (fn) return await fn(ctx)                              // endpoint: returns its own Response

    if (method === 'GET' && component) {
      const rendered = await binding.render(component, ctx)   // BUFFERED → ctx.response now final
      return new Response(rendered.body, {
        status:  ctx.response.status,
        headers: mergeHeaders(rendered.headers, ctx.response.headers),
      })
    }
    return new Response(null, { status: 405, headers: { Allow: allowed(handlers, component) } })
  } catch (e) {
    if (e instanceof Redirect)  return new Response(null, { status: e.status, headers: { Location: e.location } })
    if (e instanceof HttpError) return renderError(route, binding, ctx, e.status)   // → [...all] page
    throw e
  }
}
```

An endpoint handler wins for its method; `GET` on a component auto-renders (buffered); anything unhandled is a
`405` with a correct `Allow` header. `ctx` carries no render capability — pages express status through
`ctx.response`, endpoints through their returned `Response`.

### 7.6 Route config

A route carries metadata as a runtime export, `config`, on its metadata module (the sibling `.ts` for an SFC
binding, the component's own file for a colocated one). `RouteConfig<P>` is an **open generic** interface each
extension augments — core never names a field — and it is keyed by the path so config fields that depend on params
(like a prerender enumerator) type correctly:

```ts
// @routeur/prerender augments it (§11)
declare module '@routeur/core' {
  interface RouteConfig<P extends string> {
    prerender?:
      | { prerender: false }
      | { prerender: true; getStaticPaths: GetStaticPaths<P> }   // required when prerender is true
  }
}
// an illustrative @routeur/auth
declare module '@routeur/core' {
  interface RouteConfig<P extends string> { auth?: { role: string } }
}
```

Authored like the other annotations — path literal, `satisfies`:

```ts
// src/routes/blog/[slug].ts
export const config = {
  prerender: true,
  getStaticPaths: () => listSlugs().map((slug) => ({ params: { slug } })),   // params.slug: string
} satisfies RouteConfig<'/blog/[slug]'>
```

`config` is a **runtime** export (not statically analyzed), so it may be computed. Dispatch loads the route's
metadata module, reads `config`, and surfaces it as `ctx.config` for components and extensions. The one consequence:
a request hook cannot gate *before* the module loads — flow is match → load config → run hooks → dispatch — so an
extension can inspect `config` but can't prevent the module from loading. For server-side use this is fine (no
handler/render runs on rejection, nothing leaks); a genuine pre-load decision would have to escalate that field to
the manifest, which is not the default.

### 7.7 Extensions (request pipeline)

Cross-cutting behavior attaches through extensions passed to `createRouter`. An extension contributes a `request`
hook; `createRouter` composes the hooks into an onion whose terminal is the dispatch of §7.5. **Core has no
middleware of its own** — this is the sanctioned seam for adding it.

```ts
// @routeur/core
type Next = () => Promise<Response>
interface Extension {
  name: string
  request?: (ctx: RouteContext, route: RouteRecord, next: Next) => Response | Promise<Response>
}

function createRouter(manifest: RouteManifest, opts?: { extensions?: Extension[] }): Router
```

Auth is then a few lines in its own package, gating on the typed `ctx.config`:

```ts
// @routeur/auth (illustrative)
import { redirect } from '@routeur/core'
export const auth = (): Extension => ({
  name: 'auth',
  request: (ctx, route, next) =>
    ctx.config.auth && !allowed(ctx, ctx.config.auth) ? redirect('/login') : next(),
})
```

```ts
const router = createRouter(manifest, { extensions: [auth()] })
```

Extensions that only need build-time behavior (like prerendering) don't use a `request` hook at all — they read the
router from outside (§11). The `Router` surface: `match(pathname)`, `routes`, and `handle(request, binding)` — the
composed pipeline (config load → request-hook onion → terminal dispatch) that adapters call (§12). The bare terminal
`dispatch(route, binding, ctx)` is a separate core export for callers that want rendering without the extension
chain (the prerender script, §11.3).

---

## 8. Bindings — file shape is binding-dependent

The handler contract (`default` + named `GET`/`POST`/…, plus `config`) is **universal** plain-module exports.
The only framework-specific question is whether those exports may **share a file** with the component. That is one
boolean per binding.

> This is a **binding** concern, not an **adapter** concern. Adapters only ever see the compiled manifest with
> loader functions; they never see a file. Hono vs Express is irrelevant to file shape.

A binding is **two** interfaces defined in `@routeur/core` — a light build half the plugin reads at scan time, and a
runtime half the adapter calls per request:

```ts
// @routeur/core
interface BindingBuild {
  extensions: string[]   // component file extensions this binding owns
  colocated: boolean      // may handlers/config share the component file?
  runtime: string         // module specifier of the runtime half — re-exported by routes.gen.ts (§9.2)
}

interface BindingRuntime {
  render(component: unknown, ctx: RouteContext): Response | Promise<Response>
}
```

The split exists so `render` (and its framework SSR deps) never enters the plugin's own graph: the plugin imports
only the build half. What ties the halves together is the build half's **`runtime`** field — a module specifier
the plugin writes into the generated file as `export { default as binding } from '<runtime>'` (§9.2). So the
binding is configured once, in the Vite plugin (build half), and the server reads the runtime binding from the
generated file. Each binding package ships both: `@routeur/react/plugin` (build) and `@routeur/react` default export
(runtime).

### 8.1 React — `colocated: true`

Everything lives in one `.tsx`. `loadComponent` and `loadHandlers` resolve to the **same specifier**; the
dispatcher reads different exports off the one module.

```ts
// @routeur/react  (runtime half)
export const react = (): BindingRuntime => ({
  render: async (Component, ctx) =>
    new Response(await renderToReadableStream(<Component {...ctx} />),
      { headers: { 'content-type': 'text/html' } }),
})
export default react()   // ← this is what routes.gen.ts re-exports as `binding`
```

```ts
// @routeur/react/plugin  (build half — light, no render)
export const react = (): BindingBuild => ({
  extensions: ['.tsx', '.jsx'],
  colocated: true,
  runtime: '@routeur/react',   // re-exported by the generated file
})
```

### 8.2 Vue — `colocated: false`

The SFC exports only the component, so handlers/`config` go in a sibling `.ts` of the same basename;
`loadComponent` and `loadHandlers` resolve to **two specifiers**.

```ts
// @routeur/vue  (runtime half)
export const vue = (): BindingRuntime => ({
  render: async (component, ctx) =>
    new Response(await renderToString(createSSRApp(component, ctx)),   // ctx as root props
      { headers: { 'content-type': 'text/html' } }),
})
export default vue()

// @routeur/vue/plugin  (build half)
export const vue = (): BindingBuild => ({ extensions: ['.vue'], colocated: false, runtime: '@routeur/vue' })
```

```
src/routes/blog/[slug].vue     ← component (this IS GET)
src/routes/blog/[slug].ts      ← POST/PUT/…, config (no GET/ALL — see §8.3)
```

A React dev writing one `.tsx` and a Vue dev writing `.vue` + `.ts` exercise the same rule with the flag flipped —
no separate code path. A React dev who *wants* a sibling `.ts` still may; `colocated` means they don't have to.

### 8.3 Scanner rules (per route path)

Given the build half passed to the plugin (one binding per app — §1):

1. **Component file** = a file whose extension ∈ `binding.extensions`.
2. **Handler source** = a sibling `.ts`/`.js` of the same basename (always allowed), **plus** the component
   file's own named exports **iff** `binding.colocated`.
3. Same method or `config` exported from both the co-located file and a sibling → conflict error
   (consistent with the path-conflict rule).
4. **Component-plus-`GET`/`ALL` → build error** (Proposal B). The component *is* `GET`, so an explicit one is
   ambiguous. `POST`/`PUT`/`PATCH`/`DELETE` may coexist with a component; `GET`/`ALL` may not.
5. A route may be **handlers-only** (pure endpoint) or **component-only** (plain page).

The check runs in the scanner and again in `createRouter` (so manual routes are covered too), and throws with the
route id and both offending sources:

```
[@routeur] Route "/blog/[slug]" has both a component and a GET handler.
       The component is the GET handler. Remove one:
         • src/routes/blog/[slug].tsx  (default export → GET)
         • src/routes/blog/[slug].tsx  (export const GET)
       POST/PUT/PATCH/DELETE may coexist with a component; GET/ALL may not.
```

---

## 9. Bundler plugin (Vite)

The plugin scans the configured directory(ies) and writes **one real file** to the user's project —
`src/routes.gen.ts` (gitignored, path configurable) — regenerated on watch. This single file replaces both the
old virtual manifest module and any per-route type modules. It is TanStack Router's `routeTree.gen.ts` posture.

### 9.1 The generated file

```ts
// src/routes.gen.ts — generated, do not edit
export { default as binding } from '@routeur/react'   // ← the build half's `runtime` specifier (§8)

export const manifest = [
  { id: 'blog/[slug]', segments: [/*…*/], index: false, score: [3,1], meta: { groups: [] },
    loadComponent: () => import('./routes/blog/[slug].tsx'),
    loadHandlers:  () => import('./routes/blog/[slug].tsx') },   // same specifier: colocated
  { id: '[...all]', segments: [/*…*/], index: false, score: [0], meta: { groups: [] },
    loadComponent: () => import('./routes/[...all].tsx') },
  // …
]

// the only type output — the app-wide param registry (§10)
declare module '@routeur/core' {
  interface RouteRegistry {
    '/blog/[slug]': { slug: string }
    '/[...all]':    { all: string | undefined }
    // …
  }
}
```

Three jobs in one file: **re-export the runtime binding** (from the build half's `runtime` specifier), **export the
manifest** (real code, so Rollup still splits each `import()` into its own chunk — code splitting is unchanged), and
**augment `RouteRegistry`** (the sole type output). Because it's a real module, HMR is ordinary file-change
propagation — no virtual-module invalidation.

### 9.2 Build vs runtime binding

The plugin takes a **build half** (§8) — `{ extensions, colocated, runtime }` — and nothing else. `render` never
enters the plugin's graph.

1. `extensions` + `colocated` drive the scan (below).
2. `runtime` is written verbatim into `routes.gen.ts` as `export { default as binding } from '<runtime>'`. That
   is the "difference": the generated file re-exports the runtime binding that the build half points at, so the
   binding is configured **once** (in the Vite plugin) yet the server imports it from the generated file.

The scan:

1. Glob the routes dir for files whose extension ∈ `binding.extensions` (components) and `.ts`/`.js` (handlers).
2. Parse each path to segments via the configured convention(s); group component + handler files per route path.
3. `colocated` decides loader wiring: if `true` and a route has only its component file, `loadComponent` and
   `loadHandlers` point at the **same specifier**; if `false`, handlers come from the sibling `.ts` — **two
   specifiers**.
4. Write `routes.gen.ts`: binding re-export + manifest + `RouteRegistry` augmentation (§10). The registry entries
   are computed from each route's **segments**, so typegen needs the binding only for `extensions`.
5. Verify each route file's path literal against its filename (§10) and report mismatches.

Rendering happens solely at request time in the adapter path, so build and request stay cleanly separated.

### 9.3 Wiring — binding configured once (build), read from the generated file (runtime)

```ts
// vite.config.ts
import { routes } from '@routeur/vite'
import { react } from '@routeur/react/plugin'   // build half
export default defineConfig({
  plugins: [routes({ dir: 'src/routes', binding: react() })],
})
```

```ts
// server.ts — binding + manifest both come from the generated real file
import { manifest, binding } from './routes.gen.ts'
import { createRouter } from '@routeur/core'
import { honoHandler } from '@routeur/hono'
app.all('*', honoHandler({ router: createRouter(manifest), binding }))
```

### 9.4 HMR + configuration

A watcher on the routes dir rewrites `routes.gen.ts` on add/remove/rename; HMR follows the file change.

```ts
routes({
  dir: 'src/routes',
  binding: react(),                 // build half — one binding (one UI framework) per app
  out: 'src/routes.gen.ts',         // generated file location (gitignored); default shown
  conventions: ['folder', 'flat'],  // or a custom (ctx) => ParsedRoute | null
})
```

Because the generated file is real, a bare `tsc --noEmit` in CI needs it to exist first — run the plugin's generate
step (or a one-shot CLI) before typechecking, the same way TanStack Router does.

---

## 10. Typing params — one registry, path-literal generics

There are no per-route generated type modules. Instead, the generated file (§9.1) augments a single open interface,
`RouteRegistry`, mapping each route path to its param shape. Route files, `href`, and the manual API all read from
there.

```ts
// @routeur/core
interface RouteRegistry {}                               // open; augmented by routes.gen.ts
type ParamsFor<P extends string> = P extends keyof RouteRegistry ? RouteRegistry[P] : Params

function href<P extends keyof RouteRegistry>(path: P, params: ParamsFor<P>): string
```

```ts
// src/routes.gen.ts  (generated) — the only place types are produced
declare module '@routeur/core' {
  interface RouteRegistry {
    '/blog/[slug]':     { slug: string }
    '/files/[...path]': { path: string | undefined }
    '/[...all]':        { all: string | undefined }
  }
}
```

### 10.1 In a route file — pass the path as the generic

A route file names its own path in the type annotation; `RouteContext<P>` / `RouteHandler<P>` resolve params via
`ParamsFor<P>`. Standard function, standard `defineProps` — no wrapper, no per-route import.

```tsx
// React — standard function, typed props param
export default function Post({ params }: RouteContext<'/blog/[slug]'>) { /* params.slug: string */ }
```
```vue
<!-- Vue — standard defineProps -->
<script setup lang="ts">
const { params } = defineProps<RouteContext<'/blog/[slug]'>>()   // params.slug: string
</script>
```

The props parameter has to be annotated either way (TS can't infer a route component's props). Passing the path is
the **opt-in for narrowed params**: `RouteContext<'/blog/[slug]'>` gives `{ slug: string }`, while plain
`RouteContext` leaves `params` as the loose `Params`. So a route without the path literal still compiles — you just
don't get narrowing for it.

When a path literal *is* present it duplicates the filename, so the plugin **verifies the two agree and errors on
mismatch** (the same guard TanStack applies to its route strings) — catching typos and stale literals after a
move/rename. The plugin does **not** rewrite your source: inserting or correcting the literal is an editor
quick-fix / one-shot codemod you invoke, not an on-save mutation. (Fully automatic per-file typing like Astro's
`Astro.params` would require owning the framework compiler, which we don't for `.tsx`/`.vue`; a TS language-service
plugin could do it in-editor but wouldn't be seen by a `tsc` build.)

### 10.2 In the manual API — pure inference, no registry needed

`defineRoutes` entries carry the path as a literal already, so a template-literal type infers params directly —
these routes don't need a registry entry:

```ts
type ParamsOf<P extends string> = /* [x]→{x:string}; [...x]→{x: string | undefined}; post-[id]→{id:string}; static→{} */

defineRoutes([
  { path: '/x/[id].json', GET: (ctx) => Response.json(ctx.params.id) },   // ctx.params.id: string
])
```

So the split is: **`ParamsOf` (pure generics)** types any literal path — the manual API, and internally the plugin
uses it to compute each registry entry from a route's segments; **the one generated `RouteRegistry`** turns those
same path literals into a closed, checked set for file routes and `href`. Both ride one TS feature — an open
interface plus module augmentation — the same mechanism the context (§7.2) and route config (§7.6) use.

Every per-route annotation is keyed by the path literal — `RouteContext<P>`, `RouteHandler<P>`, `RouteConfig<P>` —
and each resolves params through `ParamsFor<P>`. So a config field like the prerender enumerator
(`getStaticPaths: GetStaticPaths<'/blog/[slug]'>`, §11) is param-typed for free. One caveat to verify against the
real compiler: `RouteConfig<P>` is a *generic* open interface, so each extension must declare its augmentation with
the identical `<P extends string>` signature for declaration merging to compose — finickier than the non-generic
`RouteContextExtensions` merge.

---

## 11. Prerendering (`@routeur/prerender`)

Prerendering is an **extension**, not a core feature — core has no build step, no `getStaticPaths`, no SSG code.
`@routeur/prerender` provides two things: it augments `RouteConfig<P>` (§7.6) with the `prerender` field, and it exports
a standalone `collectPaths(router)`.

### 11.1 Config coupling (typed at author time)

`prerender` is a discriminated union, so the compiler enforces "prerender ⟹ enumerator" at the config site — not as
a build error, but as a type error the moment you write it:

```ts
declare module '@routeur/core' {
  interface RouteConfig<P extends string> {
    prerender?:
      | { prerender: false }
      | { prerender: true; getStaticPaths: GetStaticPaths<P> }   // omit getStaticPaths → type error
  }
}
```

`getStaticPaths` returns **params only** — unlike Astro there is no `props` channel (data fetching is out of scope,
§1). A prerendered page fetches its own data during render, exactly as an on-demand page does; the build runs that
render once per enumerated param combo.

```ts
type GetStaticPaths<P extends string> =
  () => Array<{ params: ParamsFor<P> }> | Promise<Array<{ params: ParamsFor<P> }>>
```

### 11.2 `collectPaths` — outside core, outside the runtime router

`collectPaths(router)` reads the router from the outside; the runtime `Router` your server ships stays
`match()` + `routes` + the request chain, with no SSG surface. It owns three jobs core never sees:

```ts
// @routeur/prerender
export async function collectPaths(
  router: Router,
): Promise<Array<{ path: string; route: RouteRecord; params: Params }>>
```

1. **Filter** to routes whose `config.prerender` is `true` (it loads each route's metadata module to read `config`).
2. **Enumerate** — a static route contributes its one path; a dynamic route's `config.getStaticPaths` is called for
   the param list. `getStaticPaths` is purely `@routeur/prerender`'s vocabulary.
3. **Validate** the residual the type system can't see: `prerender: true` on a *static* route (no params) with a
   `getStaticPaths` present, or a dynamic prerender route whose enumerator returns params that don't match the
   route's names. These throw here. (The `prerender: true ⟹ getStaticPaths` half is already a compile error, §11.1.)

Because validation lives in `collectPaths`, it is **lazy** — an app that never runs the prerender step never hears
about a malformed static/dynamic combination. Consistent with prerender being bolted on.

### 11.3 The prerender step is your script

```ts
// prerender.ts
import { collectPaths } from '@routeur/prerender'
import { manifest, binding } from './routes.gen.ts'
import { createRouter, dispatch } from '@routeur/core'

const router = createRouter(manifest)
for (const { path, params, route } of await collectPaths(router)) {
  const res = await dispatch(route, binding, ctxFor(path, params))
  await writeFile(outFile(path), await res.text())
}
```

Rendering reuses the **same** `binding.render` as SSR — no second render path. `@routeur/prerender` may ship this loop
as a convenience, but it isn't privileged; you could write it in a dozen lines yourself.

---

## 12. Adapters

The adapter owns platform specifics and nothing else.

**Hono** (already web-standard — trivial):

```ts
// @routeur/hono
export const honoHandler = ({ router, binding }) => async (c) => {
  const res = await router.handle(c.req.raw, binding)   // match → config → extension chain → dispatch
  return res ?? c.notFound()
}
```

`router.handle` (from `createRouter`) is the composed pipeline: it matches, loads `config`, runs the extension
request hooks (§7.7) as an onion, and terminates in the dispatch of §7.5. The bare `dispatch(route, binding, ctx)`
is also exported for callers that want the terminal *without* extensions — the prerender script uses it (§11.3) so
that request hooks like auth don't run during a build render.

**Express** — not web-standard, so `@routeur/node` provides the single `web ⇄ node` bridge (build a `Request` from
`req`; stream a `Response` back to `res`) and `@routeur/express` is a thin wrapper over it. Every binding's `render`
and every handler already produce a web `Response`, so the bridge exists in exactly one place.

An adapter that augments the context (§7.2) is responsible for populating the added fields before handing the
request to `router.handle`.

**URL canonicalization** (trailing-slash redirects, case-folding, and the like) is the adapter's or host's
responsibility, not the router's — `match()` is already slash-insensitive (§5.2), so this is purely about which URL
you want to be canonical. Layer it as middleware ahead of `router.handle`: Hono's `trimTrailingSlash` /
`appendTrailingSlash`, an Express equivalent, or — in an Astro app — Astro's own `trailingSlash` handling.

---

## 13. End to end

```ts
// vite.config.ts
import { routes } from '@routeur/vite'
import { react } from '@routeur/react/plugin'   // build half
export default defineConfig({ plugins: [routes({ dir: 'src/routes', binding: react() })] })
```

```ts
// server.ts
import { Hono } from 'hono'
import { manifest, binding } from './routes.gen.ts'   // generated: manifest + runtime binding re-export
import { createRouter } from '@routeur/core'
import { honoHandler } from '@routeur/hono'
import { auth } from '@routeur/auth'                       // an extension (illustrative)

const router = createRouter(manifest, { extensions: [auth()] })   // extensions register here (§7.7)
const app = new Hono()
app.all('*', honoHandler({ router, binding }))
```

Swap `react()` for `vue()` in the Vite config, or `honoHandler` for the Express adapter, independently. Add
behavior — auth, caching — by passing more extensions; prerender via a separate `collectPaths` script (§11). That
independence is the design working as intended.
