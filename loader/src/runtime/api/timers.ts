// Timers that clear themselves on disable, which is hot: a bare `setInterval` would run forever
// against removed DOM. A one-shot unregisters itself when it fires, or the bag grows per timeout.

import { diagError } from '../../shared/diag.ts';
import type { DisposalBag, Teardown } from '../disposal.ts';
import { isFrozen, onResume, unlessFrozen } from '../freeze.ts';

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

/** The wrapper reads its own id, which exists only once `schedule` returns. */
function oneShot<T>(deps: OneShotDeps<T>, handler: (arg: T) => void): number {
  let id = 0;
  let drop: Teardown = () => undefined;
  id = deps.schedule((arg) => {
    // Dropped first, so a throwing or rescheduling handler leaves a clean registry.
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

const NO_OP: Teardown = () => undefined;

/** Wraps a handler so a frozen call is held rather than made. */
type Deferrer = <A extends unknown[]>(handler: (...args: A) => void) => (...args: A) => void;

/** Run everything held, reporting a thrower rather than dropping the rest. */
function flush(pending: Array<() => void>): void {
  // Spliced first, so a handler that re-arms while frozen lands in a fresh queue.
  for (const run of pending.splice(0)) {
    try {
      run();
    } catch (err) {
      diagError('an addon timer held by the freeze threw when it resumed', err);
    }
  }
}

/**
 * One-shots due while frozen, released on resume; dropping one would kill the addon's re-arm chain
 * (see freeze.ts). An interval is still dropped, since the platform keeps firing it.
 *
 * The resume listener and bag entry exist only while something is held, so `bag.size` is untouched
 * for an addon never frozen mid-timer.
 */
function heldOneShots(bag: DisposalBag): Deferrer {
  const pending: Array<() => void> = [];
  let forget: Teardown = NO_OP;

  const hold = (run: () => void): void => {
    pending.push(run);
    if (pending.length > 1) {
      return;
    }
    const unlisten = onResume(() => {
      forget();
      flush(pending);
    });
    // Disable mid-freeze discards the held calls. A disposed bag runs this at once, correctly.
    const drop = bag.add(() => {
      pending.length = 0;
      unlisten();
    });
    forget = () => {
      unlisten();
      drop();
      forget = NO_OP;
    };
  };

  return <A extends unknown[]>(handler: (...args: A) => void) =>
    (...args: A) => {
      if (!isFrozen()) {
        handler(...args);
        return;
      }
      // A released frame carries the timestamp it was due at, as a backgrounded tab would.
      hold(() => {
        handler(...args);
      });
    };
}

/**
 * The freeze gates each handler, never the scheduling: a frozen timer keeps its id and bag entry.
 * Suspending the timers themselves would need a scheduler to re-arm them.
 */
function createTimers(host: TimerHost, bag: DisposalBag): TimersApi {
  /** The bag entry per live id, so an explicit clear also drops it. */
  const timeouts = new Map<number, Teardown>();
  const intervals = new Map<number, Teardown>();
  const frames = new Map<number, Teardown>();
  const defer = heldOneShots(bag);

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
        defer(handler),
      ),

    clearTimeout: (id) => {
      cancelTimeout(id);
      release(timeouts, id);
    },

    setInterval: (handler, ms) => {
      const id = host.setInterval(unlessFrozen(handler), ms);
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
        defer(handler),
      ),

    cancelAnimationFrame: (id) => {
      cancelFrame(id);
      release(frames, id);
    },
  };
}

export type { TimerHost, TimersApi };
export { createTimers };
