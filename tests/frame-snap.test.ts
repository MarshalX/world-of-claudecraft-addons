// The alignment grid an arranged frame lands on. The two gesture listeners are
// driven directly because interactjs moves nothing under happy-dom.

import { describe, expect, it } from 'vitest';
import type { FrameBox } from '../loader/src/runtime/ui/frame/geometry.ts';
import {
  type BoxWriter,
  dragMover,
  type ResizeEvent,
  resizeMover,
} from '../loader/src/runtime/ui/frame/interactive.ts';
import {
  NO_SNAP,
  SNAP_GRID,
  snapPosition,
  snapResize,
  snapTo,
} from '../loader/src/runtime/ui/frame/snap.ts';

const BOX: FrameBox = { x: 100, y: 200, w: 320, h: 240 };

/** A frame already sitting on the grid, which is where a snapped drag starts from. */
const LINED: FrameBox = { x: 96, y: 208, w: 320, h: 240 };

/** The keeper without the clamp, so a case sees what the gesture PROPOSED. */
function writer(box: FrameBox = BOX): BoxWriter & { current: () => FrameBox } {
  let held = box;
  return {
    box: () => held,
    move: (next) => {
      held = next;
    },
    current: () => held,
  };
}

function resize(over: Partial<ResizeEvent>): ResizeEvent {
  return {
    rect: { width: BOX.w, height: BOX.h },
    deltaRect: { left: 0 },
    edges: {},
    ...over,
  };
}

describe('snapTo', () => {
  it('rounds onto the nearest line', () => {
    expect(snapTo(103, SNAP_GRID)).toBe(96);
    expect(snapTo(105, SNAP_GRID)).toBe(112);
  });

  // A grid of zero that divided would produce Infinity.
  it('passes a value straight through when the grid is off', () => {
    expect(snapTo(103, NO_SNAP)).toBe(103);
  });

  // A NaN reaching a style property drops the declaration silently.
  it('passes a non-finite value through rather than producing one', () => {
    expect(snapTo(Number.NaN, SNAP_GRID)).toBeNaN();
    expect(snapTo(Number.POSITIVE_INFINITY, SNAP_GRID)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('snapPosition', () => {
  it('lands both coordinates on lines and leaves the size alone', () => {
    expect(snapPosition({ x: 103, y: 205, w: 321, h: 241 }, SNAP_GRID)).toEqual({
      x: 96,
      y: 208,
      w: 321,
      h: 241,
    });
  });

  it('changes nothing with the grid off', () => {
    const box = { x: 103, y: 205, w: 321, h: 241 };

    expect(snapPosition(box, NO_SNAP)).toEqual(box);
  });
});

describe('snapResize', () => {
  // Rounding the width alone would jitter the right edge, which interactjs holds
  // still on a left-edge drag.
  it('lands the dragged left edge on a line and holds the right edge exactly', () => {
    const next = snapResize({ x: 103, y: 200, w: 317, h: 240 }, { left: true }, SNAP_GRID);

    expect(next.x).toBe(96);
    expect(next.x + next.w).toBe(420);
  });

  it('lands the dragged right edge on a line and holds the left edge exactly', () => {
    const next = snapResize({ x: 103, y: 200, w: 317, h: 240 }, { right: true }, SNAP_GRID);

    expect(next.x).toBe(103);
    expect(next.x + next.w).toBe(416);
  });

  it('lands the dragged bottom edge on a line and holds the top edge exactly', () => {
    const next = snapResize({ x: 100, y: 205, w: 320, h: 237 }, { bottom: true }, SNAP_GRID);

    expect(next.y).toBe(205);
    expect(next.y + next.h).toBe(448);
  });

  it('snaps both axes of a corner drag', () => {
    const next = snapResize(
      { x: 100, y: 200, w: 317, h: 237 },
      { right: true, bottom: true },
      SNAP_GRID,
    );

    expect(next.x + next.w).toBe(416);
    expect(next.y + next.h).toBe(432);
  });

  // The game's own floor (`snapFrameSize`); every real minimum is clampBox's, afterwards.
  it('never snaps a frame below one cell', () => {
    const flat = snapResize({ x: 100, y: 200, w: 3, h: 240 }, { right: true }, SNAP_GRID);
    const thin = snapResize({ x: 417, y: 200, w: 3, h: 240 }, { left: true }, SNAP_GRID);

    expect(flat.w).toBe(SNAP_GRID);
    expect(thin.w).toBeGreaterThanOrEqual(SNAP_GRID);
  });

  it('changes nothing with the grid off', () => {
    const box = { x: 103, y: 205, w: 317, h: 237 };

    expect(snapResize(box, { left: true, bottom: true }, NO_SNAP)).toEqual(box);
  });

  it('changes nothing when no edge is being dragged', () => {
    const box = { x: 103, y: 205, w: 317, h: 237 };

    expect(snapResize(box, {}, SNAP_GRID)).toEqual(box);
  });
});

describe('the drag listener', () => {
  it('moves the frame by the pointer with the grid off', () => {
    const keeper = writer();
    dragMover(keeper, () => NO_SNAP)({ dx: 3, dy: 5 });

    expect(keeper.current()).toEqual({ ...BOX, x: 103, y: 205 });
  });

  // Without the carried remainder, every delta under half a cell rounds straight
  // back and a slow drag never moves the frame.
  it('reaches the next line under a run of deltas smaller than half a cell', () => {
    const keeper = writer(LINED);
    const move = dragMover(keeper, () => SNAP_GRID);

    for (let at = 0; at < 5; at += 1) {
      move({ dx: 3, dy: 0 });
    }

    expect(keeper.current().x).toBe(LINED.x + SNAP_GRID);
  });

  it('holds a frame on its line until the pointer has travelled half a cell', () => {
    const keeper = writer(LINED);
    const move = dragMover(keeper, () => SNAP_GRID);

    move({ dx: 3, dy: 0 });

    expect(keeper.current().x).toBe(LINED.x);
  });

  // A frame clamped at the viewport edge while the pointer runs on must owe
  // nothing on the way back.
  it('does not build up a debt from a run that goes one way and comes back', () => {
    const keeper = writer(LINED);
    const move = dragMover(keeper, () => SNAP_GRID);

    move({ dx: 200, dy: 0 });
    move({ dx: -200, dy: 0 });

    expect(keeper.current().x).toBe(LINED.x);
  });

  it('pulls an off-grid frame onto the grid on its first real movement', () => {
    const keeper = writer();
    dragMover(keeper, () => SNAP_GRID)({ dx: 0, dy: 0 });

    expect(keeper.current()).toEqual({ ...BOX, x: 96, y: 208 });
  });
});

describe('the resize listener', () => {
  it('turns the reported rect into a box, with the left edge origin shift', () => {
    const keeper = writer();
    resizeMover(
      keeper,
      () => NO_SNAP,
    )(
      resize({
        rect: { width: 300, height: 200 },
        deltaRect: { left: -20 },
        edges: { left: true },
      }),
    );

    expect(keeper.current()).toEqual({ x: 80, y: 200, w: 300, h: 200 });
  });

  it('snaps to the edge the event says is being dragged', () => {
    const keeper = writer();
    resizeMover(
      keeper,
      () => SNAP_GRID,
    )(resize({ rect: { width: 317, height: 240 }, edges: { right: true } }));

    expect(keeper.current().w).toBe(316);
    expect(keeper.current().x + keeper.current().w).toBe(416);
  });
});
