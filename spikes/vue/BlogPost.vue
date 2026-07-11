<!-- Spike B — SFC generic props resolve. `defineProps<RouteContext<'/blog/[slug]'>>()`
     must resolve params via the augmented RouteRegistry to { slug: string }. Compiled
     with vue-tsc. -->
<script setup lang="ts">
import type { RouteContext } from "@routeur/core"

const props = defineProps<RouteContext<"/blog/[slug]">>()

// params resolved to { slug: string } through the registry indexed access:
const slug: string = props.params.slug

// @ts-expect-error — unknown param is a type error (proves narrowing, not `any`)
props.params.nope

// mutating response through props type-checks (Spike C exercises this at runtime):
props.response.status = 404
props.response.headers.set("cache-control", "no-store")
</script>

<template>
  <main>{{ slug }}</main>
</template>
