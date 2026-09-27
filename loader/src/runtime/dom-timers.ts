// The page realm's timers, typed as a browser returns them. Ambient @types/node (for tools/*.ts)
// types `setTimeout` as returning a Timeout, which is wrong for a runtime that only runs in a page.
// One module, so the cast lives in one place.

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
