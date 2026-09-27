// An element the loader keeps over a point in the world.
//
// Nameplates, ground markers, a pin on a gathering node: an element whose screen position is
// a world position projected every frame, hidden when the point is behind the camera or off
// the edge. The projection itself is runtime/world/project.ts.
//
// All anchors share the loader's one frame loop (`runtime/frame-loop.ts`) as its PAINT phase,
// so a point an addon moved in its own `woc.onFrame` handler lands in the same frame. Nothing
// is written unless it moved.

import type { Teardown } from '../../disposal.ts';
import type { FrameLoop } from '../../frame-loop.ts';
import type { UnitPoint, UnitPointResolver, WorldPoint } from '../../world/anchor-point.ts';
import type { Projector, ScreenPoint } from '../../world/project.ts';

const ANCHOR_CLASS = 'woc-anchor3d';
const HIDDEN_CLASS = 'woc-anchor3d-off';

/**
 * How far off screen a point may be before its anchor is hidden. Not zero: the element is
 * centred on the point, so it is still half on screen when the point leaves the edge.
 */
const DEFAULT_MARGIN_PX = 64;

/**
 * A fixed point, a unit, or one asked for every frame. A null hides the anchor. The unit
 * form is resolved by world/anchor-point.ts, so the kit makes no claim about the game.
 */
type PointSource = WorldPoint | UnitPoint | (() => WorldPoint | null);

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
  /** A unit token or entity id to a world point. See world/anchor-point.ts. */
  unitPoint: UnitPointResolver;
  viewport: () => { w: number; h: number };
  /** The loader's one loop. Anchors paint after every addon handler has run. */
  frames: FrameLoop;
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

function pointOf(at: PointSource, unitPoint: UnitPointResolver): WorldPoint | null {
  if (typeof at === 'function') {
    return at();
  }
  if ('unit' in at) {
    return unitPoint(at);
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
  const world = pointOf(anchor.at, deps.unitPoint);
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
  // Rounded and compared first, so a still camera and sub-pixel jitter cost no style writes.
  if (anchor.last?.x === x && anchor.last.y === y) {
    return;
  }
  anchor.last = { x, y };
  anchor.el.style.left = `${String(x)}px`;
  anchor.el.style.top = `${String(y)}px`;
}

/**
 * The element and the state the loop reads. It starts hidden until the first paint places
 * it, or it would flash at the top left for a frame.
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
  // One registration on the shared loop, taken with the first anchor and dropped with the last.
  let stop: Teardown | null = null;

  const start = (): void => {
    stop ??= deps.frames.onPaint(() => {
      for (const anchor of live) {
        paint(anchor, deps);
      }
    });
  };

  const drop = (anchor: Live): void => {
    live.delete(anchor);
    anchor.el.remove();
    if (live.size === 0 && stop !== null) {
      stop();
      stop = null;
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

export type { Anchor3d, Anchor3dOpts, Anchors, AnchorsDeps, PointSource };
export { ANCHOR_CLASS, createAnchors, HIDDEN_CLASS };
