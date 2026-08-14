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
import { clampBox, type FrameBox, initialBox, type Viewport } from '../frame/geometry.ts';
import {
  type InteractiveFrame,
  type InteractiveFrameDeps,
  makeFrameInteractive,
} from '../frame/interactive.ts';
import { buildChrome, type Chrome, type FrameChrome, type FrameOpts } from './frame-chrome.ts';
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
   * Where the frame is now, as the loader is holding it.
   *
   * The pair of `onMove` rather than a replacement for it: that reports a CHANGE, and
   * an addon laying its content out against the box also needs the answer at moments
   * nothing changed, the first one being the moment it was built. `onMove` does not
   * fire for the initial placement, which every addon that scaled with its frame had
   * answered by writing the opening size into a variable of its own.
   *
   * No measurement and no layout: the box is the one the gesture layer already holds.
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
  /**
   * The arrange-your-UI switch and what a refusal says, which together decide
   * whether a BARE frame may be dragged at all. See kit/frame-gestures.ts.
   *
   * Absent means the gestures are simply live, which is what a frame did before
   * there was a rule and is what a suite that is not about the rule wants.
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
    // Passed to every clamp, not just the first: without it a re-clamp after a
    // drag or a viewport change inflates the frame back to the manager's minimum.
    bounds,
  };
  if (!(axes.w && axes.h)) {
    // Whichever axis the box does not own reports what its content made it, so the
    // clamp works on the real box rather than the one the frame was created with.
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
  /** Apply what storage said, unless the addon or the player has spoken first. */
  restoreVisible: (next: boolean) => void;
  /** The saved state has been read back. Nothing persists before this. */
  settled: () => void;
  isDestroyed: () => boolean;
  destroy: () => void;
}

/**
 * Everything the frame subscribes to OUTSIDE itself, released together.
 *
 * Two subscriptions to two shared things, and the same failure if either is left
 * behind: the viewport re-clamps a frame that is no longer in the document, and
 * the arrange mode switches gestures on a frame that no longer has any. A frame's
 * `destroy` is the addon's to call as well as the loader's, so this is reached by
 * a rebuild mid-session and not only by a disable.
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

  // `vis.commit` by reference: the end of a gesture is a write of what is already
  // on screen, and routing it through anything that compares first would make a
  // drag that changed only the position save nothing at all.
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
 * Move the frame to its saved placement whenever storage answers, and only if
 * the addon has not already been disabled by then.
 *
 * The answer arrives at world entry, because a per-character key cannot be built
 * before there is a character. Until it does, a saved frame is hidden, so this is
 * also what puts it on screen: the null case is not "nothing to do" but "there was
 * nothing stored, so use what the addon asked for".
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
      // Re-derived rather than threaded through: sizeBounds is pure, and a
      // restored box has to meet the same bounds a dragged one does, or a box
      // saved before the addon declared a minimum would come back under it.
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
  // A z-index from the moment it exists, or a new window opens under every clicked one.
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
export { createAddonFrame, frameTeardown };
