// window.__game shape probe.
//
// Results are recorded per host: PBE runs ahead of live, so a member missing
// there is the earliest signal that a game update will break addons.

export function probeGame(): never {
  throw new Error('not implemented: __game probe');
}
