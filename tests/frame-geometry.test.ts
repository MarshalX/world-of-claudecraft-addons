// Where a movable window is allowed to be, after a drag or on a smaller screen.

import { describe, expect, it } from 'vitest';
import {
  clampBox,
  defaultBox,
  type FrameBox,
  initialBox,
  isFrameBox,
  LABEL_CLEARANCE,
  labelBelow,
  MIN_HEIGHT,
  MIN_WIDTH,
} from '../loader/src/runtime/ui/frame/geometry.ts';

const VIEW = { w: 1600, h: 900 };
const BOX: FrameBox = { x: 400, y: 100, w: 720, h: 600 };

describe('clampBox', () => {
  it('leaves a box that already fits alone', () => {
    expect(clampBox(BOX, VIEW)).toEqual(BOX);
  });

  // The title bar is the drag handle, so above the top edge it could never be grabbed.
  it('refuses to put the title bar above the top edge', () => {
    expect(clampBox({ ...BOX, y: -200 }, VIEW).y).toBe(0);
  });

  it('keeps the title bar reachable at the bottom edge', () => {
    const clamped = clampBox({ ...BOX, y: 5000 }, VIEW);

    expect(clamped.y).toBeLessThan(VIEW.h);
    expect(VIEW.h - clamped.y).toBeGreaterThanOrEqual(40);
  });

  // Sideways it may hang off, but a grabbable strip stays on screen.
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

  // Size is clamped first because the position bounds depend on the clamped size.
  it('positions against the clamped size, not the requested one', () => {
    const clamped = clampBox({ x: 1500, y: 0, w: 4000, h: 400 }, VIEW);

    expect(clamped.w).toBe(VIEW.w);
    expect(clamped.x).toBeLessThanOrEqual(VIEW.w - 120);
  });

  // An inverted clamp range yields NaN, which a style property drops silently. The
  // minimum is capped at the viewport so the close button stays on screen.
  it('yields a finite box that fits a viewport smaller than the minimum', () => {
    const tiny = { w: 300, h: 200 };
    const clamped = clampBox(BOX, tiny);

    for (const value of Object.values(clamped)) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(clamped.w).toBe(tiny.w);
    expect(clamped.w).toBeLessThan(MIN_WIDTH);
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

  // The persisted value comes out of GM storage, which the player can edit.
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

// The manager's minimum is only a default; an addon frame is often far smaller.
describe('a caller-supplied minimum', () => {
  it('lets a small frame keep the size it asked for', () => {
    const small = { w: 220, h: 90 };

    expect(clampBox({ x: 40, y: 40, ...small }, VIEW, { min: small })).toMatchObject(small);
  });

  it('still floors a frame too small to grab by its title bar', () => {
    const box = clampBox({ x: 0, y: 0, w: 4, h: 2 }, VIEW, { min: { w: 4, h: 2 } });

    expect(box.w).toBeGreaterThanOrEqual(72);
    expect(box.h).toBeGreaterThanOrEqual(28);
  });

  it('applies the manager minimum when no minimum is given', () => {
    const box = clampBox({ x: 0, y: 0, w: 100, h: 100 }, VIEW);

    expect(box.w).toBe(MIN_WIDTH);
    expect(box.h).toBe(MIN_HEIGHT);
  });

  // The keep-visible strip is capped at the frame's width, or a narrow frame could never
  // touch either edge.
  it('lets a narrow frame reach both edges', () => {
    const small = { w: 90, h: 40 };

    expect(clampBox({ x: -500, y: 10, ...small }, VIEW, { min: small }).x).toBe(0);
    expect(clampBox({ x: 5000, y: 10, ...small }, VIEW, { min: small }).x).toBe(VIEW.w - small.w);
  });

  it('still lets a wide window hang off the left with a strip showing', () => {
    const wide = { w: 800, h: 400 };

    expect(clampBox({ x: -5000, y: 10, ...wide }, VIEW, { min: wide }).x).toBe(120 - wide.w);
  });
});

describe('initialBox', () => {
  it('centres a new frame horizontally and puts it near the top', () => {
    const size = { w: 240, h: 120 };
    const box = initialBox(VIEW, size);

    expect(box).toMatchObject(size);
    expect(box.x).toBe(Math.round((VIEW.w - size.w) / 2));
    expect(box.y).toBeLessThan(VIEW.h / 2);
  });

  it('keeps a frame larger than the viewport on screen', () => {
    const box = initialBox({ w: 320, h: 240 }, { w: 900, h: 700 });

    for (const value of Object.values(box)) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(box.w).toBeLessThanOrEqual(320);
  });
});

// Floor, viewport, caller minimum and caller maximum contradict freely; this pins the
// order they win in.
describe('a caller-supplied maximum', () => {
  it('stops a frame growing past it', () => {
    const box = clampBox({ x: 0, y: 0, w: 5000, h: 5000 }, VIEW, {
      min: { w: 100, h: 50 },
      max: { w: 400, h: 200 },
    });

    expect(box).toMatchObject({ w: 400, h: 200 });
  });

  it('leaves a frame under it alone', () => {
    const box = clampBox({ x: 0, y: 0, w: 300, h: 150 }, VIEW, {
      min: { w: 100, h: 50 },
      max: { w: 400, h: 200 },
    });

    expect(box).toMatchObject({ w: 300, h: 150 });
  });

  it('caps at the viewport when there is no maximum', () => {
    const box = clampBox({ x: 0, y: 0, w: 5000, h: 5000 }, VIEW, { min: { w: 100, h: 50 } });

    expect(box).toMatchObject({ w: VIEW.w, h: VIEW.h });
  });

  it('is still capped by the viewport itself', () => {
    const box = clampBox({ x: 0, y: 0, w: 5000, h: 5000 }, VIEW, {
      min: { w: 100, h: 50 },
      max: { w: 9000, h: 9000 },
    });

    expect(box).toMatchObject({ w: VIEW.w, h: VIEW.h });
  });

  // Only the minimum is about the frame staying usable.
  it('loses to the minimum when the two cross', () => {
    const box = clampBox({ x: 0, y: 0, w: 300, h: 300 }, VIEW, {
      min: { w: 400, h: 200 },
      max: { w: 100, h: 50 },
    });

    expect(box).toMatchObject({ w: 400, h: 200 });
  });

  // A frame below the floor cannot be grabbed, so it cannot be fixed.
  it('never takes a frame below the floor', () => {
    const box = clampBox({ x: 0, y: 0, w: 300, h: 300 }, VIEW, {
      min: { w: 1, h: 1 },
      max: { w: 2, h: 2 },
    });

    expect(box.w).toBeGreaterThanOrEqual(72);
    expect(box.h).toBeGreaterThanOrEqual(28);
  });

  it('lets a frame shrink below the size it opened at', () => {
    const box = clampBox({ x: 0, y: 0, w: 120, h: 60 }, VIEW, { min: { w: 80, h: 40 } });

    expect(box).toMatchObject({ w: 120, h: 60 });
  });
});

// A frame parked at the top of the viewport has no room above it for the name chip.
describe('labelBelow', () => {
  it('keeps the chip above a frame with room for it', () => {
    expect(labelBelow(LABEL_CLEARANCE)).toBe(false);
    expect(labelBelow(400)).toBe(false);
  });

  it('flips the chip under a frame parked against the top edge', () => {
    expect(labelBelow(0)).toBe(true);
    expect(labelBelow(LABEL_CLEARANCE - 1)).toBe(true);
  });
});
