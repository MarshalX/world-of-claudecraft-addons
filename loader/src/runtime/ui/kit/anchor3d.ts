// An element the loader keeps over a point in the world.
//
// Nameplates, ground markers, a target arrow, a pin on a gathering node: all of
// them are the same thing, an element whose screen position is a world position
// projected every frame, hidden when that point is behind the camera or off the
// edge. Every one of them is impossible for an addon to write, because the
// projection is on the renderer and nothing else the loader publishes needs it.
//
// ONE frame loop for every anchor, started with the first and stopped with the
// last. Per-anchor loops would be the failure the world watcher already avoids:
// ten anchors would be ten callbacks the browser schedules separately to do the
// same arithmetic against the same camera.
//
// Nothing is written unless it moved. A position is two style writes, and a strip
// of nameplates that rewrote them every frame for a camera nobody is turning would
// be sixty pointless layout invalidations a second, which is exactly the churn
// Cooldown Bars was found paying for its rows.
//
// The projection itself is runtime/world/project.ts, which is where the assertion
// about the game lives. This file only knows that a point may or may not have a
// place on screen.

import type { Teardown } from '../../disposal.ts';
import type { Projector, ScreenPoint } from '../../world/project.ts';

const ANCHOR_CLASS = 'woc-anchor3d';
const HIDDEN_CLASS = 'woc-anchor3d-off';

/**
 * How far off screen a point may be before its anchor is hidden.
 *
 * Not zero, because the element is CENTRED on the point: one whose point has just
 * left the edge is still half on screen, and hiding it there makes a nameplate
 * blink out while its owner is still visible.
 */
const DEFAULT_MARGIN_PX = 64;

interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

/** A fixed point, or one asked for every frame. Null from the function hides it. */
type PointSource = WorldPoint | (() => WorldPoint | null);

interface Anchor3dOpts {
  /** Added to the element, so an addon can style its own. */
  className?: string;
  /** Shifts the element from the point, in screen pixels. Down is positive. */
  offset?: { x?: number; y?: number };
  /** How far off screen the point may be before it hides. Defaults to 64. */
  margin?: number;
}

interface Anchor3d {
  /** The element. Fill it; the loader owns only where it sits. */
  readonly el: HTMLElement;
  /** Whether it is on screen right now, which is worth checking before drawing. */
  readonly visible: boolean;
  /** Point it somewhere else. Also takes a function, for something that moves. */
  moveTo: (at: PointSource) => void;
  destroy: Teardown;
}

interface AnchorsDeps {
  doc: Document;
  /** The #woc-addons root. */
  root: HTMLElement;
  project: Projector;
  viewport: () => { w: number; h: number };
  schedule: (frame: () => void) => number;
  cancel: (id: number) => void;
}

interface Anchors {
  add: (at: PointSource, opts?: Anchor3dOpts) => Anchor3d;
  dispose: () => void;
}

/** One live anchor, as the loop sees it. */
interface Live {
  el: HTMLElement;
  at: PointSource;
  offset: { x: number; y: number };
  margin: number;
  /** What was last written, so an unmoved anchor costs no style writes. */
  last: { x: number; y: number } | null;
  visible: boolean;
}

function pointOf(at: PointSource): WorldPoint | null {
  if (typeof at === 'function') {
    return at();
  }
  return at;
}

/** Whether a projected point is close enough to the screen to be worth drawing. */
function onScreen(
  point: { x: number; y: number; behind: boolean },
  view: { w: number; h: number },
  margin: number,
): boolean {
  if (point.behind) {
    return false;
  }
  return (
    point.x >= -margin &&
    point.y >= -margin &&
    point.x <= view.w + margin &&
    point.y <= view.h + margin
  );
}

function setVisible(anchor: Live, on: boolean): void {
  if (anchor.visible === on) {
    return;
  }
  anchor.visible = on;
  anchor.el.classList.toggle(HIDDEN_CLASS, !on);
}

/** Where this anchor's point is on screen, or null when it has no place. */
function screenPoint(anchor: Live, deps: AnchorsDeps): ScreenPoint | null {
  const world = pointOf(anchor.at);
  if (world === null) {
    return null;
  }
  return deps.project(world.x, world.y, world.z);
}

/** Place one anchor, or hide it. Returns nothing: everything it does is on the DOM. */
function paint(anchor: Live, deps: AnchorsDeps): void {
  const point = screenPoint(anchor, deps);
  if (point === null || !onScreen(point, deps.viewport(), anchor.margin)) {
    setVisible(anchor, false);
    return;
  }

  const x = Math.round(point.x + anchor.offset.x);
  const y = Math.round(point.y + anchor.offset.y);
  setVisible(anchor, true);
  // Rounded and compared before writing: a camera nobody is turning must cost
  // nothing, and a sub-pixel jitter is a style write that changes no pixels.
  if (anchor.last?.x === x && anchor.last.y === y) {
    return;
  }
  anchor.last = { x, y };
  anchor.el.style.left = `${String(x)}px`;
  anchor.el.style.top = `${String(y)}px`;
}

/**
 * The element and the state the loop reads, built together.
 *
 * It starts hidden and stays hidden until the first paint places it: an anchor
 * drawn at the top left for one frame is a marker that flashes across the screen
 * every time an addon creates one.
 */
function build(deps: AnchorsDeps, at: PointSource, opts: Anchor3dOpts): Live {
  const el = deps.doc.createElement('div');
  el.className = `${ANCHOR_CLASS} ${HIDDEN_CLASS}`;
  if (opts.className !== undefined) {
    el.classList.add(opts.className);
  }
  deps.root.appendChild(el);

  return {
    el,
    at,
    offset: { x: opts.offset?.x ?? 0, y: opts.offset?.y ?? 0 },
    margin: opts.margin ?? DEFAULT_MARGIN_PX,
    last: null,
    visible: false,
  };
}

function createAnchors(deps: AnchorsDeps): Anchors {
  const live = new Set<Live>();
  let frame: number | null = null;

  const tick = (): void => {
    for (const anchor of live) {
      paint(anchor, deps);
    }
    // Rescheduled from inside, so the loop stops the moment the last anchor goes
    // rather than running empty for the rest of the session.
    frame = null;
    if (live.size > 0) {
      frame = deps.schedule(tick);
    }
  };

  const start = (): void => {
    frame ??= deps.schedule(tick);
  };

  const drop = (anchor: Live): void => {
    live.delete(anchor);
    anchor.el.remove();
    if (live.size === 0 && frame !== null) {
      deps.cancel(frame);
      frame = null;
    }
  };

  return {
    add: (at, opts = {}) => {
      const anchor = build(deps, at, opts);
      live.add(anchor);
      start();

      return {
        el: anchor.el,
        get visible(): boolean {
          return anchor.visible;
        },
        moveTo: (next) => {
          anchor.at = next;
        },
        destroy: () => {
          drop(anchor);
        },
      };
    },

    dispose: () => {
      for (const anchor of [...live]) {
        drop(anchor);
      }
    },
  };
}

export type { Anchor3d, Anchor3dOpts, Anchors, AnchorsDeps, PointSource, WorldPoint };
export { ANCHOR_CLASS, createAnchors, HIDDEN_CLASS };
