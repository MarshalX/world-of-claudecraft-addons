import { describe, expect, it, vi } from 'vitest';

import { SAMPLE_INTERVAL_MS } from '../loader/src/runtime/world/watch.ts';
import { watchHarness } from './fakes/watch-harness.ts';

const harness = watchHarness;

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

// Snapshots arrive at 20 Hz and a sample allocates, so frames between them are skipped. The floor
// sits under the snapshot interval so no change is lost.
describe('the sample floor', () => {
  it('does not sample again on a frame that came too soon after the last', () => {
    const h = harness();
    const seen = vi.fn();
    h.watcher.on('entities', seen);

    // The first frame takes the baseline; the next is inside the floor.
    h.frame();
    h.live.entities.set(1, {});
    h.frame();

    expect(seen).not.toHaveBeenCalled();
  });

  it('samples on the first frame past the floor', () => {
    const h = harness();
    const seen = vi.fn();
    h.watcher.on('entities', seen);

    h.frame();
    h.live.entities.set(1, {});
    h.frame();
    h.frame();

    expect(seen).toHaveBeenCalledOnce();
  });

  // Suites that drive the watcher by hand depend on `poll` always sampling.
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

// The achieved period is the floor rounded up to a whole frame, and it must stay under the
// snapshot interval or a value can move and move back unseen. Faster displays round more finely.
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

  it('reports sooner on a faster display', () => {
    expect(periodAt(120)).toBeLessThanOrEqual(periodAt(60));
  });

  it('holds the rate near the floor however fast the display runs', () => {
    expect(periodAt(240)).toBeGreaterThanOrEqual(SAMPLE_INTERVAL_MS);
  });
});
