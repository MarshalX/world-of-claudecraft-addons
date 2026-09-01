// Making a window movable and resizable, over interactjs.
//
// Thin by design: every rule about where the window may end up lives in
// frame/geometry.ts, and this file only turns pointer gestures into a box and
// hands it back. interactjs is here for the parts that are genuinely fiddly
// (pointer capture across the document, touch, the resize edge hit areas), not
// for the arithmetic.
//
// The window is positioned with left/top rather than a transform, because the
// CSS default centres it with translateX(-50%); once the player has moved it,
// `data-positioned` on the element turns that centring off (see styles.css).

import interact from 'interactjs';
import {
  clampBox,
  type FrameBox,
  LABEL_BELOW_CLASS,
  labelBelow,
  MIN_HEIGHT,
  MIN_WIDTH,
  type SizeAxes,
  type SizeBounds,
  type Viewport,
} from './geometry.ts';
import { NO_SNAP, type ResizeEdges, snapPosition, snapResize } from './snap.ts';

interface InteractiveFrameDeps {
  el: HTMLElement;
  /** The drag handle. Only this starts a move, so the tab strip stays clickable. */
  handle: HTMLElement;
  viewport: () => Viewport;
  /** The box to start from. */
  box: FrameBox;
  /** Called at the end of a gesture, not during it. */
  onCommit: (box: FrameBox) => void;
  /**
   * Called on every write of the box, which is what an addon lays out against.
   *
   * The pair of `onCommit` rather than a rename of it: one is "the player has
   * finished, persist this" and the other is "the box is now that", and a display
   * that scales with its frame has to follow the drag rather than jump when the
   * pointer comes up. Not called for the initial paint, which is the size the
   * caller asked for.
   */
  onBox?: (box: FrameBox) => void;
  /**
   * Which axes the box owns, and therefore which edges resize and which sizes are
   * written at all. Defaults to both.
   *
   * Per axis rather than a flag, because the two are different questions. A small
   * always-on HUD readout is sized by its CONTENT vertically, so an explicit height
   * would leave it padded out or clipped as its text changes, while its width is a
   * column the player reads figures out of and may well want wider.
   */
  resize?: SizeAxes;
  /**
   * The element's live size, for an axis the box does not own.
   *
   * Without it, clamping a content-sized frame would use whatever size it had
   * when it was created, and a frame that has since grown could be dragged most
   * of the way off screen while the clamp believed it was still on.
   */
  measure?: () => Viewport;
  /**
   * How small and how large this frame may be. Defaults to the manager's own
   * minimum and to the viewport.
   *
   * Passed on to every clamp, not just the first: without it a re-clamp after a
   * drag or a viewport change silently inflates an addon frame back to the
   * manager's 360 by 220, which is a settings window rather than a HUD readout.
   */
  bounds?: SizeBounds;
  /**
   * The alignment grid a gesture lands on, read per gesture because both the setting
   * and the arrange mode change under a frame built long before either did. Absent
   * means off.
   */
  snapGrid?: () => number;
}

interface InteractiveFrame {
  /** Re-clamp against the current viewport, e.g. after a window resize. */
  refit: () => void;
  /** Move to a box directly, e.g. when a persisted position is restored. */
  place: (box: FrameBox) => void;
  box: () => FrameBox;
  /**
   * Turn the PLAYER's gestures on and off, leaving every loader write alone.
   *
   * Deliberately not a flag on the box keeper. That is the only path a box is
   * written by, and it serves `place` and `refit` as well as a drag, so a gate
   * there would stop a frame being restored to its saved position or being
   * pulled back on screen after the viewport shrank. What a caller wants to stop
   * is the pointer, so the pointer is what this stops.
   */
  setGestures: (enabled: boolean) => void;
  destroy: () => void;
}

function paint(el: HTMLElement, box: FrameBox, axes: SizeAxes): void {
  el.setAttribute('data-positioned', 'true');
  el.style.left = `${box.x}px`;
  el.style.top = `${box.y}px`;
  // Here because every box, the opening placement included, reaches the element here.
  el.classList.toggle(LABEL_BELOW_CLASS, labelBelow(box.y));
  // Only the axes the box owns. Writing the other would pin a frame at whatever its
  // content happened to measure at the moment it was first painted.
  if (axes.w) {
    el.style.width = `${box.w}px`;
  }
  if (axes.h) {
    el.style.height = `${box.h}px`;
  }
}

