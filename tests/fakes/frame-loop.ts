// The loader's one animation-frame loop, driven by hand.
//
// Two shapes, because suites want opposite things from it. `createFrameClock`
// wraps the REAL loop around a clock a test steps, which is what a suite about
// anchors or about `onFrame` needs: the phase order, the delta clamp and the
// stop-when-idle behaviour are the loop's own rather than a stand-in's. An inert
// loop registers nothing and runs nothing, which is what every OTHER suite needs,
// so building the shared services does not start a loop a test would have to stop.
//
// Shared rather than written twice: a fake that drifts from the thing it stands in
// for is how a suite goes green against a loader that throws.

import { createFrameLoop, type FrameLoop } from '../../loader/src/runtime/frame-loop.ts';

/** A plausible frame at 60Hz, so a delta a suite does not care about is realistic. */
const FRAME_MS = 16;

interface FrameClock {
  loop: FrameLoop;
  /** Run every frame scheduled so far, once, after moving the clock. */
  tick: (ms?: number) => void;
  /** Frames scheduled and not yet run. One while the loop is live, zero when idle. */
  pending: () => number;
  cancelled: () => number;
}

function createFrameClock(): FrameClock {
  const frames = new Map<number, () => void>();
  let nextId = 1;
  let cancelled = 0;
  let clock = 0;

  const loop = createFrameLoop({
    schedule: (frame) => {
      const id = nextId;
      nextId += 1;
      frames.set(id, frame);
      return id;
    },
    cancel: (id) => {
      if (frames.delete(id)) {
        cancelled += 1;
      }
    },
    now: () => clock,
  });

  return {
    loop,
    tick: (ms = FRAME_MS) => {
      clock += ms;
      for (const [id, frame] of [...frames]) {
        frames.delete(id);
        frame();
      }
    },
    pending: () => frames.size,
    cancelled: () => cancelled,
  };
}

/** A loop that never runs anything, for a suite that is not about frames. */
function inertFrameLoop(): FrameLoop {
  const nothing = (): void => undefined;
  return {
    on: () => nothing,
    onPaint: () => nothing,
    dispose: nothing,
  };
}

export type { FrameClock };
export { createFrameClock, inertFrameLoop };
