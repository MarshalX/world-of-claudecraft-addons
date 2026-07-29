import { describe, expect, it, vi } from 'vitest';

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
