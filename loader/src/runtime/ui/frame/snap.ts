// The alignment grid an arranged frame lands on. Pure, like geometry.ts, and it
// takes the grid as a number where 0 means off, so the drag path carries no branch.

import type { FrameBox } from './geometry.ts';

/**
 * The pitch in VISUAL pixels: the game's `FRAME_SNAP_GRID` (`src/ui/target_frame_pos.ts`),
 * which its edit mode draws on screen while this mode is on. Do not divide by
 * `--ui-scale`: the game's overlay does (`calc(16px / var(--ui-scale, 1))`,
 * `src/styles/hud.css`) because `#ui` is zoomed by it, and the loader's root is an
 * unzoomed sibling of `#ui`.
 */
const SNAP_GRID = 16;

/** Snapping off, said as a grid so the call sites stay branchless. */
const NO_SNAP = 0;

/** Which edges a resize gesture is dragging. interactjs's own shape. */
interface ResizeEdges {
  left?: boolean | undefined;
  right?: boolean | undefined;
  bottom?: boolean | undefined;
}

/** Round onto the nearest line. A non-finite value or an off grid passes through. */
function snapTo(value: number, grid: number): number {
  if (!Number.isFinite(value) || grid <= NO_SNAP) {
    return value;
  }
  return Math.round(value / grid) * grid;
}

/** The leading edge (left or top) onto a line, staying a cell clear of the far one. */
function snapNear(near: number, far: number, grid: number): number {
  return Math.min(snapTo(near, grid), far - grid);
}

/** The trailing edge (right or bottom) onto a line, staying a cell clear of the near one. */
function snapFar(far: number, near: number, grid: number): number {
  return Math.max(snapTo(far, grid), near + grid);
}

/**
 * A dragged frame's position on the nearest lines. The size is left alone: rounding
 * it would resize a frame the player only moved.
 */
function snapPosition(box: FrameBox, grid: number): FrameBox {
  return { ...box, x: snapTo(box.x, grid), y: snapTo(box.y, grid) };
}

/**
 * A resized frame with the DRAGGED edge on a line and the opposite edge held exactly.
 * Snapping the width alone would jitter the right edge on a left-edge drag, which is
 * why the edges come off the event; the one-cell floor is the game's (`snapFrameSize`),
 * and every real minimum is applied afterwards by `clampBox`.
 */
function snapResize(box: FrameBox, edges: ResizeEdges, grid: number): FrameBox {
  if (grid <= NO_SNAP) {
    return box;
  }
  const next = { ...box };
  if (edges.left === true) {
    const right = box.x + box.w;
    next.x = snapNear(box.x, right, grid);
    next.w = right - next.x;
  } else if (edges.right === true) {
    next.w = snapFar(box.x + box.w, box.x, grid) - box.x;
  }
  if (edges.bottom === true) {
    next.h = snapFar(box.y + box.h, box.y, grid) - box.y;
  }
  return next;
}

export type { ResizeEdges };
export { NO_SNAP, SNAP_GRID, snapPosition, snapResize, snapTo };
