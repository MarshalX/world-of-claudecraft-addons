// `woc.paint`, the coalesced repaint. It holds a frame-loop seat only while a repaint is owed; one
// owed to a HIDDEN frame keeps its seat, since `Frame` has no visibility event to wait on.

import type { DisposalBag, Teardown } from '../disposal.ts';
import { type FrameLoop, reportedOnce } from '../frame-loop.ts';

interface PaintFrame {
  readonly visible: boolean;
}

interface PaintOpts {
  frame?: PaintFrame;
}

type PaintApi = (handler: () => void, opts?: PaintOpts) => () => void;

interface PaintDeps {
  frames: FrameLoop;
  bag: DisposalBag;
  report: (err: unknown) => void;
}

/** An object rather than `let`s: a `let` on a literal narrows to that literal. */
interface PaintState {
  owed: boolean;
  /** The seat on the loop, held only while a repaint is owed. */
  off: Teardown | null;
  disposed: boolean;
}

function hidden(frame: PaintFrame | undefined): boolean {
  return frame !== undefined && !frame.visible;
}

/**
 * `owed` is cleared BEFORE the handler, so a request made from inside it schedules
 * the next frame rather than recursing. The seat is given up AFTER and never
 * during: resubscribing inside the loop's own phase makes it schedule two
 * callbacks for the next frame.
 */
function paintTick(state: PaintState, draw: () => void, opts?: PaintOpts): void {
  // Held rather than dropped, so the panel is drawn once when it comes back.
  if (hidden(opts?.frame)) {
    return;
  }
  state.owed = false;
  draw();
  if (!state.owed) {
    state.off?.();
    state.off = null;
  }
}

function createRepaint(deps: PaintDeps, handler: () => void, opts?: PaintOpts): () => void {
  const state: PaintState = { owed: false, off: null, disposed: false };
  const draw = reportedOnce(deps.report, handler);

  // A disposed bag runs this at once, so `paint` after disable is inert.
  deps.bag.add(() => {
    state.disposed = true;
    state.owed = false;
    state.off?.();
    state.off = null;
  });

  return () => {
    if (state.disposed) {
      return;
    }
    state.owed = true;
    state.off ??= deps.frames.on(() => {
      paintTick(state, draw, opts);
    });
  };
}

function createPaintApi(deps: PaintDeps): PaintApi {
  return (handler, opts) => createRepaint(deps, handler, opts);
}

export type { PaintApi, PaintFrame, PaintOpts };
export { createPaintApi };
