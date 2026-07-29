// Reading the player's existing game bindings, to warn before an addon takes a
// key the game is using.
//
// The two sources are not equally good and the difference is the point of the
// module. The LIVE profile on __game.input.keybinds is the game's own matcher
// and includes every DEFAULT binding. The STORED blob holds only what the player
// explicitly saved, so on an account that never opened Key Bindings it is empty
// and every key reads as free. A test that only exercised the stored path would
// pass while conflict detection reported WASD as unbound on most accounts.

import { describe, expect, it } from 'vitest';
import { createGameBindings } from '../loader/src/runtime/keys/game-bindings.ts';
import { liveGame } from './fakes/game-keybinds.ts';

/** A stand-in for localStorage carrying the game's keybind blobs. */
function fakeStorage(entries: ReadonlyArray<readonly [string, unknown]>) {
  const blobs = new Map(entries);
  const keys = [...blobs.keys()];
  return {
    length: keys.length,
    key: (index: number) => keys[index] ?? null,
    getItem: (key: string) => {
      if (!blobs.has(key)) {
        return null;
      }
      return JSON.stringify(blobs.get(key));
    },
  };
}

describe('the live profile', () => {
  it('asks the game and reports what it answered', () => {
    const bindings = createGameBindings({
      game: () => liveGame({ held: [['KeyW', 'moveForward']] }),
      storage: () => null,
    });

    expect(bindings.conflicts('KeyW')).toEqual({ actions: ['moveForward'], source: 'live' });
  });

  // The reason the live matcher is preferred over reimplementing the rule: it
  // already knows that a held action ignores modifiers.
  it('reports a held action against a modified combo', () => {
    const bindings = createGameBindings({
      game: () => liveGame({ held: [['KeyW', 'moveForward']] }),
      storage: () => null,
    });

    expect(bindings.conflicts('Alt+KeyW').actions).toEqual(['moveForward']);
  });

  it('reports an edge action only on its exact chord', () => {
    const bindings = createGameBindings({
      game: () => liveGame({ edge: [['Shift+Digit1', 'actionBar13']] }),
      storage: () => null,
    });

    expect(bindings.conflicts('Shift+Digit1').actions).toEqual(['actionBar13']);
    expect(bindings.conflicts('Digit1').actions).toEqual([]);
  });

  it('reports a free key as free', () => {
    const bindings = createGameBindings({
      game: () => liveGame({ held: [['KeyW', 'moveForward']] }),
      storage: () => null,
    });

    expect(bindings.conflicts('Alt+KeyJ')).toEqual({ actions: [], source: 'live' });
  });

  it('does not report the same action twice when both matchers answer it', () => {
    const bindings = createGameBindings({
      game: () => liveGame({ held: [['KeyW', 'moveForward']], edge: [['KeyW', 'moveForward']] }),
      storage: () => null,
    });

    expect(bindings.conflicts('KeyW').actions).toEqual(['moveForward']);
  });

  // The loader boots at document-start and the game does not exist for many
  // seconds, so a reference taken once would be null for the whole session.
  it('resolves the game on every call rather than capturing it', () => {
    let game: unknown = null;
    const bindings = createGameBindings({ game: () => game, storage: () => null });

    expect(bindings.conflicts('KeyW').source).toBe('none');
    game = liveGame({ held: [['KeyW', 'moveForward']] });
    expect(bindings.conflicts('KeyW').source).toBe('live');
  });

  // Feature-detected rather than assumed: a game refactor must cost the live
  // path and fall back, not throw at an addon.
  it.each([
    ['no game at all', null],
    ['a game with no input', {}],
    ['an input with no keybinds', { input: {} }],
    ['keybinds without the matchers', { input: { keybinds: {} } }],
    ['matchers that are not functions', { input: { keybinds: { heldActionForCode: 1 } } }],
  ])('falls back when the game gives %s', (_case, game) => {
    const bindings = createGameBindings({ game: () => game, storage: () => null });

    expect(bindings.conflicts('KeyW').source).not.toBe('live');
  });
});

