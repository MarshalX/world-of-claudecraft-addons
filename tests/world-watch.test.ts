import { describe, expect, it, vi } from 'vitest';

import { setAt } from './fakes/frames.ts';
import { watchHarness } from './fakes/watch-harness.ts';

const harness = watchHarness;

describe('createWorldWatcher', () => {
  it('reports a change with the new value', () => {
    const h = harness();
    const seen = vi.fn();
    h.watcher.on('player', seen);

    setAt(h.live.player, 'hp', 900);
    h.watcher.poll();

    expect(seen).toHaveBeenCalledExactlyOnceWith(h.live.player);
  });

  // Firing once on subscribe just because nothing had been recorded yet would
  // make every addon's first frame a lie.
  it('does not fire on the first sample when nothing moved', () => {
    const h = harness();
    const seen = vi.fn();
    h.watcher.on('player', seen);

    h.watcher.poll();

    expect(seen).not.toHaveBeenCalled();
  });

  it('fires once per change rather than once per sample', () => {
    const h = harness();
    const seen = vi.fn();
    h.watcher.on('player', seen);

    setAt(h.live.player, 'hp', 900);
    h.watcher.poll();
    h.watcher.poll();
    h.watcher.poll();

    expect(seen).toHaveBeenCalledOnce();
  });

  it('keeps reporting as the value keeps moving', () => {
    const h = harness();
    const seen = vi.fn();
    h.watcher.on('player', seen);

    for (const hp of [900, 800, 700]) {
      setAt(h.live.player, 'hp', hp);
      h.watcher.poll();
    }

    expect(seen).toHaveBeenCalledTimes(3);
  });

  it('reports the same change to every listener on the key', () => {
    const h = harness();
    const a = vi.fn();
    const b = vi.fn();
    h.watcher.on('player', a);
    h.watcher.on('player', b);

    setAt(h.live.player, 'hp', 900);
    h.watcher.poll();

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('does not wake a key that did not change', () => {
    const h = harness();
    const entities = vi.fn();
    h.watcher.on('player', vi.fn());
    h.watcher.on('entities', entities);

    setAt(h.live.player, 'hp', 900);
    h.watcher.poll();

    expect(entities).not.toHaveBeenCalled();
  });

  it('watches entities entering and leaving', () => {
    const h = harness();
    const seen = vi.fn();
    h.watcher.on('entities', seen);

    h.live.entities.set(1, { id: 1 });
    h.watcher.poll();
    h.live.entities.delete(1);
    h.watcher.poll();

    expect(seen).toHaveBeenCalledTimes(2);
  });

  describe('unsubscribe', () => {
    it('stops delivering to that listener only', () => {
      const h = harness();
      const gone = vi.fn();
      const stays = vi.fn();
      h.watcher.on('player', gone)();
      h.watcher.on('player', stays);

      setAt(h.live.player, 'hp', 900);
      h.watcher.poll();

      expect(gone).not.toHaveBeenCalled();
      expect(stays).toHaveBeenCalledOnce();
    });

    // Re-subscribing must not replay a change that happened while nobody was
    // watching, or an addon toggled off and on sees stale history.
    it('reseeds the baseline on a fresh subscribe', () => {
      const h = harness();
      h.watcher.on('player', vi.fn())();
      setAt(h.live.player, 'hp', 900);

      const seen = vi.fn();
      h.watcher.on('player', seen);
      h.watcher.poll();

      expect(seen).not.toHaveBeenCalled();
    });

    it('is safe to call twice', () => {
      const h = harness();
      const off = h.watcher.on('player', vi.fn());
      off();

      expect(() => off()).not.toThrow();
    });
  });

  describe('a throwing listener', () => {
    it('does not stop the next one on the same key', () => {
      const h = harness();
      const after = vi.fn();
      h.watcher.on('player', () => {
        throw new Error('addon bug');
      });
      h.watcher.on('player', after);

      setAt(h.live.player, 'hp', 900);
      h.watcher.poll();

      expect(after).toHaveBeenCalledOnce();
      expect(h.errors).toHaveLength(1);
    });

    it('does not stop the sampler', () => {
      const h = harness();
      h.watcher.on('player', () => {
        throw new Error('addon bug');
      });

      setAt(h.live.player, 'hp', 900);
      h.frame();

      expect(h.frames()).toBe(1);
    });
  });

  // The watcher is built at boot, before the game exists, so every read has to
  // answer null until it does.
  describe('before the game exists', () => {
    it('samples a detached backend without throwing, and stays quiet', () => {
      const h = harness();
      h.setAttached(false);
      const seen = vi.fn();
      h.watcher.on('player', seen);

      expect(() => h.watcher.poll()).not.toThrow();
      expect(seen).not.toHaveBeenCalled();
    });

    // An addon can hold woc.world and subscribe from its first line, before the
    // player has even entered the world. World entry is the change it waits for.
    it('reports world entry to a listener that subscribed before it', () => {
      const h = harness();
      h.setAttached(false);
      const seen = vi.fn();
      h.watcher.on('player', seen);
      h.watcher.poll();

      h.setAttached(true);
      h.watcher.poll();

      expect(seen).toHaveBeenCalledExactlyOnceWith(h.live.player);
    });
  });

  describe('dispose', () => {
    it('stops the sampler and every listener', () => {
      const h = harness();
      const seen = vi.fn();
      h.watcher.on('player', seen);

      h.watcher.dispose();
      setAt(h.live.player, 'hp', 900);
      h.watcher.poll();

      expect(h.frames()).toBe(0);
      expect(seen).not.toHaveBeenCalled();
    });
  });
});

// The end of the path a boss mod actually takes, kept as its own block because it
// is a different claim from the sampler's: a mob's cast emits no event at all, so
// the sampler noticing a cast field move on an entity ALREADY in the roster is the
// only thing in the loader that can wake an addon for one.
describe('watching casts', () => {
  it('wakes a subscriber when a mob starts casting, with no roster change', () => {
    const h = harness();
    const mob: Record<string, unknown> = { id: 248, castingAbility: null };
    h.live.entities.set(248, mob);
    const seen = vi.fn();
    h.watcher.on('casts', seen);

    setAt(mob, 'castingAbility', 'deathless_rage');
    h.watcher.poll();

    const reported = seen.mock.calls[0] as [Map<number, unknown>];

    expect(seen).toHaveBeenCalledOnce();
    expect(reported[0].get(248)).toMatchObject({ ability: 'deathless_rage' });
  });

  it('does not wake it again while that cast bar fills', () => {
    const h = harness();
    const mob: Record<string, unknown> = { id: 248, castingAbility: 'soul_rend', castRemaining: 3 };
    h.live.entities.set(248, mob);
    const seen = vi.fn();
    h.watcher.on('casts', seen);

    setAt(mob, 'castRemaining', 0.4);
    h.watcher.poll();

    expect(seen).not.toHaveBeenCalled();
  });
});
