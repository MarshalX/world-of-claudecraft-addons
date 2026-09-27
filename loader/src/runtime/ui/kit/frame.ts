// The movable frame addons build their UI in.
//
// `ui.frame` and `ui.window` are the same object with different chrome (kit/frame-chrome.ts).
// Both use the manager's drag and clamp rules (frame/geometry.ts), so each placement rule has
// one test.

import type { Teardown } from '../../disposal.ts';
import { clampBox, type FrameBox, initialBox, type Viewport } from '../frame/geometry.ts';
import {
  type InteractiveFrame,
  type InteractiveFrameDeps,
  makeFrameInteractive,
} from '../frame/interactive.ts';
import {
  buildChrome,
  type Chrome,
  type FrameChrome,
  type FrameOpts,
  frameLabel,
  LABEL_ATTR,
} from './frame-chrome.ts';
import { type FrameArrange, gateFor } from './frame-gestures.ts';
import { applyWidth, defaultSize, resizeAxes, sizeBounds } from './frame-size.ts';
import type { FrameState, FrameStateStore } from './frame-state.ts';
import type { FrameToggles } from './frame-toggle.ts';
import { createVisibility } from './frame-visibility.ts';

interface AddonFrame {
  /** The frame element. Addon-owned; the loader only positions it. */
  readonly el: HTMLElement;
  /** Where addon content goes. Everything above it is chrome. */
  readonly body: HTMLElement;
  readonly visible: boolean;
  /**
   * Where the frame is now, as the gesture layer holds it (no layout). The pair of `onMove`,
   * which does not fire for the initial placement.
   */
  box: () => FrameBox;
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
   * Bring this frame to the front (ui/kit/stacking.ts). Called when built and when shown,
   * since an unclicked window holds no z-index and would open under every clicked one.
   */
  raise?: (el: HTMLElement) => void;
  fqid: string;
  /** The owning addon's name, for the arrange-mode chip. See kit/frame-chrome.ts. */
  addonName?: string | undefined;
  chrome: FrameChrome;
  opts: FrameOpts;
  /**
   * The arrange mode and its refusal hint, which decide whether a BARE frame may be dragged
   * (kit/frame-gestures.ts). Absent leaves the gestures live.
   */
  arrange?: FrameArrange;
  /** Null when the addon did not ask to save, or storage is unavailable. */
  store: FrameStateStore | null;
  /** The addon's toggle keybinds. Absent where it has no keybind surface at all. */
  toggles?: FrameToggles;
  viewport: () => Viewport;
  /** For the window resize listener, so a Node test can drive it. */
  window: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
}

/** What the drag and clamp layer is told about one frame. */
function gestureDeps(
  deps: FrameDeps,
  chrome: Chrome,
  size: Viewport,
  onCommit: () => void,
): InteractiveFrameDeps {
  const axes = resizeAxes(deps.opts, deps.chrome);
  const bounds = sizeBounds(deps.opts, size);
  const gestures: InteractiveFrameDeps = {
    el: chrome.el,
    handle: chrome.handle,
    viewport: deps.viewport,
    box: initialBox(deps.viewport(), size, bounds),
    onCommit,
    resize: axes,
    // Every clamp needs it, or a re-clamp inflates the frame to the manager's minimum.
    bounds,
  };
  if (!(axes.w && axes.h)) {
    // An unowned axis reports its live content size, so the clamp sees the real box.
    gestures.measure = () => ({
      w: chrome.el.offsetWidth || size.w,
      h: chrome.el.offsetHeight || size.h,
    });
  }
  // Assigned, not spread: exactOptionalPropertyTypes rejects an explicit undefined.
  if (deps.opts.onMove !== undefined) {
    gestures.onBox = deps.opts.onMove;
  }
  // The mode's grid, never a per-frame one: one answer for the whole screen. See kit/unlock.ts.
  if (deps.arrange !== undefined) {
    gestures.snapGrid = deps.arrange.unlock.grid;
  }
  return gestures;
}

/** The live half of a frame: its gestures, its visibility, and its saving. */
interface FrameMechanics {
  interactive: InteractiveFrame;
  isVisible: () => boolean;
  setVisible: (next: boolean) => void;
  /** Apply what storage said, unless the addon or the player has spoken first. */
  restoreVisible: (next: boolean) => void;
  /** The saved state has been read back. Nothing persists before this. */
  settled: () => void;
  isDestroyed: () => boolean;
  destroy: () => void;
}

/**
 * Everything the frame subscribes to OUTSIDE itself (viewport resize, the arrange mode),
 * released together. An addon may destroy a frame mid-session, not only on disable.
 */
