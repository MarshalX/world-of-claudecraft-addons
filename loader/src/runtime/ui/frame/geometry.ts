// Where a movable window is allowed to be.
//
// Pure, so the rules a player actually notices (a window cannot be dragged
// somewhere it can never be dragged back from, a restored position survives a
// smaller monitor) are decided somewhere a Node test can reach, rather than
// inside a pointer handler.

/**
 * Below this the manager is not usable, and its tab strip starts wrapping badly.
 *
 * A default rather than the law: an addon frame is often far smaller (a DPS
 * readout is a number and a label), so clampBox takes its own minimum and falls
 * back to these only when none is given.
 */
const MIN_WIDTH = 360;
const MIN_HEIGHT = 220;

/**
 * The floor no frame may go below whatever it asks for.
 *
 * A frame smaller than this cannot be reliably grabbed by its title bar, which
 * on a frame with no other chrome means it cannot be moved again.
 */
const FLOOR_WIDTH = 72;
const FLOOR_HEIGHT = 28;

/** The share of the viewport a window that has never been moved takes. */
const DEFAULT_WIDTH_SHARE = 0.5;
const DEFAULT_HEIGHT_SHARE = 0.8;
const DEFAULT_TOP_SHARE = 0.08;
const HALF = 2;

/**
 * How much of the window has to stay on screen.
 *
 * Enough of the title bar to grab, horizontally, and its full height
 * vertically: a window dragged past the top edge could never be grabbed again,
 * because the drag handle is the thing that went off screen.
 */
const KEEP_VISIBLE_X = 120;
const TITLE_BAR_HEIGHT = 44;

interface FrameBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Viewport {
  w: number;
  h: number;
}

/**
 * What a caller may pin a frame's size between.
 *
 * Both are the CALLER's numbers, stated before anything knows how big the screen
 * is. Reconciling them with a viewport that may be smaller than either is
 * clampSize's job, and keeping that in one place is the point of passing the
 * request around rather than a pre-resolved pair.
 */
interface SizeBounds {
  min?: Viewport;
  max?: Viewport;
}

function clampNumber(value: number, low: number, high: number): number {
  // Written low-last so a viewport smaller than the minimum still yields the
  // low bound rather than an inverted range.
  return Math.max(low, Math.min(high, value));
}

/**
 * A persisted box is untrusted input.
 *
 * It comes back out of GM storage, which the player can edit and which an older
 * loader may have written differently, and a NaN reaching a style property
 * silently drops the whole declaration rather than raising.
 */
function isFrameBox(value: unknown): value is FrameBox {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const box = value as Record<string, unknown>;
  return (['x', 'y', 'w', 'h'] as const).every(
    (key) => typeof box[key] === 'number' && Number.isFinite(box[key]),
  );
}

/**
 * The size half of clampBox, which is where every bound meets every other one.
 *
 * FOUR numbers claim the same axis and they contradict each other freely, so the
 * order they win in is the whole rule:
 *
 *  1. The FLOOR beats everything. A frame below it cannot be reliably grabbed,
 *     and a frame that cannot be grabbed cannot be fixed, so this is the one
 *     bound no caller is allowed to argue with.
 *  2. The VIEWPORT beats the caller's minimum. Without that a frame asking to be
 *     wider than the screen makes that width its own floor, and a 900-pixel frame
 *     stays 900 pixels wide on a phone.
 *  3. The caller's MINIMUM beats its maximum. A max below the min is a
 *     contradiction someone has to break, and only one of the two is about the
 *     frame staying usable.
 *
 * An absent maximum is the viewport, which is where the size was already capped
 * before there was a maximum to state.
 */
function clampSize(box: FrameBox, viewport: Viewport, bounds?: SizeBounds): Viewport {
  const wanted = bounds?.min ?? { w: MIN_WIDTH, h: MIN_HEIGHT };
  const minW = Math.max(FLOOR_WIDTH, Math.min(wanted.w, viewport.w));
  const minH = Math.max(FLOOR_HEIGHT, Math.min(wanted.h, viewport.h));
  const cap = bounds?.max ?? viewport;
  const maxW = Math.max(minW, Math.min(cap.w, viewport.w));
  const maxH = Math.max(minH, Math.min(cap.h, viewport.h));

  return { w: clampNumber(box.w, minW, maxW), h: clampNumber(box.h, minH, maxH) };
}

/**
 * Fit a box to the viewport, keeping it grabbable.
 *
 * Size is clamped before position, since the position bounds depend on the
 * clamped size: doing it the other way lets a too-wide window pin itself to the
 * left edge and then keep its width.
 */
function clampBox(box: FrameBox, viewport: Viewport, bounds?: SizeBounds): FrameBox {
  const { w, h } = clampSize(box, viewport, bounds);

  // Leftward, the window may hang off screen as long as a grabbable strip of
  // title bar remains; rightward it may not pass the edge by more than that.
  // The strip is capped at the frame's own width: without that cap a frame
  // narrower than the strip could never touch either edge, so a small addon
  // readout would refuse to sit in the corner every HUD element wants.
  const keepX = Math.min(KEEP_VISIBLE_X, w);
  const minX = Math.min(0, keepX - w);
  const maxX = Math.max(minX, viewport.w - keepX);
  const maxY = Math.max(0, viewport.h - TITLE_BAR_HEIGHT);

  return {
    w,
    h,
    x: clampNumber(box.x, minX, maxX),
    y: clampNumber(box.y, 0, maxY),
  };
}

/** The box a window opens at before the player has ever moved it. */
function defaultBox(viewport: Viewport): FrameBox {
  const w = clampNumber(Math.round(viewport.w * DEFAULT_WIDTH_SHARE), MIN_WIDTH, viewport.w);
  const h = clampNumber(Math.round(viewport.h * DEFAULT_HEIGHT_SHARE), MIN_HEIGHT, viewport.h);
  return clampBox(
    { w, h, x: Math.round((viewport.w - w) / HALF), y: Math.round(viewport.h * DEFAULT_TOP_SHARE) },
    viewport,
  );
}

/**
 * Where an addon frame opens the first time, given the size it asked for.
 *
 * Centred horizontally and near the top, the same placement the manager uses,
 * so a frame with no saved position lands somewhere the player will see it
 * rather than under the HUD's own furniture at an edge.
 */
function initialBox(viewport: Viewport, size: Viewport, bounds?: SizeBounds): FrameBox {
  return clampBox(
    {
      w: size.w,
      h: size.h,
      x: Math.round((viewport.w - size.w) / HALF),
      y: Math.round(viewport.h * DEFAULT_TOP_SHARE),
    },
    viewport,
    bounds ?? { min: size },
  );
}

export type { FrameBox, SizeBounds, Viewport };
export {
  clampBox,
  clampNumber,
  clampSize,
  defaultBox,
  FLOOR_HEIGHT,
  FLOOR_WIDTH,
  initialBox,
  isFrameBox,
  MIN_HEIGHT,
  MIN_WIDTH,
};
