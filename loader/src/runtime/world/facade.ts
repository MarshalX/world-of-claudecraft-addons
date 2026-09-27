// Composing a live facade out of several groups of getters.
//
// Used by both `world/backend.ts` and `api/world.ts`, each a set of getter groups.

/**
 * Two objects as one, carrying DESCRIPTORS rather than values. Never `{ ...a, ...b }`: a spread
 * calls every getter once and freezes a facade of nulls.
 */
export function mergeLive<A extends object, B extends object>(a: A, b: B): A & B {
  const merged = Object.defineProperties({}, Object.getOwnPropertyDescriptors(a));
  return Object.defineProperties(merged, Object.getOwnPropertyDescriptors(b)) as A & B;
}
