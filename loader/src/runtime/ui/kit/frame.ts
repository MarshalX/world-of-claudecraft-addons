// The movable frame addons build their UI in.
//
// `ui.frame` and `ui.window` are the same object with different chrome, which is
// why they are one file. A frame is HUD furniture: small, content-sized, no
// close button, because an addon that put one there would be offering to close
// something the player can only get back through the manager. A window is a
// panel the player opens and closes, so it is resizable and has the button.
//
// Both take the drag and clamp rules built for the manager in M3 rather than
// carrying their own, so "a window cannot be dragged somewhere it cannot be
// dragged back from" is one rule with one test, not one per surface.

import type { Teardown } from '../../disposal.ts';
import { clampBox, initialBox, type Viewport } from '../frame/geometry.ts';
import {
  type InteractiveFrame,
  type InteractiveFrameDeps,
  makeFrameInteractive,
} from '../frame/interactive.ts';
import type { FrameState, FrameStateStore } from './frame-state.ts';

/** What a frame with no width of its own opens at. */
const DEFAULT_FRAME_WIDTH = 240;
const DEFAULT_FRAME_HEIGHT = 120;
const DEFAULT_WINDOW_WIDTH = 480;
const DEFAULT_WINDOW_HEIGHT = 320;

const HIDDEN_CLASS = 'woc-hidden';

type FrameChrome = 'frame' | 'window';

interface FrameOpts {
  /** Unique within the addon. It is the persistence key, so it must be stable. */
  id: string;
  title?: string;
  width?: number;
  height?: number;
  /** Persist position and visibility for this character. */
  save?: boolean;
  /** Defaults to true for a window and false for a frame. */
  resizable?: boolean;
  /** Whether it starts on screen. Ignored when a saved visibility is restored. */
  visible?: boolean;
  /** Added to the frame element, so an addon can style its own. */
  className?: string;
}

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
  fqid: string;
  chrome: FrameChrome;
  opts: FrameOpts;
  /** Null when the addon did not ask to save, or storage is unavailable. */
  store: FrameStateStore | null;
  viewport: () => Viewport;
  /** For the window resize listener, so a Node test can drive it. */
  window: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
}

interface Chrome {
  el: HTMLElement;
  handle: HTMLElement;
  title: HTMLElement;
  body: HTMLElement;
  close: HTMLButtonElement | null;
}

function defaultSize(chrome: FrameChrome, opts: FrameOpts): Viewport {
  if (chrome === 'window') {
    return { w: opts.width ?? DEFAULT_WINDOW_WIDTH, h: opts.height ?? DEFAULT_WINDOW_HEIGHT };
  }
  return { w: opts.width ?? DEFAULT_FRAME_WIDTH, h: opts.height ?? DEFAULT_FRAME_HEIGHT };
}

/** A window is a dialog the player opened; a frame is grouped HUD furniture. */
function roleFor(chrome: FrameChrome): string {
  if (chrome === 'window') {
    return 'dialog';
  }
  return 'group';
}

function buildChrome(deps: FrameDeps): Chrome {
  const { doc, opts } = deps;

  const el = doc.createElement('section');
  el.className = `woc-window panel woc-addon-frame woc-chrome-${deps.chrome}`;
  if (opts.className !== undefined) {
    el.classList.add(opts.className);
  }
  // Attributes rather than ids: two addons may legitimately both call a frame
  // 'main', and a duplicate id would make document.getElementById a coin flip.
  el.setAttribute('data-woc-addon', deps.fqid);
  el.setAttribute('data-woc-frame', opts.id);
  el.setAttribute('role', roleFor(deps.chrome));

  const handle = doc.createElement('header');
  handle.className = 'woc-titlebar panel-title';

  const title = doc.createElement('span');
  title.className = 'woc-title';
  title.textContent = opts.title ?? '';
  handle.appendChild(title);
  el.setAttribute('aria-label', opts.title ?? opts.id);

  let close: HTMLButtonElement | null = null;
  if (deps.chrome === 'window') {
    close = doc.createElement('button');
    close.type = 'button';
    close.className = 'woc-close x-btn';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close');
    handle.appendChild(close);
  }

  const body = doc.createElement('div');
  body.className = 'woc-frame-body';

  el.append(handle, body);
  return { el, handle, title, body, close };
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

export type { AddonFrame, FrameChrome, FrameDeps, FrameOpts };
export { createAddonFrame, DEFAULT_FRAME_WIDTH, frameTeardown, HIDDEN_CLASS };
