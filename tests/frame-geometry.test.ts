// Where a movable window is allowed to be.
//
// Every case here is a state a player can actually reach by dragging, or by
// opening the game on a smaller screen than the one they arranged it on.

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
  //
  // The minimum is capped at the viewport, so the window fits the screen rather
  // than keeping a width that puts its right edge and its close button off it.
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

// An addon frame is often far smaller than the manager: a DPS readout is a
// number and a label. The manager's 360x220 minimum is a default, not the law,
// or every addon frame would be forced to the size of a settings window.
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

  // The keep-visible strip is capped at the frame's own width. Without the cap a
  // frame narrower than the strip could never touch either edge, so a small HUD
  // readout would refuse to sit in the corner every HUD element wants.
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

// The four numbers that claim one axis: the structural floor, the viewport, the
// caller's minimum and the caller's maximum. They contradict each other freely,
// so what is pinned here is the ORDER they win in rather than any one of them.
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

  // A max wider than the screen is not an error and does not widen anything: the
  // viewport was already the cap before a maximum could be stated.
  it('is still capped by the viewport itself', () => {
    const box = clampBox({ x: 0, y: 0, w: 5000, h: 5000 }, VIEW, {
      min: { w: 100, h: 50 },
      max: { w: 9000, h: 9000 },
    });

    expect(box).toMatchObject({ w: VIEW.w, h: VIEW.h });
  });

  // Someone has to break the contradiction, and only one of the two bounds is
  // about the frame staying usable.
  it('loses to the minimum when the two cross', () => {
    const box = clampBox({ x: 0, y: 0, w: 300, h: 300 }, VIEW, {
      min: { w: 400, h: 200 },
      max: { w: 100, h: 50 },
    });

    expect(box).toMatchObject({ w: 400, h: 200 });
  });

  // The floor is the bound nobody argues with: a frame below it cannot be
  // grabbed, and a frame that cannot be grabbed cannot be fixed.
  it('never takes a frame below the floor', () => {
    const box = clampBox({ x: 0, y: 0, w: 300, h: 300 }, VIEW, {
      min: { w: 1, h: 1 },
      max: { w: 2, h: 2 },
    });

    expect(box.w).toBeGreaterThanOrEqual(72);
    expect(box.h).toBeGreaterThanOrEqual(28);
  });

  // The regression the option exists for: before it, a frame's opening size was
  // its permanent floor, so a resizable strip could never be dragged smaller
  // than the size its addon happened to create it at.
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
