// The page realm's timers, typed as the page realm sees them.
//
// `setTimeout` returns a number in a browser and a Timeout object in Node, and
// this project has @types/node ambient because tools/*.ts needs it. That widens
// the global signature everywhere, including here, where it is simply wrong: the
// runtime is injected into a page and never runs under Node.
//
// One module rather than a cast at each call site, so the reason is written once
// and the assertion is in a place a reader can check rather than scattered
// through the bootstrap. loader/build-runtime.mjs is what actually enforces that
// no node module reaches this bundle; ambient types cannot.

/** A page-realm timer handle. */
type TimerId = number;

function setTimer(handler: () => void, ms: number): TimerId {
  return globalThis.setTimeout(handler, ms) as unknown as TimerId;
}

function clearTimer(id: TimerId): void {
  globalThis.clearTimeout(id);
}

export type { TimerId };
export { clearTimer, setTimer };
