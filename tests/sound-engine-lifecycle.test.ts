// What surrounds a cue: the gesture gate, warming, and teardown.
//
// Driven against the same fake sink the playback suite uses, because these are
// engine state rather than pure functions. Each one is a failure a player hears
// rather than reads: a browser that refuses audio until the first click, a cue
// that has to fetch before it can be heard, and an addon whose sounds keep
// playing after it was disabled.

import { describe, expect, it, vi } from 'vitest';
import { createSoundEngine } from '../loader/src/runtime/sound/engine.ts';
import { PACK, soundHarness } from './fakes/sound-harness.ts';

describe('the user-gesture requirement', () => {
  // A suspended context does not discard what was started on it, so queueing
  // means every dropped cue fires at once the moment the player finally clicks.
  it('drops a cue requested before any gesture rather than queueing it', async () => {
    const { engine, started, sink } = soundHarness({ running: false });
    await engine.ready();

    engine.play('ui_click');
    await Promise.resolve();

    expect(started).toHaveLength(0);
    expect(sink.running()).toBe(true);
  });

  it('resumes on the first pointerdown and stops listening after it', () => {
    const target = new EventTarget();
    const { engine, sink } = soundHarness({ running: false });
    const resume = vi.spyOn(sink, 'resume');

    engine.arm(target);
    target.dispatchEvent(new Event('pointerdown'));
    target.dispatchEvent(new Event('pointerdown'));

    expect(resume).toHaveBeenCalledOnce();
  });

  it('also resumes on a key press, for a keyboard-only player', () => {
    const target = new EventTarget();
    const { engine, sink } = soundHarness({ running: false });
    const resume = vi.spyOn(sink, 'resume');

    engine.arm(target);
    target.dispatchEvent(new Event('keydown'));

    expect(resume).toHaveBeenCalledOnce();
  });

  it('stops listening when the returned teardown runs', () => {
    const target = new EventTarget();
    const { engine, sink } = soundHarness({ running: false });
    const resume = vi.spyOn(sink, 'resume');

    engine.arm(target)();
    target.dispatchEvent(new Event('pointerdown'));

    expect(resume).not.toHaveBeenCalled();
  });
});

describe('preload', () => {
  it('warms every cue given', async () => {
    const { engine, fetched } = soundHarness();

    await engine.preload(['ui_click', 'combat_block']);

    expect(fetched).toHaveLength(2);
  });

  it('does not fail the whole list for one unreachable cue', async () => {
    const engine = createSoundEngine({
      sink: {
        running: () => true,
        resume: () => Promise.resolve(),
        decode: () => Promise.resolve({}),
        start: () => undefined,
        close: () => undefined,
      },
      fetchJson: () => Promise.resolve(PACK),
      fetchBytes: (url) => {
        if (url.includes('combat_block')) {
          return Promise.reject(new Error('404'));
        }
        return Promise.resolve(new ArrayBuffer(8));
      },
      volume: () => 1,
      now: () => 0,
      pick: () => 0,
    });

    await expect(engine.preload(['ui_click', 'combat_block'])).resolves.toBeUndefined();
  });
});

describe('dispose', () => {
  it('closes the sink and stops starting new cues', async () => {
    const { engine, started, sink } = soundHarness();
    await engine.ready();

    engine.dispose();
    engine.play('ui_click');
    await Promise.resolve();

    expect(sink.closed).toBe(true);
    expect(started).toHaveLength(0);
  });
});