describe('the stored fallback', () => {
  it('reads the bare legacy blob', () => {
    const bindings = createGameBindings({
      game: () => null,
      storage: () => fakeStorage([['woc_keybinds', { moveForward: ['KeyW', null] }]]),
    });

    expect(bindings.conflicts('KeyW')).toEqual({ actions: ['moveForward'], source: 'stored' });
  });

  it('reads a per-character scoped blob', () => {
    const bindings = createGameBindings({
      game: () => null,
      storage: () => fakeStorage([['woc_keybinds:char:661', { openBags: ['KeyB', null] }]]),
    });

    expect(bindings.conflicts('KeyB').actions).toEqual(['openBags']);
  });

  it('reads both slots of an action', () => {
    const bindings = createGameBindings({
      game: () => null,
      storage: () => fakeStorage([['woc_keybinds', { openBags: ['KeyB', 'Alt+KeyB'] }]]),
    });

    expect(bindings.conflicts('Alt+KeyB').actions).toEqual(['openBags']);
  });

  // The fallback runs precisely when there is no reliable way to tell which
  // character is loaded, so it over-reports rather than missing the active one.
  it('unions every scope it finds', () => {
    const bindings = createGameBindings({
      game: () => null,
      storage: () =>
        fakeStorage([
          ['woc_keybinds:char:1', { openBags: ['KeyB', null] }],
          ['woc_keybinds:char:2', { screenshot: ['KeyB', null] }],
        ]),
    });

    expect([...bindings.conflicts('KeyB').actions].sort((a, b) => a.localeCompare(b))).toEqual([
      'openBags',
      'screenshot',
    ]);
  });

  it('names an action once even when both its slots match', () => {
    const bindings = createGameBindings({
      game: () => null,
      storage: () => fakeStorage([['woc_keybinds', { openBags: ['KeyB', 'KeyB'] }]]),
    });

    expect(bindings.conflicts('KeyB').actions).toEqual(['openBags']);
  });

  it("ignores localStorage keys that are not the game's bindings", () => {
    const bindings = createGameBindings({
      game: () => null,
      storage: () =>
        fakeStorage([
          ['woc_settings', { sfxVolume: 0.8 }],
          ['other', { openBags: ['KeyB'] }],
        ]),
    });

    expect(bindings.conflicts('KeyB').actions).toEqual([]);
  });

  it.each<[string, unknown]>([
    ['a corrupt blob', undefined],
    ['a blob that is not a record', 'nope'],
    ['an action whose value is not an array', { openBags: 'KeyB' }],
  ])('survives %s', (_case, blob) => {
    const bindings = createGameBindings({
      game: () => null,
      storage: () => fakeStorage([['woc_keybinds', blob]]),
    });

    expect(() => bindings.conflicts('KeyB')).not.toThrow();
  });
});

describe('with neither source', () => {
  it('reports nothing and says so', () => {
    const bindings = createGameBindings({ game: () => null, storage: () => null });

    expect(bindings.conflicts('KeyW')).toEqual({ actions: [], source: 'none' });
  });

  it('reports nothing for a malformed combo', () => {
    const bindings = createGameBindings({
      game: () => liveGame({ held: [['KeyW', 'moveForward']] }),
      storage: () => null,
    });

    expect(bindings.conflicts('Hyper+KeyW')).toEqual({ actions: [], source: 'none' });
  });
});

// A live session found this one. The matchers are methods on the game's own
// class and their bodies read `this.map`, so calling one off the instance throws
// on an undefined `this`. The manager reads conflicts DURING RENDER, so that
// throw unmounted the settings pane and left the player a blank window.
//
// Two things have to hold. The matchers must be called bound, and a throw from
// them must cost the live reading rather than reaching the caller: this is an
// undeclared debug hook, so something callable that throws when called is a
// shape a game update can legitimately produce.
describe('the game profile as a real object', () => {
  /** A profile whose matchers throw, standing in for a game that changed shape. */
  function hostileGame(): unknown {
    return {
      input: {
        keybinds: {
          heldActionForCode: () => {
            throw new TypeError('Cannot read properties of undefined (reading "map")');
          },
          edgeActionForCombo: () => null,
        },
      },
    };
  }

  it('calls the matchers bound to the profile', () => {
    const bindings = createGameBindings({
      game: () => liveGame({ held: [['KeyW', 'moveForward']] }),
      storage: () => null,
    });

    expect(() => bindings.conflicts('Alt+KeyW')).not.toThrow();
    expect(bindings.conflicts('Alt+KeyW')).toEqual({ actions: ['moveForward'], source: 'live' });
  });

  it('does not let a throwing matcher reach the caller', () => {
    const bindings = createGameBindings({ game: hostileGame, storage: () => null });

    expect(() => bindings.conflicts('KeyW')).not.toThrow();
  });

  // Falling back rather than reporting 'live' with nothing found: an empty live
  // reading would tell the player the key is free when it was never checked.
  it('falls back to stored bindings when a matcher throws', () => {
    const bindings = createGameBindings({
      game: hostileGame,
      storage: () => fakeStorage([['woc_keybinds', { openBags: ['KeyB', null] }]]),
    });

    expect(bindings.conflicts('KeyB')).toEqual({ actions: ['openBags'], source: 'stored' });
  });
});
