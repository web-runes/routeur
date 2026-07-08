# `@routeur` — Implementation Plan

**Companion to `ROUTER_SPEC.md`.** The spec is the source of truth for *what* to build; this plan covers *in what
order*, *how the repo is set up*, and *what to de-risk first*. Section references like (spec §7.5) point into the
spec.

---

## 0. Approach

Build in **dependency order** (spec §3's DAG), but prove the architecture with a **walking skeleton** before
breadth: the thinnest end-to-end slice — hardcoded manifest → React render → Hono response — that exercises both
seams. Everything after is filling in width (parser, conventions, plugin, second binding, extensions) against a
skeleton that already works.

The **type spikes** (§2) get pulled to the front regardless of dependency order: the generic-typing design has
three spots the spec flags as "verify against the real compiler," and if any fails the fallback changes the public
API — so we prove them before building on them. (The one other pre-Phase-1 unknown, the `Part`/`Segment` IR shape,
is now settled: keep the tagged union.)

---

## 1. Repo & tooling

Monorepo of scoped packages, ESM-only, Node 18+.

- [x] **pnpm workspaces** — one package per spec §3 row under `packages/*`.
- [x] **TypeScript** with project references across packages; `strict: true`; `module`/`moduleResolution:
      "nodenext"` (publish-safe ESM).
- [x] **Build**: `tsc --build` (via the project references above) emits ESM + `.d.ts` per package — no separate
      bundler. Author relative imports with explicit `.js` extensions so the emitted ESM resolves at runtime (the
      one cost of dropping a bundler). Bindings still need a **subpath exports map** (a `package.json` concern,
      independent of the build tool): `@routeur/react` (runtime, default) and `@routeur/react/plugin` (build half) are
      distinct entrypoints (spec §8), so `package.json#exports` declares `"."` and `"./plugin"`, each pointing at
      its compiled output.
- [x] **Test**: `vitest` for runtime + `vitest`'s `expectTypeOf` (and/or `tsd`) for type-level tests.
- [x] **Versioning**: `changesets` (independent versioning; consumers install a subset of the scope).
- [x] **Lint/format**: Biome (single tool) or eslint + prettier.
- [x] **CI**: install → generate fixtures' `routes.gen.ts` → typecheck → test → build. Note the ordering: the
      generated file must exist **before** `tsc` (spec §9.4).

Package build order (topological): `core` → (`fs`, `react`, `vue`, `hono`, `node`, `prerender`) → (`vite` needs
`fs`; `express` needs `node`).

---

## 2. De-risking spikes (do first, ~1–2 days)

Small throwaway TS files that prove the uncertain type mechanics. Each has a known fallback if it fails. Live in
`spikes/` (pure-TS spikes typecheck with the workspace `tsc`; `spikes/vue/` is an isolated Vue package).

- [x] **Spike A — generic interface augmentation merges.** ✅ **Green, and the design improved.** Confirmed two
      independent packages can augment a *generic* open interface with the identical `<P extends string>` signature
      and compose. The original nested-field shape (`config.prerender.prerender`) was replaced: each extension now
      augments `RouteConfigParts<P>` with **one namespaced key** whose value is its flat contribution (possibly a
      discriminated union), and `RouteConfig<P> = MergeParts<RouteConfigParts<P>>` flattens them. This yields a
      **flat** authored config (`{ prerender: true, getStaticPaths, auth }`), composes independent extensions
      without collision, keeps `prerender ⟺ getStaticPaths` coupled *both ways*, and resolves params for `P`. The
      fallback (non-generic bag) was **not** needed. Folded into spec §7.6, §10, §11.1.
- [x] **Spike B — SFC generic props resolve.** ✅ **Green.** `defineProps<RouteContext<'/blog/[slug]'>>()` in a real
      `.vue` under `vue-tsc` resolves the indexed access into the augmented `RouteRegistry` to `{ slug: string }`;
      an unknown param is a type error. (Astro `Props` check deferred — Astro is not a v1 binding.) Fallback
      (per-route named type) not needed.
- [x] **Spike C — Vue prop mutation under SSR.** ✅ **Green.** `props.response.status = 404` and
      `props.response.headers.set(...)` (nested mutation of `shallowReactive` props) during `renderToString` emit
      **no** warning and propagate back to the caller's `response` object. Fallback (`provide`/`inject`) not needed.
- [x] **Spike D — `ParamsOf<P>` template-literal type.** ✅ **Green.** Proved `[x]→{x:string}`,
      `[...x]→{x:string|undefined}`, `post-[id]→{id:string}`, static→`{}`, group segments contribute nothing, and
      composition across `/`-separated segments (spec §10, §5.3).

Exit criteria: **met — all four green.** No fallbacks required; Spike A refined the config-typing mechanism
(spec §7.6). The spikes remain in `spikes/` as living evidence; delete or fold into the Phase 1 type-tests later.

---

## 3. Phase 1 — `@routeur/core` foundation

The whole runtime spine. No framework or fs deps.

**IR & parsing**
- [x] Segment IR (spec §4) — tagged union: one `Part[]` per `normal` segment (mixed = multiple parts), plus
      `spread`; `Part` is `{ kind:'static'; name }` | `{ kind:'param'; name }`.
- [x] String-pattern parser: `/blog/[slug]`, `/files/[...path]`, `/(shop)/cart`, `/post-[id]`, index → segments.
      Reject illegal mixes (`pre-[...x]`) per spec §4.1.
- [x] `defineRoutes` (manual API, spec §6.1): parse + score authored entries into `RouteRecord`s.

**Matching & ranking (spec §5)**
- [x] Per-segment specificity scoring `static(3) > mixed(2) > param(1) > spread(0)`; lexicographic comparator;
      index tie-break.
- [x] Sorted-list matcher (compile a matcher per route; linear scan). *Trie is explicitly deferred.*
- [x] Trailing-slash normalization: strip one trailing slash, preserve root `/` (spec §5.2).
- [x] Param extraction, incl. spread = joined string / `undefined` at base (spec §5.3, Astro semantics).

**Dispatch & pipeline (spec §7)**
- [x] `RouteContext` (data-only, `RouteContextExtensions` open), `response` object, `redirect`/`error` +
      `Redirect`/`HttpError` sentinels.
- [x] Terminal `dispatch(route, binding, ctx)`: method resolution, component-is-GET, buffered render, fold
      `ctx.response`, 405 + `Allow`, catch redirect/error (spec §7.5).
- [x] `createRouter(manifest, { extensions })` → `Router` with `match`, `routes`, `handle` (config-load →
      extension onion → terminal dispatch) (spec §7.7).
- [x] `RouteConfig` open generic; `Extension` type; config read off the loaded metadata module → `ctx.config`.

**Types (definitions here; population in Phase 4)**
- [x] `RouteRegistry` (open), `ParamsFor`, `RouteContext<P>`, `RouteHandler<P>`, `RouteConfig<P>`, `href` (spec §10).

**Tests**
- [x] Unit: parser table, ranking order, matcher (static/param/spread/mixed/groups/index, slash-insensitive,
      spread base), dispatch (method table, status folding, redirect/error, 405).
- [x] Type: `ParamsOf`, `RouteContext<'/x'>` narrowing, `href` rejection of bad params.

**Exit:** `createRouter([...defineRoutes(...)])` matches and dispatches against a hand-written manifest; a fake
binding renders. No fs, no plugin yet.

---

## 4. Phase 2 — walking skeleton (first binding + adapters)

- [ ] `@routeur/react`: runtime binding `render` via `renderToReadableStream` (spec §8.1); build half at
      `@routeur/react/plugin` (`extensions`, `colocated: true`, `runtime`).
- [ ] `@routeur/hono`: `honoHandler({ router, binding })` → `router.handle` (spec §12).
- [ ] `@routeur/node`: `web ⇄ node` bridge; `@routeur/express`: thin wrapper (spec §12).

**Tests / exit:** hardcoded manifest served over Hono renders a React page (GET), runs an endpoint (POST), sets a
non-200 via `ctx.response`, and handles `throw redirect`/`error`. Same manifest served over Express proves the
bridge. **This is the architecture proven end-to-end.**

---

## 5. Phase 3 — `@routeur/fs` conventions

Turns a routes directory into manifest *data* (file references, not yet `import()` thunks — that's the plugin).

- [ ] Convention interface `(ctx) => ParsedRoute | null`; ship `folder` and `flat` (spec §6.3).
- [ ] "Both" = run both, merge, **conflict-detect** (same path from two sources → error naming both) (spec §6.3).
- [ ] Component/handler pairing by basename; `colocated` decides same-vs-sibling module; `config` export handling;
      component-plus-`GET`/`ALL` build error (spec §8.3).
- [ ] One binding per app (spec §1) — scanner takes a single build half.

**Tests:** fixture route trees → expected manifests; folder, flat, both; conflict cases; colocated vs sibling.

---

## 6. Phase 4 — `@routeur/vite` plugin

- [ ] Glob routes dir (by `binding.extensions`), invoke `@routeur/fs`, write **`src/routes.gen.ts`** (spec §9.1):
      binding re-export from the build half's `runtime`; manifest with lazy `() => import(...)` thunks; nothing
      else executed.
- [ ] **Typegen**: compute each `RouteRegistry` entry from the route's segments (reuse `ParamsOf` logic at build)
      and emit the augmentation block into `routes.gen.ts` (spec §10).
- [ ] **Path-literal verification**: compare each route file's annotation literal against its filename; error on
      mismatch; optional quick-fix/codemod (not on-save mutation) (spec §10.1).
- [ ] **HMR**: watch add/remove/rename → rewrite `routes.gen.ts` (spec §9.4).
- [ ] **Config**: `dir`, `binding`, `out`, `conventions` (spec §9.4). Gitignore `routes.gen.ts`; ship a one-shot
      generate CLI for the pre-`tsc` step.

**Tests:** snapshot generated `routes.gen.ts`; build a fixture app and assert **code splitting** (one chunk per
route `import()`); HMR add/remove regenerates; typegen fixture typechecks with narrowed params.

---

## 7. Phase 5 — `@routeur/vue` binding

- [ ] Runtime binding: `renderToString(createSSRApp(component, ctx))` — ctx as root props (spec §8.2); build half
      `colocated: false`.
- [ ] Exercise the sibling-`.ts` split (two specifiers) end-to-end through fs + plugin.
- [ ] Confirm Spike B/C outcomes hold in a real Vue fixture (`defineProps<RouteContext<'/…'>>()`, prop mutation).

**Tests:** Vue fixture app served over Hono; sibling handler/config; typed props.

---

## 8. Phase 6 — `@routeur/prerender` extension

- [ ] Augment `RouteConfig<P>` with the `prerender` discriminated union + `GetStaticPaths<P>` (params-only, no
      props) (spec §11.1).
- [ ] `collectPaths(router)`: filter on `config.prerender`, enumerate (static → one path; dynamic →
      `getStaticPaths`), **validate residual** (getStaticPaths on a static route; params mismatch) (spec §11.2).
- [ ] Ship the prerender loop as a convenience script using the bare terminal `dispatch` (no extension chain)
      (spec §11.3).

**Tests:** enumeration for static/dynamic; the compile-time coupling (type error when `prerender: true` omits
`getStaticPaths`); the runtime residual errors; a fixture prerender writing files.

---

## 9. Phase 7 — hardening & DX

- [ ] Error messages: path conflicts, component+GET, path-literal mismatch, prerender residual — all name file(s)
      and the fix.
- [ ] Two example apps (React, Vue) doubling as e2e fixtures.
- [ ] README per package; a getting-started that mirrors spec §13.
- [ ] Optional: radix-trie matcher behind the existing interface (spec §5.1) once route counts justify it.

---

## 10. Testing strategy (summary)

- **Unit** — parser, ranking, matcher, dispatch (core); convention parsing + conflicts (fs); collectPaths (prerender).
- **Type-level** — `expectTypeOf`/`tsd` for `ParamsOf`, `RouteContext<P>`/`RouteHandler<P>`/`RouteConfig<P>`
      narrowing, `href` rejection, the prerender union coupling. These guard the generics that spikes A/B/D prove.
- **Integration** — fs scan → generated file (snapshot); code-splitting assertion on a real Vite build; HMR.
- **E2E** — the example apps served over Hono and Express; assert status, headers, redirects, endpoints, prerender
      output.
- **Fixtures** — route-dir fixtures are the backbone; keep a matrix covering every segment kind × colocated/sibling
      × page/endpoint/mixed.

---

## 11. Risks & things to settle

- ~~**Generic typing (spikes A/B/D).**~~ **Resolved** — all three green (§2). Cross-package generic merge composes
      (via `RouteConfigParts<P>` + `MergeParts`), SFC generic-props resolve under `vue-tsc`, and `ParamsOf<P>`
      holds. The public typing API is settled; no fallback taken.
- **Code splitting via generated `import()`.** The whole code-splitting story rests on Rollup splitting the thunks
      in `routes.gen.ts`; assert it in a real build early in Phase 4, not at the end.
- **Prerender validation is lazy** (spec §11.2) — by design, an app that never prerenders won't hear about a
      malformed config. Acceptable per the spec; note it in `@routeur/prerender` docs so it isn't surprising.
- **Pre-load gating** (spec §7.6) — request hooks can't gate before a route's module loads. Fine for server auth;
      document it so nobody expects "don't even load the module" semantics.

---

## 12. Suggested milestone cut for v1

Ship when Phases 1–6 are green: core + React + Vue bindings + Hono/Express/Node adapters + Vite plugin (gen file,
typegen, HMR, code splitting) + `@routeur/prerender`. Defer to post-v1: the radix-trie matcher, additional adapters,
additional bindings, and a TS-plugin/codemod for auto-inserting path literals.
