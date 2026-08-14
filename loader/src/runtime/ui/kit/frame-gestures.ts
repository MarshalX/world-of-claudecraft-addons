// Who may move a frameless overlay, and when.
//
// A `density: 'bare'` frame is dragged by its own content, because there is no
// title bar to grab: kit/frame-chrome.ts hands the gesture layer `handle: el`. Its
// pointer policy then hands the pointer back over exactly what the addon DREW, so
// the only grabbable parts of an overlay are the rows a player reads and clicks,
// and any press that travels a few pixels moves the panel. Six of the frames in
// the official catalogue are in that position.
//
// So both gestures are confined to arrange mode, which already outlines every
// frame, floors it at a grabbable size and takes the pointer back over the whole
// box. A chromed frame is untouched: its handle is a title bar that exists to be
// grabbed and its edges are on a visible border, so neither gesture is ambiguous
// and neither is available by accident.
//
// This is the same reasoning `pointerOf` already encodes. `content` is there so a
// bare overlay does not take gestures over pixels it did not draw; this covers the
// pixels it did.

import type { Teardown } from '../../disposal.ts';
import type { FrameDensity } from './frame-chrome.ts';
import type { UnlockMode } from './unlock.ts';

/**
 * How far a press travels before it counts as an attempted drag.
 *
 * A press that never moves is a click on whatever the addon drew, and a player
 * clicking a row has not asked to move anything. Without the slop the hint would
 * fire on the first click of a session, which teaches the wrong thing about a
 * gesture that was not refused.
 */
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
 * Watch for a drag that this frame is currently refusing.
 *
 * There is no event for one: interactjs with `enabled: false` simply never starts,
 * so the only way to know a player tried is to watch the press ourselves. The move
 * and the release are watched on the DOCUMENT rather than the element, because a
 * drag that begins on a row leaves it almost immediately and a listener on the
 * element would miss exactly the gesture it is looking for.
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

/**
 * Follow the mode, and hand back the teardown for both halves.
 *
 * Applied once at build as well as on every change, because a frame created while
 * the mode is already on has to be movable from its first frame rather than from
 * the next time somebody flips the switch.
 */
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

/**
 * The two things the gate needs from outside the kit, carried together.
 *
 * One field on the frame rather than two, because they are one answer: a mode with
 * nothing to say when it refuses is a frame that goes quiet for no stated reason.
 */
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
 * A gate for the frames the rule is about, and nothing for the rest.
 *
 * Only a BARE frame, because only a bare frame is grabbed by what it drew. And
 * only where the mode was passed at all, which is every frame in a running loader
 * and few in a suite: without it the gestures are simply live, which is what a
 * frame did before there was a rule.
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
