// The movable frame addons build their UI in.
//
// `ui.frame` and `ui.window` are the same object with different chrome, which is
// why they are one file. A frame is HUD furniture: small, content-sized, no
// close button, because an addon that put one there would be offering to close
// something the player can only get back through the manager. A window is a
// panel the player opens and closes, so it is resizable and has the button.
//
// Both take the drag and clamp rules built for the manager rather than carrying
// their own, so "a window cannot be dragged somewhere it cannot be
// dragged back from" is one rule with one test, not one per surface.

import type { Teardown } from '../../disposal.ts';
import { clampBox, initialBox, type Viewport } from '../frame/geometry.ts';
import {
  type InteractiveFrame,
  type InteractiveFrameDeps,
  makeFrameInteractive,
} from '../frame/interactive.ts';
import { buildChrome, type Chrome, type FrameChrome, type FrameOpts } from './frame-chrome.ts';
import type { FrameState, FrameStateStore } from './frame-state.ts';

/** What a frame with no width of its own opens at. */
const DEFAULT_FRAME_WIDTH = 240;
const DEFAULT_FRAME_HEIGHT = 120;
const DEFAULT_WINDOW_WIDTH = 480;
const DEFAULT_WINDOW_HEIGHT = 320;

const HIDDEN_CLASS = 'woc-hidden';

interface AddonFrame {
  /** The frame element. Addon-owned; the loader only positions it. */
  readonly el: HTMLElement;
  /** Where addon content goes. Everything above it is chrome. */
  readonly body: HTMLElement;
  readonly visible: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
  setTitle: (title: string) => void;
  destroy: () => void;
}

interface FrameDeps {
  doc: Document;
  /** The #woc-addons root. */
  root: HTMLElement;
  /**
   * Bring this frame to the front. See ui/kit/stacking.ts.
   *
   * Called when it is built and whenever it is shown, which is what makes a frame
   * that has just appeared reachable: a click raises a window, but a window
   * nobody has clicked yet holds no z-index at all, so a brand-new one would open
   * UNDER every window that had been clicked since the session began.
   */
  raise?: (el: HTMLElement) => void;
  fqid: string;
  chrome: FrameChrome;
  opts: FrameOpts;
  /** Null when the addon did not ask to save, or storage is unavailable. */
  store: FrameStateStore | null;
  viewport: () => Viewport;
  /** For the window resize listener, so a Node test can drive it. */
  window: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
}

function defaultSize(chrome: FrameChrome, opts: FrameOpts): Viewport {
  if (chrome === 'window') {
    return { w: opts.width ?? DEFAULT_WINDOW_WIDTH, h: opts.height ?? DEFAULT_WINDOW_HEIGHT };
  }
  return { w: opts.width ?? DEFAULT_FRAME_WIDTH, h: opts.height ?? DEFAULT_FRAME_HEIGHT };
}

/** What the drag and clamp layer is told about one frame. */
function gestureDeps(
  deps: FrameDeps,
  chrome: Chrome,
  size: Viewport,
  onCommit: () => void,
): InteractiveFrameDeps {
  const resizable = deps.opts.resizable ?? deps.chrome === 'window';
  const gestures: InteractiveFrameDeps = {
    el: chrome.el,
    handle: chrome.handle,
    viewport: deps.viewport,
    box: initialBox(deps.viewport(), size),
    onCommit,
    resizable,
    // The size the addon asked for is also its floor. Without this every clamp
    // after the first would inflate it back to the manager's minimum.
    min: size,
  };
  if (!resizable) {
    // A content-sized frame reports what its content made it, so the clamp works
    // on the real box rather than the one it was created with.
    gestures.measure = () => ({
      w: chrome.el.offsetWidth || size.w,
      h: chrome.el.offsetHeight || size.h,
    });
  }
  // Assigned rather than spread: exactOptionalPropertyTypes rejects an explicit
  // undefined, and an addon that wants no callback must not install one.
  if (deps.opts.onMove !== undefined) {
    gestures.onBox = deps.opts.onMove;
  }
  return gestures;
}

