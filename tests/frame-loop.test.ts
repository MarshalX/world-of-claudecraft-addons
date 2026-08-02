// @vitest-environment happy-dom

// The one animation-frame loop the loader runs.
//
// Three things are worth pinning and they are the three reasons this exists as an
// object rather than as a set of callbacks. The PHASE ORDER, because an addon's
// handler moves things and the loader's paint pass reads what moved, so a paint
// that ran first would put every anchor one frame behind. The IDLE behaviour,
// because a session with no animating addon and no anchor has to cost nothing.
// And the FREEZE, because addon handlers are held while the loader's own paint
// pass keeps running, which is the opposite of what `woc.requestAnimationFrame`
// does and is the reason `onFrame` is a different primitive rather than a wrapper.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_FRAME_DT_MS } from '../loader/src/runtime/frame-loop.ts';
import { setFrozen } from '../loader/src/runtime/freeze.ts';
import { createFrameClock } from './fakes/frame-loop.ts';

afterEach(() => {
  setFrozen(document, false);
});

describe('the two phases', () => {
  // The whole reason this is one object: registration order must not decide it.
  it('runs every handler before every paint, whatever order they subscribed in', () => {
    const clock = createFrameClock();
    const ran: string[] = [];
    clock.loop.onPaint(() => ran.push('paint'));
    clock.loop.on(() => ran.push('handler'));

    clock.tick();

    expect(ran).toEqual(['handler', 'paint']);
  });

  it('runs both in the same frame', () => {
    const clock = createFrameClock();
    const handler = vi.fn();
    const paint = vi.fn();
    clock.loop.on(handler);
    clock.loop.onPaint(paint);

    clock.tick();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(paint).toHaveBeenCalledTimes(1);
  });
});

describe('what it costs when nothing is subscribed', () => {
  it('schedules nothing until something subscribes', () => {
    const clock = createFrameClock();

    expect(clock.pending()).toBe(0);
  });

  it('runs one browser callback however many handlers there are', () => {
    const clock = createFrameClock();
    clock.loop.on(() => undefined);
    clock.loop.on(() => undefined);
    clock.loop.onPaint(() => undefined);

    expect(clock.pending()).toBe(1);
  });

  it('stops when the last subscriber goes', () => {
    const clock = createFrameClock();
    const off = clock.loop.on(() => undefined);
    clock.tick();

    off();

    expect(clock.pending()).toBe(0);
    expect(clock.cancelled()).toBe(1);
  });

  it('keeps running while one of two remains', () => {
    const clock = createFrameClock();
    const off = clock.loop.on(() => undefined);
    clock.loop.onPaint(() => undefined);

    off();

    expect(clock.pending()).toBe(1);
  });

  it('drops everything on dispose', () => {
    const clock = createFrameClock();
    const handler = vi.fn();
    clock.loop.on(handler);

    clock.loop.dispose();
    clock.tick();

    expect(handler).not.toHaveBeenCalled();
    expect(clock.pending()).toBe(0);
  });
});

describe('the delta', () => {
  it('is zero on the first frame', () => {
    const clock = createFrameClock();
    const seen: number[] = [];
    clock.loop.on((dt) => seen.push(dt));

    clock.tick(40);

    expect(seen).toEqual([0]);
  });

  it('is the time since the previous frame', () => {
    const clock = createFrameClock();
    const seen: number[] = [];
    clock.loop.on((dt) => seen.push(dt));

    clock.tick(16);
    clock.tick(33);

    expect(seen).toEqual([0, 33]);
  });

  // A tab returning from the background otherwise hands an addon half a minute to
  // multiply a sweep by. The clamp is the game's own.
  it('is clamped for a tab that came back from the background', () => {
    const clock = createFrameClock();
    const seen: number[] = [];
    clock.loop.on((dt) => seen.push(dt));
    clock.tick(16);

    clock.tick(40_000);

    expect(seen.at(-1)).toBe(MAX_FRAME_DT_MS);
  });

  // A restart must not hand its first frame however long nobody was subscribed.
  it('starts again at zero after the loop went idle', () => {
    const clock = createFrameClock();
    const off = clock.loop.on(() => undefined);
    clock.tick(16);
    off();

    const seen: number[] = [];
    clock.loop.on((dt) => seen.push(dt));
    clock.tick(5000);

    expect(seen).toEqual([0]);
  });
});

describe('a callback that throws', () => {
  it('does not stop the ones after it, or the next frame', () => {
    const clock = createFrameClock();
    const after = vi.fn();
    clock.loop.on(() => {
      throw new Error('addon bug');
    });
    clock.loop.on(after);

    clock.tick();
    clock.tick();

    expect(after).toHaveBeenCalledTimes(2);
    expect(clock.pending()).toBe(1);
  });

  it('does not stop the paint pass', () => {
    const clock = createFrameClock();
    const paint = vi.fn();
    clock.loop.on(() => {
      throw new Error('addon bug');
    });
    clock.loop.onPaint(paint);

    clock.tick();

    expect(paint).toHaveBeenCalledTimes(1);
  });

  it('keeps its subscription', () => {
    const clock = createFrameClock();
    const handler = vi.fn(() => {
      throw new Error('addon bug');
    });
    clock.loop.on(handler);

    clock.tick();
    clock.tick();

    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe('the freeze', () => {
  // The difference from `woc.requestAnimationFrame`, and the reason onFrame
  // exists: a one-shot has to be HELD because an addon re-arms inside its own
  // handler, and a dropped link kills the chain. This loop is the loader's, so
  // there is no chain and a frozen tick is simply not delivered.
  it('drops a frozen tick rather than queueing it', () => {
    const clock = createFrameClock();
    const handler = vi.fn();
    clock.loop.on(handler);

    setFrozen(document, true);
    for (let i = 0; i < 10; i += 1) {
      clock.tick();
    }
    setFrozen(document, false);
    clock.tick();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  // Diagnostics stays live under a freeze by the same rule: everything the loader
  // runs for ITSELF keeps running, so an anchor still follows a camera that moves.
  it('keeps the loader own paint pass running', () => {
    const clock = createFrameClock();
    const paint = vi.fn();
    clock.loop.onPaint(paint);

    setFrozen(document, true);
    clock.tick();
    clock.tick();

    expect(paint).toHaveBeenCalledTimes(2);
  });
});
