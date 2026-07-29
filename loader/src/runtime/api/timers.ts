// Timers that clear themselves when the addon is disabled.
//
// The reason these are on `woc` rather than left to the page's globals is the
// hot disable: an addon is disabled without a page reload, so a bare
// `setInterval` keeps running forever against DOM the loader has already
// removed. An addon reaching for the global still works, and its interval still
// leaks, which is why the documented API is the one that does not.
//
// A one-shot unregisters itself when it fires. Without that, an addon scheduling
// one timeout a second accumulates a dead bag entry a second for as long as it
// is enabled.

import type { DisposalBag, Teardown } from '../disposal.ts';

interface TimerHost {
  setTimeout: (handler: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  setInterval: (handler: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
  requestAnimationFrame: (handler: (time: number) => void) => number;
  cancelAnimationFrame: (id: number) => void;
}

type TimersApi = TimerHost;

function release(registry: Map<number, Teardown>, id: number): void {
  registry.get(id)?.();
  registry.delete(id);
}

interface OneShotDeps<T> {
  bag: DisposalBag;
  registry: Map<number, Teardown>;
  cancel: (id: number) => void;
  schedule: (wrapped: (arg: T) => void) => number;
}

/**
 * Schedule a one-shot that unregisters itself.
 *
 * `schedule` is handed the wrapper and returns the id, which is the only order
 * that works: the wrapper has to know its own id to unregister, and the id does
 * not exist until the wrapper has been passed in.
 */
function oneShot<T>(deps: OneShotDeps<T>, handler: (arg: T) => void): number {
  let id = 0;
  let drop: Teardown = () => undefined;
  id = deps.schedule((arg) => {
    // Dropped before the handler runs, so a handler that throws still leaves
    // nothing behind and one that reschedules adds to a clean registry.
    deps.registry.delete(id);
    drop();
    handler(arg);
  });
  drop = deps.bag.add(() => {
    deps.cancel(id);
  });
  deps.registry.set(id, drop);
  return id;
}

function createTimers(host: TimerHost, bag: DisposalBag): TimersApi {
  /** The bag entry for each live id, so an explicit clear also drops it. */
  const timeouts = new Map<number, Teardown>();
  const intervals = new Map<number, Teardown>();
  const frames = new Map<number, Teardown>();

  const cancelTimeout = (id: number): void => {
    host.clearTimeout(id);
  };
  const cancelFrame = (id: number): void => {
    host.cancelAnimationFrame(id);
  };

  return {
    setTimeout: (handler, ms) =>
      oneShot<void>(
        {
          bag,
          registry: timeouts,
          cancel: cancelTimeout,
          schedule: (wrapped) => host.setTimeout(wrapped as () => void, ms),
        },
        handler,
      ),

    clearTimeout: (id) => {
      cancelTimeout(id);
      release(timeouts, id);
    },

    setInterval: (handler, ms) => {
      const id = host.setInterval(handler, ms);
      intervals.set(
        id,
        bag.add(() => {
          host.clearInterval(id);
        }),
      );
      return id;
    },

    clearInterval: (id) => {
      host.clearInterval(id);
      release(intervals, id);
    },

    requestAnimationFrame: (handler) =>
      oneShot<number>(
        {
          bag,
          registry: frames,
          cancel: cancelFrame,
          schedule: (wrapped) => host.requestAnimationFrame(wrapped),
        },
        handler,
      ),

    cancelAnimationFrame: (id) => {
      cancelFrame(id);
      release(frames, id);
    },
  };
}

export type { TimerHost, TimersApi };
export { createTimers };
