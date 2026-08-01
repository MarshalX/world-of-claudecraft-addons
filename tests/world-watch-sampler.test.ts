import { describe, expect, it, vi } from 'vitest';

import { SAMPLE_INTERVAL_MS } from '../loader/src/runtime/world/watch.ts';
import { watchHarness } from './fakes/watch-harness.ts';

const harness = watchHarness;

// The animation-frame loop that drives the watcher.
describe('the sampler', () => {
  // An addon that never calls world.on must cost nothing at all.
  it('does not run before anything subscribes', () => {
    expect(harness().frames()).toBe(0);
  });

  it('starts on the first subscribe', () => {
    const h = harness();
    h.watcher.on('player', vi.fn());

    expect(h.frames()).toBe(1);
  });

  it('keeps rescheduling itself while a listener remains', () => {
    const h = harness();
    h.watcher.on('player', vi.fn());

    h.frame();
    expect(h.frames()).toBe(1);

    h.frame();
    expect(h.frames()).toBe(1);
  });

  it('stops once the last listener goes', () => {
    const h = harness();
    const off = h.watcher.on('player', vi.fn());

    off();

    expect(h.frames()).toBe(0);
  });

  it('keeps running while another key is still watched', () => {
    const h = harness();
    const off = h.watcher.on('player', vi.fn());
    h.watcher.on('entities', vi.fn());

    off();

    expect(h.frames()).toBe(1);
  });

  it('does not start a second sampler for a second subscriber', () => {
    const h = harness();
    h.watcher.on('player', vi.fn());
    h.watcher.on('entities', vi.fn());

    expect(h.frames()).toBe(1);
  });

  it('delivers through the scheduled frame, not only through poll', () => {
    const h = harness();
    const seen = vi.fn();
    h.watcher.on('player', vi.fn());
    h.watcher.on('entities', seen);

    h.live.entities.set(1, {});
    h.frame();

    expect(seen).toHaveBeenCalledOnce();
  });
});

// An animation frame is not what makes a value move: the server sends 20 snapshots a
// second and this loop runs at 60 or more, so most frames were sampling to find
// nothing. A sample is not free either, since `entities` allocates a Set of every id
// and `casts` rebuilds a Map over every entity in scope.
//
// What the floor must NOT do is lose a change, which is why it sits under the
// snapshot interval rather than on it.
describe('the sample floor', () => {
  it('does not sample again on a frame that came too soon after the last', () => {
    const h = harness();
    const seen = vi.fn();
    h.watcher.on('entities', seen);

    // The first frame samples and takes the baseline, then a change lands and the
    // very next frame is inside the floor.
    h.frame();
    h.live.entities.set(1, {});
    h.frame();

    expect(seen).not.toHaveBeenCalled();
  });

  it('samples on the first frame past the floor, so nothing is lost', () => {
    const h = harness();
    const seen = vi.fn();
    h.watcher.on('entities', seen);

    h.frame();
    h.live.entities.set(1, {});
    h.frame();
    h.frame();

    expect(seen).toHaveBeenCalledOnce();
  });

  // A caller reaching for `poll` has already decided it wants a sample, and the
  // suites that drive the watcher by hand depend on getting one.
  it('does not apply to an explicit poll', () => {
    const h = harness();
    const seen = vi.fn();
    h.watcher.on('entities', seen);

    h.live.entities.set(1, {});
    h.watcher.poll();
    h.live.entities.set(2, {});
    h.watcher.poll();

    expect(seen).toHaveBeenCalledTimes(2);
  });
});

// The floor against a real display, which is arithmetic rather than something the
// frame clock above can demonstrate: a harness runs at whatever rate it is told to.
//
// The sampler cannot sample AT the floor, because it only gets to decide on an
// animation frame. The period it actually achieves is the floor rounded up to the
// next whole frame, and what has to hold is that the result stays under the interval
// the server sends on. Otherwise a value could move and move back between two
// samples and the addon watching it would never be told.
//
// A faster monitor is the BETTER case and this is where that is written down, because
// it is the opposite of the intuition that a higher frame rate means more risk: the
// rounding is finer the shorter the frame is, so 120 Hz lands on the floor exactly
// and reports sooner than 60 Hz. The rates that round up hardest are the ones just
// under a multiple of the floor.
describe('the floor against a real refresh rate', () => {
  /** The sim's own rate. A snapshot every 50 ms is what a sample must not miss. */
  const SimIntervalMs = 50;

  /** What the loop achieves: the floor rounded up to a whole frame. */
  function periodAt(hz: number): number {
    const frame = 1000 / hz;
    return Math.ceil(SAMPLE_INTERVAL_MS / frame) * frame;
  }

  it.each([30, 50, 60, 75, 90, 120, 144, 165, 240])(
    'reports a change inside one snapshot at %i Hz',
    (hz) => {
      expect(periodAt(hz)).toBeLessThan(SimIntervalMs);
    },
  );

  it('reports sooner on a faster display rather than later', () => {
    expect(periodAt(120)).toBeLessThanOrEqual(periodAt(60));
  });

  // However fast the display runs, the floor is what decides the rate: this is the
  // half that stops a 240 Hz monitor from sampling 240 times a second.
  it('holds the rate near the floor however fast the display runs', () => {
    expect(periodAt(240)).toBeGreaterThanOrEqual(SAMPLE_INTERVAL_MS);
  });
});