/** The live box, and the only route by which it is allowed to change. */
interface BoxKeeper {
  /** What the frame may be sized between. The resize modifier needs it too. */
  bounds: SizeBounds;
  box: () => FrameBox;
  move: (next: FrameBox) => void;
}

/**
 * The box: clamped on every write, painted on every write.
 *
 * Held apart from the gesture wiring below because it is the whole of the
 * arithmetic and none of the pointer handling. A gesture can only ever PROPOSE a
 * box, so there is no path that writes one which skipped the clamp.
 */
function createBoxKeeper(deps: InteractiveFrameDeps, axes: SizeAxes): BoxKeeper {
  /**
   * An axis the box does not own reports what the CONTENT made it.
   *
   * Per axis, because a frame may own one and not the other: a column that resizes
   * across and grows down has a width the player set and a height nothing wrote, and
   * clamping the second against a number from when it was built would let it be
   * dragged most of the way off screen while the clamp believed it was still on.
   */
  const withSize = (next: FrameBox): FrameBox => {
    const measured = deps.measure?.();
    if (measured === undefined) {
      return next;
    }
    const size = { w: measured.w, h: measured.h };
    if (axes.w) {
      size.w = next.w;
    }
    if (axes.h) {
      size.h = next.h;
    }
    return { ...next, ...size };
  };

  const bounds: SizeBounds = { min: deps.bounds?.min ?? { w: MIN_WIDTH, h: MIN_HEIGHT } };
  // Assigned rather than spread: exactOptionalPropertyTypes rejects an explicit
  // undefined, and an absent maximum has to stay absent for clampSize to read it
  // as "the viewport" rather than as a cap of undefined.
  if (deps.bounds?.max !== undefined) {
    bounds.max = deps.bounds.max;
  }

  let box = clampBox(withSize(deps.box), deps.viewport(), bounds);
  paint(deps.el, box, axes);

  return {
    bounds,
    box: () => box,
    move: (next) => {
      box = clampBox(withSize(next), deps.viewport(), bounds);
      paint(deps.el, box, axes);
      deps.onBox?.(box);
    },
  };
}

/**
 * The half of the keeper a gesture listener uses, so a suite can drive the listeners
 * without interactjs, which moves nothing under happy-dom.
 */
type BoxWriter = Pick<BoxKeeper, 'box' | 'move'>;

/** What interactjs is told a resize may produce. Its own naming, not the kit's. */
interface SizeLimit {
  width: number;
  height: number;
}

interface RestrictSizeOpts {
  min: SizeLimit;
  max?: SizeLimit;
}

/**
 * The same bounds again, for interactjs to hold the gesture inside.
 *
 * Redundant with the clamp on paper and not in practice: the clamp decides where
 * the frame is DRAWN, while interactjs keeps its own rect, and without this the
 * two diverge as soon as the pointer passes a bound. The frame stops at the
 * bound, the rect keeps growing, and the frame then does nothing at all until the
 * pointer travels all the way back to where the rect agrees with it again.
 */
function restrictOpts(bounds: SizeBounds): RestrictSizeOpts {
  const min = bounds.min ?? { w: MIN_WIDTH, h: MIN_HEIGHT };
  const opts: RestrictSizeOpts = { min: { width: min.w, height: min.h } };
  if (bounds.max !== undefined) {
    opts.max = { width: bounds.max.w, height: bounds.max.h };
  }
  return opts;
}

/**
 * The drag listener, carrying the sub-cell remainder a snapped drag leaves behind:
 * interactjs reports deltas against a box already rounded onto a line, so without it
 * every movement under half a cell rounds straight back and a slow drag never moves
 * the frame. The remainder is bounded by half a cell by construction, so a frame
 * clamped at the viewport edge owes nothing when the pointer comes back.
 */
