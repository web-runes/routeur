// Simulates the generated src/routes.gen.ts registry augmentation (spec §9.1, §10)
// — a SEPARATE declaration, exactly as the Vite plugin would emit it.
declare module "@routeur/core" {
  interface RouteRegistry {
    "/blog/[slug]": { slug: string }
  }
}
