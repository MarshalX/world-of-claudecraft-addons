// @vitest-environment happy-dom

// Elements kept over world points, and the projection behind them.
//
// Two things are worth pinning and they are in different files. The PROJECTION is
// a read of the game's renderer, which this repository cannot compile against, so
// what matters there is that a missing method, a throwing one and a nonsense
// answer are each a null rather than an exception or a NaN written to a style.
//
// The LOOP is the kit's, and what matters is that it is one loop rather than one
// per anchor, that it stops when the last anchor goes, and that a frame in which
// nothing moved writes nothing. A strip of nameplates repainting sixty times a
// second for a camera nobody is turning is the same churn Cooldown Bars was found
// paying for its rows.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ANCHOR_CLASS,
  createAnchors,
  HIDDEN_CLASS,
} from '../loader/src/runtime/ui/kit/anchor3d.ts';
import type { UnitPointResolver } from '../loader/src/runtime/world/anchor-point.ts';
import type { Projector, ScreenPoint } from '../loader/src/runtime/world/project.ts';
import { createProjector } from '../loader/src/runtime/world/project.ts';
import { createFrameClock } from './fakes/frame-loop.ts';

const VIEW = { w: 1280, h: 800 };

function root(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'woc-addons';
  document.body.appendChild(el);
  return el;
}

/** An identity view matrix, so a point's camera-space z is its own z. */
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const SOMEWHERE: ScreenPoint = { x: 100, y: 200, depth: 10, behind: false };

function open(project: Projector = () => SOMEWHERE, unitPoint: UnitPointResolver = () => null) {
  const host = root();
  const frames = createFrameClock();
  const anchors = createAnchors({
    doc: document,
    root: host,
    project,
    unitPoint,
    viewport: () => VIEW,
    frames: frames.loop,
  });
  return { anchors, frames, host };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the projection', () => {
  it('answers the renderer point as it is', () => {
    const project = createProjector(() => ({
      renderer: { worldToScreen: () => ({ x: 12.5, y: 40, behind: false }) },
    }));

    expect(project(1, 2, 3)).toEqual({ x: 12.5, y: 40, depth: 0, behind: false });
  });

  // Everything before world entry, which is where an addon's first line runs.
  it.each([
    ['no game at all', null],
    ['a game with no renderer', {}],
    ['a renderer with no method', { renderer: {} }],
  ])('answers null for %s', (_case, game) => {
    expect(createProjector(() => game)(1, 2, 3)).toBeNull();
  });

  // A future update can leave something callable in place that throws when
  // called. The cost has to be a hidden anchor, not a dead frame loop.
  it('answers null when the renderer throws', () => {
    const project = createProjector(() => ({
      renderer: {
        worldToScreen: () => {
          throw new Error('no camera');
        },
      },
    }));

    expect(project(1, 2, 3)).toBeNull();
  });

  // A NaN assigned to a style property drops the declaration silently, so an
  // anchor would stop where it was and read as misplaced rather than as failed.
  it.each([
    ['a NaN', { x: Number.NaN, y: 0, behind: false }],
    ['a missing coordinate', { y: 0, behind: false }],
    ['nothing', null],
  ])('answers null for %s', (_case, answer) => {
    const project = createProjector(() => ({ renderer: { worldToScreen: () => answer } }));

    expect(project(1, 2, 3)).toBeNull();
  });

  // The game is read on every call rather than captured: the loader starts at
  // document-start and __game is assigned at world entry.
  it('picks the game up when it appears', () => {
    let game: unknown = null;
    const project = createProjector(() => game);
    expect(project(1, 2, 3)).toBeNull();

    game = { renderer: { worldToScreen: () => ({ x: 1, y: 2, behind: false }) } };

    expect(project(1, 2, 3)).not.toBeNull();
  });
});

