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

const NO_OP: Teardown = () => undefined;

/** Wraps a handler so a frozen call is held rather than made. */
type Deferrer = <A extends unknown[]>(handler: (...args: A) => void) => (...args: A) => void;

/** Run everything held, reporting a thrower rather than dropping the rest. */
function flush(pending: Array<() => void>): void {
  // Spliced before running: a handler that re-arms and is frozen again lands in
  // an empty queue rather than in the one being drained.
  for (const run of pending.splice(0)) {
    try {
      run();
    } catch (err) {
      diagError('an addon timer held by the freeze threw when it resumed', err);
    }
  }
}

/**
 * One-shots that came due while frozen, released when it lifts.
 *
 * NOT symmetry with the other gates. An addon animates by re-arming inside its
 * own handler, so holding a handler and then dropping it takes the whole chain
 * with it: nothing stays pending, and unfreezing has nothing left to fire. The
 * loop is then dead for the rest of the session. That is how this was found, in
 * a live session, with cooldown-bars still on screen and its events flowing.
 *
 * An INTERVAL needs none of this and is still dropped: the platform owns that
 * chain and keeps firing it, so a skipped tick is only a skipped tick.
 *
 * The resume listener and the bag entry exist only WHILE something is held, the
 * same way the world watcher samples only while something is subscribed. An
 * addon that is never frozen mid-timer registers nothing, and `bag.size` keeps
 * meaning what the rest of this module's suite reads it as.
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
    // Disable is hot, so an addon torn down mid-freeze must not draw when the
    // switch goes off. Adding to an already-disposed bag runs this at once,
    // which discards the call that was just held, which is correct.
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
      // The arguments are captured as they came, so a released frame carries the
      // timestamp it was due at rather than the resume's. That is the shape a
      // backgrounded tab produces, which addons already have to tolerate.
      hold(() => {
        handler(...args);
      });
    };
}

/**
 * Every handler is gated on the freeze switch, and the SCHEDULING is not.
 *
 * A frozen timer is still a live timer: it keeps its id, stays in the disposal
 * bag, and is cleared by the addon or by disable exactly as it would be. Only the
 * call into addon code is held. Suspending the underlying timers instead would
 * mean re-arming every one of them on resume with the elapsed time subtracted,
 * which is a scheduler, and the thing being built is a dev switch.
 */
function createTimers(host: TimerHost, bag: DisposalBag): TimersApi {
  /** The bag entry for each live id, so an explicit clear also drops it. */
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