/** The live half of a frame: its gestures, its visibility, and its saving. */
interface FrameMechanics {
  interactive: InteractiveFrame;
  isVisible: () => boolean;
  setVisible: (next: boolean) => void;
  isDestroyed: () => boolean;
  destroy: () => void;
}

function mountFrame(deps: FrameDeps, chrome: Chrome, size: Viewport): FrameMechanics {
  const { opts } = deps;
  let visible = opts.visible ?? true;
  let destroyed = false;

  const applyVisibility = (): void => {
    chrome.el.classList.toggle(HIDDEN_CLASS, !visible);
  };
  applyVisibility();
  deps.root.appendChild(chrome.el);

  const persist = (): void => {
    if (!destroyed) {
      deps.store?.save(opts.id, { box: interactive.box(), visible });
    }
  };

  const interactive: InteractiveFrame = makeFrameInteractive(
    gestureDeps(deps, chrome, size, persist),
  );

  const onWindowResize = (): void => {
    interactive.refit();
  };
  deps.window.addEventListener('resize', onWindowResize);

  const setVisible = (next: boolean): void => {
    if (visible === next) {
      return;
    }
    visible = next;
    applyVisibility();
    // Re-clamped on show: the viewport may have changed while it was hidden, and
    // a hidden element measures as zero so the clamp could not run then.
    if (visible) {
      interactive.refit();
      deps.raise?.(chrome.el);
    }
    persist();
  };

  chrome.close?.addEventListener('click', () => {
    setVisible(false);
  });

  return {
    interactive,
    isVisible: () => visible,
    setVisible,
    isDestroyed: () => destroyed,

    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      deps.window.removeEventListener('resize', onWindowResize);
      interactive.destroy();
      chrome.el.remove();
    },
  };
}

/**
 * Move the frame to its saved placement whenever storage answers, and only if
 * the addon has not already been disabled by then.
 */
function restoreSaved(deps: FrameDeps, size: Viewport, frame: FrameMechanics): void {
  if (deps.store === null) {
    return;
  }
  deps.store
    .load(deps.opts.id)
    .then((state: FrameState | null) => {
      if (state === null || frame.isDestroyed()) {
        return;
      }
      frame.interactive.place(clampBox(state.box, deps.viewport(), size));
      frame.setVisible(state.visible);
    })
    .catch(() => undefined);
}

/**
 * Build a frame and put it on screen.
 *
 * A saved position arrives asynchronously, so the frame opens at its default
 * placement and moves once storage answers. Waiting for storage first would mean
 * an addon's frame does not exist for the first few hundred milliseconds, and
 * `woc.ui.frame()` is expected to return something an addon can write into on
 * the next line.
 */
function createAddonFrame(deps: FrameDeps): AddonFrame {
  const chrome = buildChrome(deps);
  const size = defaultSize(deps.chrome, deps.opts);
  const frame = mountFrame(deps, chrome, size);
  restoreSaved(deps, size, frame);
  // A z-index from the moment it exists, so the newest window is in front rather
  // than under everything that has been clicked so far this session.
  deps.raise?.(chrome.el);

  return {
    el: chrome.el,
    body: chrome.body,

    get visible(): boolean {
      return frame.isVisible();
    },

    show: () => {
      frame.setVisible(true);
    },
    hide: () => {
      frame.setVisible(false);
    },
    toggle: () => {
      frame.setVisible(!frame.isVisible());
    },

    setTitle: (title) => {
      chrome.title.textContent = title;
      chrome.el.setAttribute('aria-label', title);
    },

    destroy: frame.destroy,
  };
}

/** The teardown an addon's disposal bag registers for a frame. */
function frameTeardown(frame: AddonFrame): Teardown {
  return () => {
    frame.destroy();
  };
}

export type { AddonFrame, FrameDeps };
export { createAddonFrame, DEFAULT_FRAME_WIDTH, frameTeardown, HIDDEN_CLASS };
