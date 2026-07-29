// Where a movable window is allowed to be.
//
// Every case here is a state a player can actually reach by dragging, or by
// opening the game on a smaller screen than the one they arranged it on.

import { describe, expect, it } from 'vitest';
import {
  clampBox,
  defaultBox,
  type FrameBox,
  isFrameBox,
  MIN_HEIGHT,
  MIN_WIDTH,
} from '../loader/src/runtime/ui/frame/geometry.ts';

const VIEW = { w: 1600, h: 900 };
const BOX: FrameBox = { x: 400, y: 100, w: 720, h: 600 };

describe('clampBox', () => {
  it('leaves a box that already fits alone', () => {
    expect(clampBox(BOX, VIEW)).toEqual(BOX);
  });

  // The title bar is the drag handle, so a window dragged above the top edge
  // could never be grabbed again.
  it('refuses to put the title bar above the top edge', () => {
    expect(clampBox({ ...BOX, y: -200 }, VIEW).y).toBe(0);
  });

  it('keeps the title bar reachable at the bottom edge', () => {
    const clamped = clampBox({ ...BOX, y: 5000 }, VIEW);

    expect(clamped.y).toBeLessThan(VIEW.h);
    expect(VIEW.h - clamped.y).toBeGreaterThanOrEqual(40);
  });

  // Sideways it may hang off, which is useful for parking it, but a grabbable
  // strip has to stay on screen at both edges.
  it('keeps a grabbable strip on screen when dragged off the right', () => {
    const clamped = clampBox({ ...BOX, x: 5000 }, VIEW);

    expect(clamped.x).toBeLessThanOrEqual(VIEW.w - 120);
  });

  it('keeps a grabbable strip on screen when dragged off the left', () => {
    const clamped = clampBox({ ...BOX, x: -5000 }, VIEW);

    expect(clamped.x + clamped.w).toBeGreaterThanOrEqual(120);
  });

  it('holds the minimum size against a resize past it', () => {
    expect(clampBox({ ...BOX, w: 10, h: 10 }, VIEW)).toMatchObject({
      w: MIN_WIDTH,
      h: MIN_HEIGHT,
    });
  });

  it('shrinks a box that is larger than the viewport', () => {
    expect(clampBox({ x: 0, y: 0, w: 4000, h: 4000 }, VIEW)).toMatchObject({
      w: VIEW.w,
      h: VIEW.h,
    });
  });

  // Size is clamped before position because the position bounds depend on the
  // clamped size. Done the other way a too-wide window pins itself left and
  // then keeps its width, ending up off screen on the right.
  it('positions against the clamped size, not the requested one', () => {
    const clamped = clampBox({ x: 1500, y: 0, w: 4000, h: 400 }, VIEW);

    expect(clamped.w).toBe(VIEW.w);
    expect(clamped.x).toBeLessThanOrEqual(VIEW.w - 120);
  });

  // A phone in portrait is narrower than the minimum width. An inverted clamp
  // range there would produce NaN, and a NaN reaching a style property drops
  // the declaration silently rather than raising.
  it('yields a finite box on a viewport smaller than the minimum', () => {
    const clamped = clampBox(BOX, { w: 300, h: 200 });

    for (const value of Object.values(clamped)) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(clamped.w).toBe(MIN_WIDTH);
  });
});

describe('defaultBox', () => {
  it('opens inside the viewport', () => {
    const box = defaultBox(VIEW);

    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.w).toBeLessThanOrEqual(VIEW.w);
  });

  it('is stable under a second clamp', () => {
    const box = defaultBox(VIEW);

    expect(clampBox(box, VIEW)).toEqual(box);
  });

  it('still yields a finite box on a tiny viewport', () => {
    const box = defaultBox({ w: 320, h: 480 });

    for (const value of Object.values(box)) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe('isFrameBox', () => {
  it('accepts a real box', () => {
    expect(isFrameBox(BOX)).toBe(true);
  });

  // The persisted value comes back out of GM storage, which the player can edit
  // and which an older loader may have written differently.
  it.each([
    ['null', null],
    ['a string', '{"x":1}'],
    ['a missing field', { x: 1, y: 2, w: 3 }],
    ['a non-numeric field', { x: 1, y: 2, w: 3, h: '4' }],
    ['a NaN', { x: Number.NaN, y: 2, w: 3, h: 4 }],
    ['an Infinity', { x: 1, y: 2, w: Number.POSITIVE_INFINITY, h: 4 }],
  ])('rejects %s', (_label, value) => {
    expect(isFrameBox(value)).toBe(false);
  });
});
