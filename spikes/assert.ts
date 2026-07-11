// Type-level assertion helpers shared by the type spikes.
// A false `Equal` makes `Expect` a compile error, so `tsc --noEmit` is the test.

export type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false

export type Expect<T extends true> = T

// Flatten intersections into a single object literal for readable comparisons.
export type Simplify<T> = { [K in keyof T]: T[K] } & {}
