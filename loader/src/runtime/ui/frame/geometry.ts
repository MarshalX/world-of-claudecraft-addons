// Where a movable window is allowed to be. Pure, so every placement rule is reachable from a
// Node test rather than living inside a pointer handler.

/** The manager's usable minimum, and clampBox's default when a caller gives none. */
const MIN_WIDTH = 360;
const MIN_HEIGHT = 220;

/** The floor no frame may go below whatever it asks for: smaller cannot be reliably grabbed. */
const FLOOR_WIDTH = 72;
const FLOOR_HEIGHT = 28;

/** The share of the viewport a window that has never been moved takes. */
const DEFAULT_WIDTH_SHARE = 0.5;
const DEFAULT_HEIGHT_SHARE = 0.8;
const DEFAULT_TOP_SHARE = 0.08;
const HALF = 2;

/**
 * How much of the window has to stay on screen: enough title bar to grab horizontally, and
 * its full height vertically, since a title bar past the top edge can never be grabbed again.
 */
const KEEP_VISIBLE_X = 120;
const TITLE_BAR_HEIGHT = 44;

/**
 * Room the arrange-mode name chip needs above a frame, derived from its rule in
 * `ui/styles/chrome.css`: line height plus padding, border, lift and the outline
 * offset. Change one and change the other, or a frame parked near the top loses its
 * chip to the viewport edge.
 */
const LABEL_CLEARANCE = 32;

/**
 * On a frame whose chip has to hang below it. Written by `paint` in frame/interactive.ts
 * and styled in `ui/styles/chrome.css`.
 */
const LABEL_BELOW_CLASS = 'woc-label-below';

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

/** Which axes the box owns and anything writes. An axis it does not own follows the content. */
interface SizeAxes {
  w: boolean;
  h: boolean;
}

/**
 * What a caller may pin a frame's size between, stated before the viewport is known.
 * clampSize alone reconciles them with it.
 */
interface SizeBounds {
  min?: Viewport;
  max?: Viewport;
}

function clampNumber(value: number, low: number, high: number): number {
  // Low-last, so an inverted range still yields the low bound.
  return Math.max(low, Math.min(high, value));
}

/**
 * A persisted box is untrusted input: GM storage is player-editable, and a NaN reaching a
 * style property silently drops the whole declaration.
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
 * The size half of clampBox. Four bounds claim each axis, and they win in this order:
 *
 *  1. The FLOOR beats everything, since a frame that cannot be grabbed cannot be fixed.
 *  2. The VIEWPORT beats the caller's minimum, or a frame wider than a phone stays that wide.
 *  3. The caller's MINIMUM beats its maximum, since only the minimum is about usability.
 *
 * An absent maximum is the viewport.
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
 * Fit a box to the viewport, keeping it grabbable. Size is clamped before position, since
 * the position bounds depend on the clamped size.
 */
function clampBox(box: FrameBox, viewport: Viewport, bounds?: SizeBounds): FrameBox {
  const { w, h } = clampSize(box, viewport, bounds);

  // The window may hang off either side as long as a grabbable strip remains. The strip is
  // capped at the frame's width, or a narrow frame could never touch either edge.
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
 * Where an addon frame opens the first time: centred near the top like the manager, clear of
 * the HUD furniture at the edges.
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

/** Whether the name chip hangs below the frame. Above is the default, where it covers nothing. */
function labelBelow(top: number, clearance: number = LABEL_CLEARANCE): boolean {
  return top < clearance;
}

export type { FrameBox, SizeAxes, SizeBounds, Viewport };
export {
  clampBox,
  clampNumber,
  clampSize,
  defaultBox,
  FLOOR_HEIGHT,
  FLOOR_WIDTH,
  initialBox,
  isFrameBox,
  LABEL_BELOW_CLASS,
  LABEL_CLEARANCE,
  labelBelow,
  MIN_HEIGHT,
  MIN_WIDTH,
};
