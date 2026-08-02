// The one animation-frame loop the loader runs.
//
// TWO PHASES, and the order between them is the whole reason this is one object
// rather than two sets. An addon's handler MOVES things (a bar's width, a point
// an anchor follows); the loader's own paint pass READS what moved. Running the
// paint first would put every anchor one frame behind the addon that moved it,
// which is visible on a fast camera turn and is not something an addon can
// correct for.
//
// It runs only while something is subscribed, which is what keeps a session with
// no animating addon and no anchor at zero cost, exactly as the world watcher
// does. The anchor loop this replaced already worked that way; what is new is
// that thirty animating addons are now one browser callback rather than thirty.
//
// THE FREEZE IS APPLIED TO ADDON HANDLERS AND NOT TO THE PAINT PASS. A held
// one-shot has to be queued, because an addon re-arms inside its own handler and
// a dropped link kills the chain for the session (see freeze.ts). Nothing here
// has a chain to break: the loop is the loader's, so a frozen tick is simply not
// delivered and the addon resumes on the next one with no backlog at all. The
// paint pass keeps running for the reason Diagnostics does, which is that a
// frozen screen is being looked at and an anchor that stopped following its unit
// while the camera still moves is a freeze that photographs wrongly.

import { diagError } from '../shared/diag.ts';
import type { Teardown } from './disposal.ts';
import { unlessFrozen } from './freeze.ts';

/**
 * The longest delta a handler is ever handed, in milliseconds.
 *
 * The game's own clamp (`if (frameDt > 0.25) frameDt = 0.25` in its frame loop).
 * A tab returning from the background otherwise hands an addon half a minute to
 * multiply a decay or a sweep by, and everything drawn from it jumps.
 */
const MAX_FRAME_DT_MS = 250;

interface FrameLoopDeps {
  schedule: (frame: () => void) => number;
  cancel: (id: number) => void;
  now: () => number;
}

interface FrameLoop {
  /** An addon's handler. Runs first, in subscription order, and is frozen with the switch. */
  on: (handler: (dt: number) => void) => Teardown;
  /** The loader's own paint pass. Runs after every handler, and is never frozen. */
  onPaint: (paint: () => void) => Teardown;
  dispose: () => void;
}

/**
 * The same callback, reporting its FIRST throw and none after it.
 *
 * A callback that throws on one frame throws on the next one too, so reporting
 * every time would write sixty lines a second into whichever log is listening.
 * The subscription is kept, matching every other place the loader calls into
 * code it does not own: the cost of a mistake is a warning, not a surface that
 * stops working for the rest of the session.
 */
function reportedOnce<A extends unknown[]>(
  report: (err: unknown) => void,
  handler: (...args: A) => void,
): (...args: A) => void {
  let reported = false;
  return (...args: A) => {
    try {
      handler(...args);
    } catch (err) {
      if (!reported) {
        reported = true;
        report(err);
      }
    }
  };
}

/** Where a throw goes when the loader itself was the subscriber. */
function reportLoopError(err: unknown): void {
  diagError('a frame-loop callback threw, and further throws from it are not reported', err);
}

/**
 * Milliseconds since the previous frame: zero on the first, and clamped.
 *
 * Zero rather than the time since the loop was built, because the first frame of
 * a subscription has no previous one to measure from and a handler multiplying
 * by it would jump on its very first draw.
 */
function elapsed(last: number | null, now: number): number {
  if (last === null) {
    return 0;
  }
  const dt = now - last;
  if (!(dt > 0)) {
    return 0;
  }
  return Math.min(dt, MAX_FRAME_DT_MS);
}

/** Copied before iterating, so a handler that unsubscribes mid-phase is safe. */
function runHandlers(handlers: ReadonlySet<(dt: number) => void>, dt: number): void {
  for (const handler of [...handlers]) {
    handler(dt);
  }
}

function runPaints(paints: ReadonlySet<() => void>): void {
  for (const paint of [...paints]) {
    paint();
  }
}

function createFrameLoop(deps: FrameLoopDeps): FrameLoop {
  const handlers = new Set<(dt: number) => void>();
  const paints = new Set<() => void>();
  let frame: number | null = null;
  let last: number | null = null;

  const tick = (): void => {
    // Cleared first, so a handler that subscribes during the phase does not see
    // a stale id and skip the reschedule.
    frame = null;
    const now = deps.now();
    const dt = elapsed(last, now);
    last = now;
    runHandlers(handlers, dt);
    runPaints(paints);
    if (handlers.size > 0 || paints.size > 0) {
      frame = deps.schedule(tick);
    }
  };

  const start = (): void => {
    frame ??= deps.schedule(tick);
  };

  /** Stop the moment the last subscriber goes, rather than running empty. */
  const stopIfIdle = (): void => {
    if (handlers.size > 0 || paints.size > 0 || frame === null) {
      return;
    }
    deps.cancel(frame);
    frame = null;
    // So a loop that starts again hands its first frame a zero delta rather than
    // however long nobody was subscribed for.
    last = null;
  };

  const subscribe = <T>(set: Set<T>, callback: T): Teardown => {
    set.add(callback);
    start();
    return () => {
      set.delete(callback);
      stopIfIdle();
    };
  };

  return {
    // Frozen here rather than at the API surface, so the paint phase below keeps
    // running while addon handlers are held. See the note at the top of the file.
    on: (handler) => subscribe(handlers, unlessFrozen(reportedOnce(reportLoopError, handler))),

    onPaint: (paint) => subscribe(paints, reportedOnce(reportLoopError, paint)),

    dispose: () => {
      handlers.clear();
      paints.clear();
      stopIfIdle();
    },
  };
}

export type { FrameLoop, FrameLoopDeps };
export { createFrameLoop, MAX_FRAME_DT_MS, reportedOnce };
