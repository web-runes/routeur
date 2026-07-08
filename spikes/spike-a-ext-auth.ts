// Fake package #2 (stands in for @routeur/auth). A second, INDEPENDENT extension.
// Owns the `auth` key on RouteConfigParts; its value is a plain optional field.
// After Merge it surfaces flat as `auth?: { role: string }` on config — the exact
// "auth: { auth?: { role } } → auth?: { role }" flattening behavior.
declare module "@fake/core" {
  interface RouteConfigParts<P extends string> {
    auth: { auth?: { role: string } }
  }
}
