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
import { clampBox, type FrameBox, MIN_HEIGHT, MIN_WIDTH, type Viewport } from './geometry.ts';

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
   * Whether the edges resize, and whether the size is written at all. Defaults
   * to true.
   *
   * A small always-on HUD readout is sized by its content, so an explicit height
   * would leave it padded out or clipped as its text changes, and edges that
   * resize it turn every attempt to nudge it into a reshape.
   */
  resizable?: boolean;
  /**
   * The element's live size, for a frame that is not resizable.
   *
   * Without it, clamping a content-sized frame would use whatever size it had
   * when it was created, and a frame that has since grown could be dragged most
   * of the way off screen while the clamp believed it was still on.
   */
  measure?: () => Viewport;
  /**
   * The smallest this frame may be. Defaults to the manager's own minimum.
   *
   * Passed on to every clamp, not just the first: without it a re-clamp after a
   * drag or a viewport change silently inflates an addon frame back to the
   * manager's 360 by 220, which is a settings window rather than a HUD readout.
   */
  min?: Viewport;
}

interface InteractiveFrame {
  /** Re-clamp against the current viewport, e.g. after a window resize. */
  refit: () => void;
  /** Move to a box directly, e.g. when a persisted position is restored. */
  place: (box: FrameBox) => void;
  box: () => FrameBox;
  destroy: () => void;
}

function paint(el: HTMLElement, box: FrameBox, sized: boolean): void {
  el.setAttribute('data-positioned', 'true');
  el.style.left = `${box.x}px`;
  el.style.top = `${box.y}px`;
  if (sized) {
    el.style.width = `${box.w}px`;
    el.style.height = `${box.h}px`;
  }
}

/** The live box, and the only route by which it is allowed to change. */
interface BoxKeeper {
  /** The smallest this frame may be. The resize modifier needs it too. */
  min: Viewport;
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
function createBoxKeeper(deps: InteractiveFrameDeps, resizable: boolean): BoxKeeper {
  /** A non-resizable frame's real size is whatever its content made it. */
  const withSize = (next: FrameBox): FrameBox => {
    const measured = deps.measure?.();
    if (measured === undefined) {
      return next;
    }
    return { ...next, w: measured.w, h: measured.h };
  };

  const min = deps.min ?? { w: MIN_WIDTH, h: MIN_HEIGHT };

  let box = clampBox(withSize(deps.box), deps.viewport(), min);
  paint(deps.el, box, resizable);

  return {
    min,
    box: () => box,
    move: (next) => {
      box = clampBox(withSize(next), deps.viewport(), min);
      paint(deps.el, box, resizable);
      deps.onBox?.(box);
    },
  };
}

/**
 * Turn pointer gestures into proposed boxes, and hand back the teardown.
 *
 * The interactjs instance deliberately does not leave this function: unsetting
 * it is the only thing the caller ever wants, and keeping it in here is what
 * stops a later caller reaching around the keeper to move the element itself.
 */
function attachGestures(
  deps: InteractiveFrameDeps,
  keeper: BoxKeeper,
  resizable: boolean,
): () => void {
  const commit = (): void => {
    deps.onCommit(keeper.box());
  };

  const instance = interact(deps.el).draggable({
    // Only the title bar starts a drag, so a click on a tab is a click on a
    // tab. `ignoreFrom` covers the close button living inside the handle.
    allowFrom: deps.handle,
    ignoreFrom: 'button, input, select, textarea',
    listeners: {
      move: (event: { dx: number; dy: number }) => {
        const box = keeper.box();
        keeper.move({ ...box, x: box.x + event.dx, y: box.y + event.dy });
      },
      end: commit,
    },
  });

  if (resizable) {
    instance.resizable({
      // The top edge is deliberately not resizable: it is the drag handle, and
      // an edge that both moves and resizes is a coin flip on every grab.
      edges: { top: false, left: true, right: true, bottom: true },
      listeners: {
        move: (event: { rect: { width: number; height: number }; deltaRect: { left: number } }) => {
          // A left-edge drag changes x and w together. deltaRect carries the
          // origin shift; without it the window grows leftward and then jumps.
          const box = keeper.box();
          keeper.move({
            x: box.x + event.deltaRect.left,
            y: box.y,
            w: event.rect.width,
            h: event.rect.height,
          });
        },
        end: commit,
      },
      modifiers: [
        interact.modifiers.restrictSize({ min: { width: keeper.min.w, height: keeper.min.h } }),
      ],
    });
  }

  return () => {
    instance.unset();
  };
}

function makeFrameInteractive(deps: InteractiveFrameDeps): InteractiveFrame {
  const resizable = deps.resizable !== false;
  const keeper = createBoxKeeper(deps, resizable);
  const destroy = attachGestures(deps, keeper, resizable);

  return {
    refit: () => {
      keeper.move(keeper.box());
    },
    place: (next) => {
      keeper.move(next);
    },
    box: keeper.box,
    destroy,
  };
}

export type { InteractiveFrame, InteractiveFrameDeps };
export { makeFrameInteractive };
