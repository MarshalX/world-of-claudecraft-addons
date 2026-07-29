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
}

interface InteractiveFrame {
  /** Re-clamp against the current viewport, e.g. after a window resize. */
  refit: () => void;
  destroy: () => void;
}

function paint(el: HTMLElement, box: FrameBox): void {
  el.setAttribute('data-positioned', 'true');
  el.style.left = `${box.x}px`;
  el.style.top = `${box.y}px`;
  el.style.width = `${box.w}px`;
  el.style.height = `${box.h}px`;
}

function makeFrameInteractive(deps: InteractiveFrameDeps): InteractiveFrame {
  let box = clampBox(deps.box, deps.viewport());
  paint(deps.el, box);

  const move = (next: FrameBox): void => {
    box = clampBox(next, deps.viewport());
    paint(deps.el, box);
  };

  const commit = (): void => {
    deps.onCommit(box);
  };

  const instance = interact(deps.el)
    .draggable({
      // Only the title bar starts a drag, so a click on a tab is a click on a
      // tab. `ignoreFrom` covers the close button living inside the handle.
      allowFrom: deps.handle,
      ignoreFrom: 'button, input, select, textarea',
      listeners: {
        move: (event: { dx: number; dy: number }) => {
          move({ ...box, x: box.x + event.dx, y: box.y + event.dy });
        },
        end: commit,
      },
    })
    .resizable({
      edges: { top: false, left: true, right: true, bottom: true },
      listeners: {
        move: (event: { rect: { width: number; height: number }; deltaRect: { left: number } }) => {
          // A left-edge drag changes x and w together. deltaRect carries the
          // origin shift; without it the window grows leftward and then jumps.
          move({
            x: box.x + event.deltaRect.left,
            y: box.y,
            w: event.rect.width,
            h: event.rect.height,
          });
        },
        end: commit,
      },
      modifiers: [
        interact.modifiers.restrictSize({ min: { width: MIN_WIDTH, height: MIN_HEIGHT } }),
      ],
    });

  return {
    refit: () => {
      move(box);
    },
    destroy: () => {
      instance.unset();
    },
  };
}

export type { InteractiveFrame, InteractiveFrameDeps };
export { makeFrameInteractive };