describe('the near-plane guard', () => {
  // The live defect this guard fixes: `worldToScreen` reports only the FAR half of
  // the depth test, so a point between the camera and the near plane comes back
  // finite, wrong by any amount, and flagged as not behind. The game's own
  // nameplates, chat bubbles and click picking all guard against exactly it.
  function renderer(near: unknown, elements: unknown = IDENTITY) {
    return {
      renderer: {
        worldToScreen: () => ({ x: 640, y: 400, behind: false }),
        camera: { near, matrixWorldInverse: { elements } },
      },
    };
  }

  it('reports a point nearer than the near plane as behind', () => {
    const project = createProjector(() => renderer(0.1));

    // Camera space z of -0.05 with an identity view matrix: in front, but inside
    // the near plane.
    expect(project(0, 0, -0.05)?.behind).toBe(true);
  });

  it('keeps a point beyond the near plane', () => {
    const project = createProjector(() => renderer(0.1));

    expect(project(0, 0, -12)?.behind).toBe(false);
  });

  it('reports depth as yards in front of the camera', () => {
    const project = createProjector(() => renderer(0.1));

    expect(project(0, 0, -12)?.depth).toBe(12);
  });

  // A guard that turned every anchor off because a game update moved the camera
  // would be worse than the over-trusting projection this file shipped with.
  it.each([
    ['no camera at all', undefined],
    ['a matrix that is not an array', 'nonsense'],
    ['a matrix that is too short', [1, 0, 0]],
  ])('falls back to the raw flag with %s', (_case, elements) => {
    const project = createProjector(() => ({
      renderer: {
        worldToScreen: () => ({ x: 640, y: 400, behind: false }),
        camera: { near: 0.1, matrixWorldInverse: { elements } },
      },
    }));

    expect(project(0, 0, -0.05)).toEqual({ x: 640, y: 400, depth: 0, behind: false });
  });

  // Degraded rather than refused: without a near plane the guard still answers the
  // half of the question the raw flag does not.
  it('degrades to the camera plane when near is unreadable', () => {
    const project = createProjector(() => renderer(undefined));

    expect(project(0, 0, -0.05)?.behind).toBe(false);
    expect(project(0, 0, 5)?.behind).toBe(true);
  });

  it('hides an anchor the guard rejected', () => {
    const { anchors, frames } = open(createProjector(() => renderer(0.1)));
    const anchor = anchors.add({ x: 0, y: 0, z: -0.05 });

    frames.tick();

    expect(anchor.el.classList.contains(HIDDEN_CLASS)).toBe(true);
    expect(anchor.el.style.left).toBe('');
  });
});

describe('anchoring to a unit', () => {
  it('resolves the unit through the shared resolver, every frame', () => {
    const unitPoint = vi.fn(() => ({ x: 1, y: 2, z: 3 }));
    const { anchors, frames } = open(undefined, unitPoint);
    const anchor = anchors.add({ unit: 'target' });

    frames.tick();
    frames.tick();

    expect(unitPoint).toHaveBeenCalledTimes(2);
    expect(unitPoint).toHaveBeenLastCalledWith({ unit: 'target' });
    expect(anchor.visible).toBe(true);
  });

  // The honest answer for a unit the game is not drawing: the same one the game
  // gives, which is no nameplate at all.
  it('hides when the unit has no point', () => {
    const { anchors, frames } = open(undefined, () => null);
    const anchor = anchors.add({ unit: 'target', over: 'head' });

    frames.tick();

    expect(anchor.visible).toBe(false);
  });
});

describe('placing an anchor', () => {
  it('starts hidden, because it has nowhere to be until a frame runs', () => {
    const { anchors } = open();

    const anchor = anchors.add({ x: 0, y: 0, z: 0 });

    expect(anchor.el.classList.contains(HIDDEN_CLASS)).toBe(true);
    expect(anchor.visible).toBe(false);
  });

  it('places it where the point projects to', () => {
    const { anchors, frames } = open();
    const anchor = anchors.add({ x: 0, y: 0, z: 0 });

    frames.tick();

    expect(anchor.el.style.left).toBe('100px');
    expect(anchor.el.style.top).toBe('200px');
    expect(anchor.visible).toBe(true);
  });

  it('shifts it by the offset it was given', () => {
    const { anchors, frames } = open();
    const anchor = anchors.add({ x: 0, y: 0, z: 0 }, { offset: { y: -40 } });

    frames.tick();

    expect(anchor.el.style.top).toBe('160px');
  });

  it('follows a function, for a point that moves', () => {
    const { anchors, frames } = open();
    let where = { x: 0, y: 0, z: 0 };
    const anchor = anchors.add(() => where);
    frames.tick();

    where = { x: 5, y: 5, z: 5 };
    frames.tick();

    expect(anchor.visible).toBe(true);
  });

  // The honest answer for a unit that has gone: an addon following an entity
  // reads null the frame it despawns.
  it('hides when the function says there is no point any more', () => {
    const { anchors, frames } = open();
    let where: { x: number; y: number; z: number } | null = { x: 0, y: 0, z: 0 };
    const anchor = anchors.add(() => where);
    frames.tick();
    expect(anchor.visible).toBe(true);

    where = null;
    frames.tick();

    expect(anchor.visible).toBe(false);
  });

  it('takes a new point through moveTo', () => {
    const { anchors, frames } = open();
    const anchor = anchors.add({ x: 0, y: 0, z: 0 });

    anchor.moveTo(() => null);
    frames.tick();

    expect(anchor.visible).toBe(false);
  });
});

