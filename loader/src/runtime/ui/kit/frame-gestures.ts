// Who may move a frameless overlay, and when.
//
// A `density: 'bare'` frame is dragged by its own content (kit/frame-chrome.ts hands over
// `handle: el`), and the only grabbable parts are the rows a player clicks, so any press that
// travels a few pixels would move it. Both gestures are therefore confined to arrange mode,
// which outlines every frame and takes the pointer over the whole box. Chromed frames are
// untouched.

import type { Teardown } from '../../disposal.ts';
import type { FrameDensity } from './frame-chrome.ts';
import type { UnlockMode } from './unlock.ts';

/** How far a press travels before it counts as an attempted drag, so a click raises no hint. */
const DRAG_SLOP = 4;

interface GestureGateDeps {
  el: HTMLElement;
  unlock: UnlockMode;
  /** The gesture switch on frame/interactive.ts. */
  setGestures: (enabled: boolean) => void;
  /** Say that frames are locked. Absent where there is nothing to say it with. */
  note?: (() => void) | undefined;
}

/**
 * Watch for a drag that this frame is refusing; disabled interactjs raises no event. The move
 * and release are watched on the DOCUMENT, since a drag leaves the row almost immediately.
 */
function watchRefusal(el: HTMLElement, note: () => void): Teardown {
  const doc = el.ownerDocument;

  const onDown = (down: PointerEvent): void => {
    function stop(): void {
      doc.removeEventListener('pointermove', onMove);
      doc.removeEventListener('pointerup', stop);
    }
    const onMove = (move: PointerEvent): void => {
      const far =
        Math.abs(move.clientX - down.clientX) > DRAG_SLOP ||
        Math.abs(move.clientY - down.clientY) > DRAG_SLOP;
      if (far) {
        stop();
        note();
      }
    };
    doc.addEventListener('pointermove', onMove);
    doc.addEventListener('pointerup', stop);
  };

  el.addEventListener('pointerdown', onDown);
  return () => {
    el.removeEventListener('pointerdown', onDown);
  };
}

/** Follow the mode, applied at build too, since the mode may already be on. */
function createGestureGate(deps: GestureGateDeps): Teardown {
  let watching: Teardown | null = null;

  const apply = (unlocked: boolean): void => {
    deps.setGestures(unlocked);
    watching?.();
    watching = null;
    if (!unlocked && deps.note !== undefined) {
      watching = watchRefusal(deps.el, deps.note);
    }
  };

  apply(deps.unlock.unlocked);
  const off = deps.unlock.onChange(apply);

  return () => {
    off();
    watching?.();
    watching = null;
  };
}

/** The two things the gate needs from outside the kit, carried together. */
interface FrameArrange {
  unlock: UnlockMode;
  /** Say that frames are locked, once per refused gesture. See kit/arrange-hint.ts. */
  hint?: (() => void) | undefined;
}

/** What the frame hands over: its own chrome, plus the switch to drive. */
interface GateRequest {
  chrome: { el: HTMLElement; density: FrameDensity };
  setGestures: (enabled: boolean) => void;
  arrange?: FrameArrange | undefined;
}

/**
 * A gate for bare frames only, and only where the mode was passed (always in a running loader,
 * rarely in a suite). Without it the gestures are live.
 */
function gateFor(request: GateRequest): Teardown {
  const { arrange } = request;
  if (request.chrome.density !== 'bare' || arrange === undefined) {
    return () => undefined;
  }
  return createGestureGate({
    el: request.chrome.el,
    unlock: arrange.unlock,
    setGestures: request.setGestures,
    note: arrange.hint,
  });
}

export type { FrameArrange, GateRequest, GestureGateDeps };
export { createGestureGate, DRAG_SLOP, gateFor };
