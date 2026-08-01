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
 * Fit a box to the viewport, keeping it grabbable.
 *
 * Size is clamped before position, since the position bounds depend on the
 * clamped size: doing it the other way lets a too-wide window pin itself to the
 * left edge and then keep its width.
 *
 * `min` is the caller's own minimum. It is floored, so an addon asking for a
 * 4-pixel frame does not get one it can never grab again, and it is CAPPED at
 * the viewport, so a frame asking to be wider than the screen can still shrink
 * to fit it. Without that cap the requested size becomes its own floor and a
 * 900-pixel frame stays 900 pixels wide on a phone.
 */
function clampBox(box: FrameBox, viewport: Viewport, min?: Viewport): FrameBox {
  const wanted = min ?? { w: MIN_WIDTH, h: MIN_HEIGHT };
  const minW = Math.max(FLOOR_WIDTH, Math.min(wanted.w, viewport.w));
  const minH = Math.max(FLOOR_HEIGHT, Math.min(wanted.h, viewport.h));
  const w = clampNumber(box.w, minW, Math.max(minW, viewport.w));
  const h = clampNumber(box.h, minH, Math.max(minH, viewport.h));

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
function initialBox(viewport: Viewport, size: Viewport): FrameBox {
  return clampBox(
    {
      w: size.w,
      h: size.h,
      x: Math.round((viewport.w - size.w) / HALF),
      y: Math.round(viewport.h * DEFAULT_TOP_SHARE),
    },
    viewport,
    size,
  );
}

export type { FrameBox, Viewport };
export { clampBox, clampNumber, defaultBox, initialBox, isFrameBox, MIN_HEIGHT, MIN_WIDTH };
