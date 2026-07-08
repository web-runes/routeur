// Spike C — Vue prop mutation under SSR (spec §7.1). Confirms that mutating
// `props.response.status` / `props.response.headers` during renderToString:
//   (a) emits NO readonly/mutation warning, and
//   (b) propagates back to the caller's `response` object (so dispatch can fold it).
// The binding passes the whole RouteContext as root props (spec §8.2).
import { createSSRApp, defineComponent, h } from "vue"
import { renderToString } from "vue/server-renderer"

const warnings: string[] = []
const origWarn = console.warn
console.warn = (...args: unknown[]) => {
  warnings.push(args.map(String).join(" "))
}

// the object dispatch owns and later folds into the Response
const response = { status: 200, headers: new Headers() }
const ctx = { params: { slug: "hello" }, response }

const Page = defineComponent({
  props: ["params", "response"],
  // biome-ignore lint: spike uses `any` deliberately; typing is Spike B's job
  setup(props: any) {
    // NESTED mutation of a shallowReactive prop (spec §7.1) — the tested path
    props.response.status = 404
    props.response.headers.set("cache-control", "no-store")
    return () => h("main", `slug=${props.params.slug} status=${props.response.status}`)
  },
})

// ctx passed as root props, mirroring `createSSRApp(component, ctx)` in @routeur/vue
const html = await renderToString(createSSRApp(Page, ctx as Record<string, unknown>))
console.warn = origWarn

const mutationPropagated =
  response.status === 404 && response.headers.get("cache-control") === "no-store"
const readonlyWarnings = warnings.filter((w) =>
  /readonly|attempting to mutate prop|set operation .* failed/i.test(w),
)

console.log("rendered html:      ", html)
console.log("response.status:    ", response.status)
console.log("cache-control:      ", response.headers.get("cache-control"))
console.log("all warnings:       ", warnings)
console.log("readonly warnings:  ", readonlyWarnings)

if (!mutationPropagated) {
  console.error("FAIL: mutation did not propagate to the caller's response object")
  process.exit(1)
}
if (readonlyWarnings.length > 0) {
  console.error("FAIL: got readonly/mutation warning(s)")
  process.exit(1)
}
console.log("\nSPIKE C: PASS (nested response mutation, no readonly warning, propagated)")
