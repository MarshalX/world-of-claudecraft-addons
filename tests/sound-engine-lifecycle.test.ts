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

// When the 119 kB pack is read, which used to be "whenever the engine was built"
// and therefore on every page load, for every player, whether or not a single
// installed addon ever made a sound. It is the game's own audio manifest and it is
// fetched alongside the game's own boot assets, so a player who never hears a cue
// was still waiting behind it.
//
// The cost of moving it is that a `play` arriving before the read lands falls back
// to a guessed URL, which for a family cue is not a file that exists. That is why
// `warm` is on the engine and why the addon API calls it from a manifest that
// declares sound: an addon starts long before it plays anything.
describe('reading the pack', () => {
  it('does not read it just because the engine was built', () => {
    expect(soundHarness().packReads()).toBe(0);
  });

  it('reads it when a cue is played', () => {
    const h = soundHarness();

    h.engine.play('ui_click');

    expect(h.packReads()).toBe(1);
  });

  it('reads it when warmed, without playing anything', () => {
    const h = soundHarness();

    h.engine.warm();

    expect(h.packReads()).toBe(1);
    expect(h.started).toEqual([]);
  });

  it('reads it when an addon asks what cues exist', () => {
    const h = soundHarness();

    h.engine.cues();

    expect(h.packReads()).toBe(1);
  });

  // One read per session however many callers ask for it, which is the whole point
  // of it being memoised rather than merely deferred.
  it('reads it once however many times it is asked for', async () => {
    const h = soundHarness();

    h.engine.warm();
    h.engine.play('ui_click');
    h.engine.cues();
    await h.engine.ready();
    await h.engine.preload(['combat_block']);

    expect(h.packReads()).toBe(1);
  });

  // Warming is what keeps the first cue off the fallback path: by the time a cue is
  // played the pack has landed, so it resolves to the URL the pack NAMES, cache
  // buster and all. That query string is the tell, since nothing could guess it.
  it('plays a warmed cue from the pack rather than from a guessed URL', async () => {
    const h = soundHarness();

    h.engine.warm();
    await h.engine.ready();
    h.engine.play('ui_click');

    expect(h.fetched).toEqual(['/audio/sfx/ui_click.mp3?v=aabb']);
  });

  // The other half of the same fact, and the reason `warm` exists rather than the
  // read simply being left to the first `play`. A cue played while the read is still
  // in flight takes a guessed URL, which for a family cue is not a file that exists.
  it('falls back to a guessed URL for a cue played before the read lands', () => {
    const h = soundHarness();

    h.engine.play('ui_click');

    expect(h.fetched).toEqual(['/audio/sfx/ui_click.mp3']);
  });
});
