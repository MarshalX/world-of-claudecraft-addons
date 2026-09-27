// Making a window movable and resizable, over interactjs.
//
// Thin by design: every placement rule lives in frame/geometry.ts, and interactjs handles
// only pointer capture, touch and edge hit areas. The window is positioned with left/top;
// `data-positioned` turns off the CSS default's translateX(-50%) centring (styles/chrome.css).

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
   * Called on every write of the box, so a display that scales with its frame follows the
   * drag. Not called for the initial paint, which is the size the caller asked for.
   */
  onBox?: (box: FrameBox) => void;
  /**
   * Which axes the box owns, and therefore which edges resize and which sizes are written. Defaults
   * to both.
   */
  resize?: SizeAxes;
  /**
   * The element's live size, for an axis the box does not own. Without it the clamp uses the
   * size at creation, and a frame that has since grown can be dragged mostly off screen.
   */
  measure?: () => Viewport;
  /**
   * How small and how large this frame may be. Defaults to the manager's own minimum and to
   * the viewport. Applied on every clamp, or a re-clamp inflates a small frame to the default.
   */
  bounds?: SizeBounds;
  /**
   * The alignment grid a gesture lands on, read per gesture since it changes under the frame.
   * Absent means off.
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
   * Turn the player's gestures on and off, leaving every loader write alone. Do not gate the
   * box keeper instead: it also serves `place` and `refit`, which must keep working.
   */
  setGestures: (enabled: boolean) => void;
  destroy: () => void;
}

function paint(el: HTMLElement, box: FrameBox, axes: SizeAxes): void {
  el.setAttribute('data-positioned', 'true');
  el.style.left = `${box.x}px`;
  el.style.top = `${box.y}px`;
  el.classList.toggle(LABEL_BELOW_CLASS, labelBelow(box.y));
  // Only the owned axes; writing the other would pin it at its first measured size.
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

/** The box: clamped and painted on every write. A gesture can only propose a box. */
function createBoxKeeper(deps: InteractiveFrameDeps, axes: SizeAxes): BoxKeeper {
  /** An axis the box does not own reports what the content made it, per axis. */
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
  // Assigned, not spread: an absent maximum must stay absent for clampSize to read it as the
  // viewport, and exactOptionalPropertyTypes rejects an explicit undefined.
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
 * The same bounds again, for interactjs's own rect. Without it the rect keeps growing past a
 * bound the drawn frame stopped at, and the frame ignores the pointer until it travels back.
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
 * The drag listener, carrying the sub-cell remainder a snapped drag leaves behind: deltas
 * arrive against an already-rounded box, so without it a slow drag never moves the frame.
 * The remainder is at most half a cell.
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

/** The resize listener. The dragged edge decides where the snap goes (see frame/snap.ts). */
function resizeMover(keeper: BoxWriter, grid: () => number): (event: ResizeEvent) => void {
  return (event) => {
    // deltaRect carries a left-edge drag's origin shift; without it the window jumps.
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
  /** Drag and resize together. */
  setEnabled: (enabled: boolean) => void;
  destroy: () => void;
}

/**
 * Turn pointer gestures into proposed boxes. The interactjs instance stays in here so no
 * caller can reach around the keeper to move the element.
 */
function attachGestures(deps: InteractiveFrameDeps, keeper: BoxKeeper, axes: SizeAxes): Gestures {
  const commit = (): void => {
    deps.onCommit(keeper.box());
  };

  const grid = (): number => deps.snapGrid?.() ?? NO_SNAP;

  const instance = interact(deps.el).draggable({
    // `ignoreFrom` covers the close button inside the handle.
    allowFrom: deps.handle,
    ignoreFrom: 'button, input, select, textarea',
    listeners: { move: dragMover(keeper, grid), end: commit },
  });

  const resizable = axes.w || axes.h;
  if (resizable) {
    instance.resizable({
      // The top edge is the drag handle, so it never resizes. The others follow the owned axes.
      edges: { top: false, left: axes.w, right: axes.w, bottom: axes.h },
      listeners: { move: resizeMover(keeper, grid), end: commit },
      modifiers: [interact.modifiers.restrictSize(restrictOpts(keeper.bounds))],
    });
  }

  return {
    // interactjs merges partial options, so `enabled` alone keeps everything set above.
    // The resize arm is guarded: `.resizable()` on a non-resizable frame would make it one.
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
