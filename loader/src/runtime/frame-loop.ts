// The one animation-frame loop the loader runs, only while something is subscribed.
//
// TWO PHASES, in order: addon handlers MOVE things, then the loader's paint pass READS them. Paint
// first and every anchor lags a frame behind the addon that moved it.
//
// The freeze drops addon ticks (the loop is the loader's, so there is no chain to break) and never
// the paint pass, so anchors keep following their units while the camera moves.

import { diagError } from '../shared/diag.ts';
import type { Teardown } from './disposal.ts';
import { unlessFrozen } from './freeze.ts';

/** The game's own frame-delta clamp, so a tab back from the background does not jump. */
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

/** Reports only the first throw, or it would log sixty a second. The subscription is kept. */
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

/** Milliseconds since the previous frame: zero on the first, and clamped. */
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
    // Cleared first, so a handler subscribing mid-phase does not skip the reschedule.
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

  /** Stop the moment the last subscriber goes. */
  const stopIfIdle = (): void => {
    if (handlers.size > 0 || paints.size > 0 || frame === null) {
      return;
    }
    deps.cancel(frame);
    frame = null;
    // So a restarted loop's first delta is zero.
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
    // Frozen here, not at the API surface, so the paint phase keeps running.
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
