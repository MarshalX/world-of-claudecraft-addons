// The live profile includes every default binding; the stored blob holds only what the
// player saved, so it is empty on most accounts. Both paths need their own cases.

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

  // The game appears seconds after document-start, so a captured reference stays null.
  it('resolves the game on every call rather than capturing it', () => {
    let game: unknown = null;
    const bindings = createGameBindings({ game: () => game, storage: () => null });

    expect(bindings.conflicts('KeyW').source).toBe('none');
    game = liveGame({ held: [['KeyW', 'moveForward']] });
    expect(bindings.conflicts('KeyW').source).toBe('live');
  });

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

  // The fallback cannot tell which character is loaded, so it over-reports.
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

// The matchers read `this.map`, so they must be called bound, and the manager reads
// conflicts during render, so a throw from them must never reach the caller.
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

  // An empty 'live' reading would call the key free when it was never checked.
  it('falls back to stored bindings when a matcher throws', () => {
    const bindings = createGameBindings({
      game: hostileGame,
      storage: () => fakeStorage([['woc_keybinds', { openBags: ['KeyB', null] }]]),
    });

    expect(bindings.conflicts('KeyB')).toEqual({ actions: ['openBags'], source: 'stored' });
  });
});