function attachShared(deps: FrameDeps, chrome: Chrome, interactive: InteractiveFrame): Teardown {
  const onWindowResize = (): void => {
    interactive.refit();
  };
  deps.window.addEventListener('resize', onWindowResize);
  const gate = gateFor({ arrange: deps.arrange, chrome, setGestures: interactive.setGestures });

  return () => {
    deps.window.removeEventListener('resize', onWindowResize);
    gate();
  };
}

function mountFrame(deps: FrameDeps, chrome: Chrome, size: Viewport): FrameMechanics {
  const { opts } = deps;
  let destroyed = false;

  deps.root.appendChild(chrome.el);
  applyWidth(chrome.el, size, resizeAxes(deps.opts, deps.chrome));

  // Everything about WHEN a frame is on screen, including why a saved one starts
  // hidden, is in kit/frame-visibility.ts.
  const vis = createVisibility({
    el: chrome.el,
    wanted: opts.visible ?? true,
    stored: deps.store !== null,
    onShown: () => {
      interactive.refit();
      deps.raise?.(chrome.el);
    },
    save: (visible) => {
      if (!destroyed) {
        deps.store?.save(opts.id, { box: interactive.box(), visible });
      }
    },
  });

  // `vis.commit` by reference: anything that compared first would skip a position-only save.
  const interactive: InteractiveFrame = makeFrameInteractive(
    gestureDeps(deps, chrome, size, vis.commit),
  );

  const detach = attachShared(deps, chrome, interactive);

  chrome.close?.addEventListener('click', () => {
    vis.set(false);
  });

  return {
    interactive,
    isVisible: vis.isVisible,
    setVisible: vis.set,
    restoreVisible: vis.restore,
    settled: vis.settled,
    isDestroyed: () => destroyed,

    destroy: () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      detach();
      interactive.destroy();
      chrome.el.remove();
    },
  };
}

/**
 * Move the frame to its saved placement when storage answers (at world entry, since the key
 * is per character), unless it was destroyed first. A saved frame is hidden until then, so
 * a null answer must still show it with the addon's own default.
 */
function restoreSaved(deps: FrameDeps, size: Viewport, frame: FrameMechanics): void {
  if (deps.store === null) {
    return;
  }
  deps.store
    .load(deps.opts.id)
    .then((state: FrameState | null) => {
      if (frame.isDestroyed()) {
        return;
      }
      if (state === null) {
        frame.restoreVisible(deps.opts.visible ?? true);
        frame.settled();
        return;
      }
      // A restored box meets the same bounds a dragged one does.
      frame.interactive.place(clampBox(state.box, deps.viewport(), sizeBounds(deps.opts, size)));
      frame.restoreVisible(state.visible);
      frame.settled();
    })
    .catch(() => undefined);
}

/**
 * Released from the frame's OWN destroy, not only from the addon's disposal bag:
 * the bag drains on disable, and an addon may destroy a frame by hand mid-session.
 */
function claimToggle(deps: FrameDeps, toggle: () => void): Teardown {
  const { toggleKey } = deps.opts;
  if (toggleKey === undefined || deps.toggles === undefined) {
    return () => undefined;
  }
  return deps.toggles.claim(toggleKey, deps.opts.id, toggle);
}

/**
 * A saved position arrives asynchronously, so the frame opens at its default placement
 * and moves once storage answers: `ui.frame()` has to return something writable at once.
 */
function createAddonFrame(deps: FrameDeps): AddonFrame {
  const chrome = buildChrome(deps);
  const size = defaultSize(deps.chrome, deps.opts);
  const frame = mountFrame(deps, chrome, size);
  restoreSaved(deps, size, frame);
  deps.raise?.(chrome.el);

  const toggle = (): void => {
    frame.setVisible(!frame.isVisible());
  };
  const releaseToggle = claimToggle(deps, toggle);

  return {
    el: chrome.el,
    body: chrome.body,
    box: frame.interactive.box,

    get visible(): boolean {
      return frame.isVisible();
    },

    show: () => {
      frame.setVisible(true);
    },
    hide: () => {
      frame.setVisible(false);
    },
    toggle,

    setTitle: (title) => {
      chrome.title.textContent = title;
      chrome.el.setAttribute('aria-label', title);
      chrome.el.setAttribute(LABEL_ATTR, frameLabel(deps.addonName ?? deps.fqid, title));
    },

    destroy: () => {
      releaseToggle();
      frame.destroy();
    },
  };
}

/** The teardown an addon's disposal bag registers for a frame. */
function frameTeardown(frame: AddonFrame): Teardown {
  return () => {
    frame.destroy();
  };
}

export type { AddonFrame, FrameDeps };
// `gestureDeps` is exported for its suite alone: interactjs moves nothing under happy-dom.
export { createAddonFrame, frameTeardown, gestureDeps };
