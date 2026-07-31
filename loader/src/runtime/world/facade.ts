// Composing a live facade out of several groups of getters.
//
// Both halves of the world surface are built this way: `world/backend.ts` reads
// the game's objects, and `api/world.ts` wraps that for an addon. Each is a set
// of getters split into groups, because one object literal of every read is past
// the length a function body is allowed, and the split has to preserve the
// getters or the whole facade stops being live.

/**
 * Two objects as one, carrying DESCRIPTORS rather than values.
 *
 * `{ ...a, ...b }` is the obvious way and is exactly wrong: a spread READS every
 * property, so each getter would be called once at assembly time and the result
 * would be frozen at whatever the answers were then. Before the game exists that
 * is a facade of nulls that never updates.
 *
 * The intersection type is what keeps a split honest: a member dropped from
 * either group fails to satisfy the interface at the return rather than going
 * missing at an addon.
 */
export function mergeLive<A extends object, B extends object>(a: A, b: B): A & B {
  const merged = Object.defineProperties({}, Object.getOwnPropertyDescriptors(a));
  return Object.defineProperties(merged, Object.getOwnPropertyDescriptors(b)) as A & B;
}
