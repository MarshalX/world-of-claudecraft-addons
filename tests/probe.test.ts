import { describe, expect, it } from 'vitest';

import { GAME_MEMBERS, probeGame } from '../loader/src/runtime/probe.ts';

/** __game as observed on a live pbe client: every member present. */
function liveGame(): Record<string, unknown> {
  const game: Record<string, unknown> = {};
  for (const member of GAME_MEMBERS) {
    game[member] = {};
  }
  return game;
}

describe('probeGame', () => {
  it('reports a full house on the shape the game actually assigns', () => {
    const probe = probeGame(liveGame());

    expect(probe.missing).toEqual([]);
    expect(probe.added).toEqual([]);
    expect(probe.present).toHaveLength(GAME_MEMBERS.length);
    expect(probe.ok).toBe(true);
  });

  // This is the whole point of the probe: pbe runs ahead of live, so a member
  // vanishing there is the first warning that a game update breaks addons.
  it('names the member that went missing', () => {
    const game = liveGame();
    Reflect.deleteProperty(game, 'gamepad');

    const probe = probeGame(game);

    expect(probe.missing).toEqual(['gamepad']);
    expect(probe.present).not.toContain('gamepad');
  });

  it('reports a member the game has grown', () => {
    const probe = probeGame({ ...liveGame(), somethingNew: {} });

    expect(probe.added).toEqual(['somethingNew']);
  });

  // Losing a cosmetic member degrades one surface. Losing `world` means the
  // world API has nothing behind it, which is a different answer.
  it('stays ok when a member the loader does not depend on is gone', () => {
    const game = liveGame();
    Reflect.deleteProperty(game, 'music');

    expect(probeGame(game).ok).toBe(true);
  });

  it('is not ok when world is gone', () => {
    const game = liveGame();
    Reflect.deleteProperty(game, 'world');

    expect(probeGame(game).ok).toBe(false);
  });

  // drainEvents is destructive and main.ts owns the per-frame drain, so the
  // loader reads the socket instead and must not claim to need `online`.
  it('stays ok when online is gone, which the loader deliberately does not use', () => {
    const game = liveGame();
    Reflect.deleteProperty(game, 'online');

    expect(probeGame(game).ok).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'nope'],
    ['an array', []],
  ])('reports everything missing for %s rather than throwing', (_label, candidate) => {
    const probe = probeGame(candidate);

    expect(probe.ok).toBe(false);
    expect(probe.missing).toEqual([...GAME_MEMBERS]);
    expect(probe.present).toEqual([]);
  });

  it('hands back a frozen result', () => {
    expect(Object.isFrozen(probeGame(liveGame()))).toBe(true);
  });

  it('pins the member list the game assigns', () => {
    expect(GAME_MEMBERS).toEqual([
      'sim',
      'world',
      'renderer',
      'input',
      'hud',
      'online',
      'controller',
      'perf',
      'gamepad',
      'music',
      'lockpickEngage',
      'lockpickAction',
      'flushLockpickEvents',
    ]);
  });
});
