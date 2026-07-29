// Cue playback.
//
// Driven against a fake sink rather than a real AudioContext, which is what lets
// the decisions a player actually notices be asserted in Node: a cue resolves to
// the URL the pack names, the slider is respected, a family cue picks a variant,
// and a cue is not machine-gunned by a 20 Hz handler. What surrounds a cue
// (arming on a gesture, warming, teardown) is in sound-engine-lifecycle.

import { describe, expect, it, vi } from 'vitest';
import { createSoundEngine, DEFAULT_COOLDOWN_MS } from '../loader/src/runtime/sound/engine.ts';
import { PACK, type Started, soundHarness } from './fakes/sound-harness.ts';

describe('the cue list', () => {
  it('is empty until the pack has loaded', () => {
    expect(soundHarness().engine.cues()).toEqual([]);
  });

  it('is every cue the pack ships, sorted', async () => {
    const { engine } = soundHarness();
    await engine.ready();

    expect(engine.cues()).toEqual(['combat_block', 'ui_click']);
  });

  it('stays empty when the pack cannot be fetched', async () => {
    const { engine } = soundHarness({ packFails: true });
    await engine.ready();

    expect(engine.cues()).toEqual([]);
  });

  it('stays empty when the pack is not one', async () => {
    const { engine } = soundHarness({ pack: { format: 'something-else' } });
    await engine.ready();

    expect(engine.cues()).toEqual([]);
  });
});

describe('playing', () => {
  it('fetches the cue URL from the pack and starts it', async () => {
    const { engine, started, fetched } = soundHarness();
    await engine.ready();

    engine.play('ui_click');
    await vi.waitFor(() => expect(started).toHaveLength(1));

    expect(fetched).toEqual(['/audio/sfx/ui_click.mp3?v=aabb']);
  });

  // The whole advantage of the pack over a directory listing.
  it('multiplies the pack gain, the player slider, and the addon volume', async () => {
    const { engine, started } = soundHarness({ volume: 0.5 });
    await engine.ready();

    engine.play('ui_click', { volume: 0.5 });
    await vi.waitFor(() => expect(started).toHaveLength(1));

    expect(started[0]?.gain).toBeCloseTo(2 * 0.5 * 0.5);
  });

  it('clamps an addon volume outside 0 to 1', async () => {
    const { engine, started } = soundHarness();
    await engine.ready();

    engine.play('ui_click', { volume: 9 });
    await vi.waitFor(() => expect(started).toHaveLength(1));

    expect(started[0]?.gain).toBeCloseTo(2);
  });

  it('plays the variant the picker chose', async () => {
    const { engine, fetched, chooseVariant } = soundHarness();
    await engine.ready();

    chooseVariant(2);
    engine.play('combat_block');
    await vi.waitFor(() => expect(fetched).toHaveLength(1));

    expect(fetched[0]).toBe('/audio/sfx/combat_block_3.mp3');
  });

  it('falls back to the first variant when the picker answers nonsense', async () => {
    const { engine, fetched, chooseVariant } = soundHarness();
    await engine.ready();

    chooseVariant(99);
    engine.play('combat_block');
    await vi.waitFor(() => expect(fetched).toHaveLength(1));

    expect(fetched[0]).toBe('/audio/sfx/combat_block_1.mp3');
  });

  // Degraded and honestly so: it loses the gain and the hash, and only resolves
  // for a cue whose name is its own file.
  it('falls back to a plain URL for a cue the pack does not list', async () => {
    const { engine, fetched } = soundHarness();
    await engine.ready();

    engine.play('not_in_the_pack');
    await vi.waitFor(() => expect(fetched).toHaveLength(1));

    expect(fetched[0]).toBe('/audio/sfx/not_in_the_pack.mp3');
  });

  it('decodes each URL once and shares the buffer', async () => {
    const { engine, fetched, started, advance } = soundHarness();
    await engine.ready();

    engine.play('ui_click');
    await vi.waitFor(() => expect(started).toHaveLength(1));
    advance(DEFAULT_COOLDOWN_MS);
    engine.play('ui_click');
    await vi.waitFor(() => expect(started).toHaveLength(2));

    expect(fetched).toHaveLength(1);
  });

  it('retries after a failed fetch rather than poisoning the cue', async () => {
    const started: Started[] = [];
    let attempt = 0;
    const engine = createSoundEngine({
      sink: {
        running: () => true,
        resume: () => Promise.resolve(),
        decode: () => Promise.resolve({}),
        start: (buffer, gain, rate) => {
          started.push({ buffer, gain, rate });
        },
        close: () => undefined,
      },
      fetchJson: () => Promise.resolve(PACK),
      fetchBytes: () => {
        attempt += 1;
        if (attempt === 1) {
          return Promise.reject(new Error('network'));
        }
        return Promise.resolve(new ArrayBuffer(8));
      },
      volume: () => 1,
      now: () => attempt * 1000,
      pick: () => 0,
    });
    await engine.ready();

    engine.play('ui_click');
    // Flushed rather than polled: the failing fetch drops its own cache entry
    // from a .catch, and a waitFor on `attempt` alone would retry while the
    // rejected promise is still the cached one.
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(attempt).toBe(1);

    engine.play('ui_click');
    await vi.waitFor(() => expect(started).toHaveLength(1));
  });
});

describe('the cooldown', () => {
  // net.on('snap') fires 20 times a second and playing a cue from one is the
  // obvious thing to write. Without a floor that is 20 overlapping copies.
  it('drops a repeat inside the default window', async () => {
    const { engine, started, advance } = soundHarness();
    await engine.ready();

    engine.play('ui_click');
    await vi.waitFor(() => expect(started).toHaveLength(1));
    advance(DEFAULT_COOLDOWN_MS - 1);
    engine.play('ui_click');
    await Promise.resolve();

    expect(started).toHaveLength(1);
  });

  it('allows the repeat once the window has passed', async () => {
    const { engine, started, advance } = soundHarness();
    await engine.ready();

    engine.play('ui_click');
    await vi.waitFor(() => expect(started).toHaveLength(1));
    advance(DEFAULT_COOLDOWN_MS);
    engine.play('ui_click');

    await vi.waitFor(() => expect(started).toHaveLength(2));
  });

  it('is per cue, so one cue does not silence another', async () => {
    const { engine, started } = soundHarness();
    await engine.ready();

    engine.play('ui_click');
    engine.play('combat_block');

    await vi.waitFor(() => expect(started).toHaveLength(2));
  });

  it('honours an addon that asks for a shorter one', async () => {
    const { engine, started, advance } = soundHarness();
    await engine.ready();

    engine.play('ui_click', { cooldown: 10 });
    await vi.waitFor(() => expect(started).toHaveLength(1));
    advance(10);
    engine.play('ui_click', { cooldown: 10 });

    await vi.waitFor(() => expect(started).toHaveLength(2));
  });
});