function dragMover(
  keeper: BoxWriter,
  grid: () => number,
): (event: { dx: number; dy: number }) => void {
  const rest = { x: 0, y: 0 };
  return (event) => {
    const box = keeper.box();
    const wanted = { ...box, x: box.x + rest.x + event.dx, y: box.y + rest.y + event.dy };
    const next = snapPosition(wanted, grid());
    rest.x = wanted.x - next.x;
    rest.y = wanted.y - next.y;
    keeper.move(next);
  };
}

/** What interactjs reports a resize with. Its own naming, not the kit's. */
interface ResizeEvent {
  rect: { width: number; height: number };
  deltaRect: { left: number };
  edges: ResizeEdges;
}

/**
 * The resize listener. The edges come off the event, since which one is dragged
 * decides where the snap goes (see frame/snap.ts).
 */
function resizeMover(keeper: BoxWriter, grid: () => number): (event: ResizeEvent) => void {
  return (event) => {
    // A left-edge drag changes x and w together. deltaRect carries the origin
    // shift; without it the window grows leftward and then jumps.
    const box = keeper.box();
    keeper.move(
      snapResize(
        {
          x: box.x + event.deltaRect.left,
          y: box.y,
          w: event.rect.width,
          h: event.rect.height,
        },
        event.edges,
        grid(),
      ),
    );
  };
}

/** What a caller may do to the gestures once they are attached. */
interface Gestures {
  /** Both of them at once: a frame nobody may move is not one they may resize. */
  setEnabled: (enabled: boolean) => void;
  destroy: () => void;
}

/**
 * Turn pointer gestures into proposed boxes, and hand back the teardown.
 *
 * The interactjs instance deliberately does not leave this function: unsetting it
 * and switching it off are the only things a caller ever wants, and keeping it in
 * here is what stops a later caller reaching around the keeper to move the element
 * itself.
 */
function attachGestures(deps: InteractiveFrameDeps, keeper: BoxKeeper, axes: SizeAxes): Gestures {
  const commit = (): void => {
    deps.onCommit(keeper.box());
  };

  const grid = (): number => deps.snapGrid?.() ?? NO_SNAP;

  const instance = interact(deps.el).draggable({
    // Only the title bar starts a drag, so a click on a tab is a click on a
    // tab. `ignoreFrom` covers the close button living inside the handle.
    allowFrom: deps.handle,
    ignoreFrom: 'button, input, select, textarea',
    listeners: { move: dragMover(keeper, grid), end: commit },
  });

  const resizable = axes.w || axes.h;
  if (resizable) {
    instance.resizable({
      // The top edge is deliberately not resizable: it is the drag handle, and
      // an edge that both moves and resizes is a coin flip on every grab. The other
      // three are per axis, so a frame that owns only its width has no bottom edge
      // to grab and cannot be dragged into a height nothing will write.
      edges: { top: false, left: axes.w, right: axes.w, bottom: axes.h },
      listeners: { move: resizeMover(keeper, grid), end: commit },
      modifiers: [interact.modifiers.restrictSize(restrictOpts(keeper.bounds))],
    });
  }

  return {
    // Partial options, which interactjs MERGES into what is already set: passing
    // `enabled` alone leaves the listeners, the handle and the modifiers above in
    // place, and re-passing them here would be a second copy of them to keep in
    // step. The resize arm is guarded because the same merge cuts the other way:
    // calling `.resizable()` on a frame that never asked to be one would make it
    // resizable from the first switch on.
    setEnabled: (enabled) => {
      instance.draggable({ enabled });
      if (resizable) {
        instance.resizable({ enabled });
      }
    },

    destroy: () => {
      instance.unset();
    },
  };
}

function makeFrameInteractive(deps: InteractiveFrameDeps): InteractiveFrame {
  const axes = deps.resize ?? { w: true, h: true };
  const keeper = createBoxKeeper(deps, axes);
  const gestures = attachGestures(deps, keeper, axes);

  return {
    refit: () => {
      keeper.move(keeper.box());
    },
    place: (next) => {
      keeper.move(next);
    },
    box: keeper.box,
    setGestures: gestures.setEnabled,
    destroy: gestures.destroy,
  };
}

export type { BoxWriter, InteractiveFrame, InteractiveFrameDeps, ResizeEvent };
export { dragMover, makeFrameInteractive, resizeMover };