describe('what is hidden', () => {
  it('hides a point behind the camera', () => {
    const { anchors, frames } = open(() => ({ ...SOMEWHERE, behind: true }));
    const anchor = anchors.add({ x: 0, y: 0, z: 0 });

    frames.tick();

    expect(anchor.visible).toBe(false);
  });

  it('hides a point past the edge by more than the margin', () => {
    const { anchors, frames } = open(() => ({ ...SOMEWHERE, x: -400 }));
    const anchor = anchors.add({ x: 0, y: 0, z: 0 });

    frames.tick();

    expect(anchor.visible).toBe(false);
  });

  // The element is centred on the point, so one just past the edge is still half
  // on screen: hiding it there makes a nameplate blink out while its unit shows.
  it('keeps a point just past the edge, within the margin', () => {
    const { anchors, frames } = open(() => ({ ...SOMEWHERE, x: -20 }));
    const anchor = anchors.add({ x: 0, y: 0, z: 0 });

    frames.tick();

    expect(anchor.visible).toBe(true);
  });

  it('hides everything while the game cannot be asked', () => {
    const { anchors, frames } = open(() => null);
    const anchor = anchors.add({ x: 0, y: 0, z: 0 });

    frames.tick();

    expect(anchor.visible).toBe(false);
  });
});

// One loop for every anchor, and none at all when there are none.
describe('the frame loop', () => {
  it('runs one callback however many anchors there are', () => {
    const { anchors, frames } = open();

    anchors.add({ x: 0, y: 0, z: 0 });
    anchors.add({ x: 1, y: 1, z: 1 });
    anchors.add({ x: 2, y: 2, z: 2 });

    expect(frames.pending()).toBe(1);
  });

  it('keeps going while anything is anchored', () => {
    const { anchors, frames } = open();
    anchors.add({ x: 0, y: 0, z: 0 });

    frames.tick();

    expect(frames.pending()).toBe(1);
  });

  it('stops when the last anchor is destroyed', () => {
    const { anchors, frames } = open();
    const anchor = anchors.add({ x: 0, y: 0, z: 0 });
    frames.tick();

    anchor.destroy();
    frames.tick();

    expect(frames.pending()).toBe(0);
    expect(frames.cancelled()).toBe(1);
  });

  it('takes the element with it', () => {
    const { anchors, host } = open();
    const anchor = anchors.add({ x: 0, y: 0, z: 0 });

    anchor.destroy();

    expect(host.querySelector(`.${ANCHOR_CLASS}`)).toBeNull();
  });

  it('drops every anchor on dispose', () => {
    const { anchors, frames, host } = open();
    anchors.add({ x: 0, y: 0, z: 0 });
    anchors.add({ x: 1, y: 1, z: 1 });

    anchors.dispose();

    expect(host.querySelectorAll(`.${ANCHOR_CLASS}`)).toHaveLength(0);
    frames.tick();
    expect(frames.pending()).toBe(0);
  });

  // A camera nobody is turning must cost nothing. Style writes are the whole
  // output of this loop, so a frame that changes no pixels must write none.
  it('writes nothing for a frame in which nothing moved', () => {
    const { anchors, frames } = open();
    const anchor = anchors.add({ x: 0, y: 0, z: 0 });
    frames.tick();
    const writes = vi.spyOn(anchor.el.style, 'setProperty');

    frames.tick();
    frames.tick();

    expect(anchor.el.style.left).toBe('100px');
    expect(writes).not.toHaveBeenCalled();
  });

  // Sub-pixel movement is a style write that changes nothing on screen.
  it('ignores a move smaller than a pixel', () => {
    let x = 100;
    const { anchors, frames } = open(() => ({ ...SOMEWHERE, x }));
    const anchor = anchors.add({ x: 0, y: 0, z: 0 });
    frames.tick();

    x = 100.4;
    frames.tick();

    expect(anchor.el.style.left).toBe('100px');
  });
});
