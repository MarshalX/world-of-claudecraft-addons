// The competitive bout reading and its two watch keys.
//
// The case that carries this file is that `arenaInfo` IS PRESENT FOR EVERY
// CHARACTER, queued or not. Only its `match` member says a bout is on, so a
// reader that answered whenever the key existed would tell the whole realm it is
// fighting. That is the same shape as the `inCombat` trap and it is the first
// assertion here.
//
// The second is the ten second cadence. Everything but a duel arrives at 0.1 Hz,
// so the signatures deliberately ignore the figures whose live path is the event
// queue: a subscription firing ten seconds after a cat took damage is worse than
// one that never fires, because an addon reads the notification as the moment.

import { describe, expect, it } from 'vitest';
import { type ArenaStandings, readArena } from '../loader/src/runtime/world/arena.ts';
import { type RankedMatch, readMatch } from '../loader/src/runtime/world/match.ts';
import type { FiestaMatch, YumiMatch } from '../loader/src/runtime/world/match-modes.ts';
import { arenaSignature, matchSignature } from '../loader/src/runtime/world/signature-match.ts';

const ME = 11;
const THEM = 22;

function combatants(pid: number) {
  return [{ pid, name: `p${pid}`, cls: 'hunter', level: 20 }];
}

/** A Fiesta record as `fiestaMatchInfo` builds it, with the wire's own `cx`/`cz` ring. */
function fiestaWire(over: Record<string, unknown> = {}) {
  return {
    team: 'A',
    scoreA: 4,
    scoreB: 2,
    myScore: 4,
    theirScore: 2,
    scoreLimit: 10,
    wave: 2,
    totalWaves: 3,
    ring: { cx: 120, cz: -40, radius: 33.5 },
    down: false,
    respawnIn: 0,
    augments: ['swift_boots'],
    offer: { tier: 'gold', wave: 2, choices: ['a', 'b'] },
    augmentPending: 0,
    teamA: [{ pid: ME, name: 'Mine', cls: 'hunter', kills: 3, down: false, me: true }],
    teamB: [{ pid: THEM, name: 'Theirs', cls: 'mage', kills: 1, down: true, me: false }],
    powerups: [
      { id: 7, defId: 'haste', x: 1, z: 2, state: 'spawning', frac: 0.25, color: 0xff_00_ff },
    ],
    ...over,
  };
}

/** A Protect Yumi record as `yumiMatchInfo` builds it. */
function yumiWire(over: Record<string, unknown> = {}) {
  return {
    team: 'A',
    size: 3,
    phase: 'active',
    matchElapsed: 65,
    teleportIn: 12,
    suddenDeathIn: 40,
    damageTakenMult: 1,
    down: false,
    respawnIn: 0,
    yumiA: { entityId: 900, hp: 4000, maxHp: 5000, x: 10, z: 20, alive: true },
    yumiB: { entityId: 901, hp: 5000, maxHp: 5000, x: -10, z: -20, alive: true },
    teamA: [{ pid: ME, name: 'Mine', cls: 'hunter', kills: 1, deaths: 0, down: false }],
    teamB: [{ pid: THEM, name: 'Theirs', cls: 'mage', kills: 0, deaths: 1, down: false }],
    ...over,
  };
}

function boutWire(format: string, extra: Record<string, unknown> = {}) {
  return {
    format,
    state: 'active',
    map: 'sunken_pit',
    allies: combatants(ME),
    enemies: combatants(THEM),
    ...extra,
  };
}

function worldWith(match: unknown, duel: unknown = null) {
  return { duelInfo: duel, arenaInfo: { format: '2v2', queued: false, match } };
}

/** A ranked bout reads as a ranked bout; the cast is what lets the base members be named. */
function rankedRead(bout: unknown): RankedMatch {
  return readMatch(worldWith(bout)) as RankedMatch;
}

function fiestaRead(over: Record<string, unknown> = {}): FiestaMatch {
  return readMatch(worldWith(boutWire('fiesta', { fiesta: fiestaWire(over) }))) as FiestaMatch;
}

function yumiRead(over: Record<string, unknown> = {}): YumiMatch {
  return readMatch(worldWith(boutWire('yumi3', { yumi: yumiWire(over) }))) as YumiMatch;
}

describe('readMatch', () => {
  it('reads a duel as a match of its own', () => {
    const duel = readMatch(
      worldWith(null, { otherPid: THEM, otherName: 'Rival', state: 'countdown' }),
    );

    expect(duel).toEqual({
      format: 'duel',
      state: 'countdown',
      otherPid: THEM,
      otherName: 'Rival',
    });
  });

  // The single most important case in the file: `arenaInfo` is non-null for
  // every player in the world, so keying off the key rather than off `match`
  // reports a bout for characters who have never queued.
  it('answers null for the arena reading every idle character receives', () => {
    expect(readMatch({ duelInfo: null, arenaInfo: { format: null, match: null } })).toBeNull();
    expect(readMatch({})).toBeNull();
  });

  it('answers the duel first, because the arena key is ten seconds stale', () => {
    const world = worldWith(boutWire('2v2'), { otherPid: THEM, otherName: 'R', state: 'active' });

    expect(readMatch(world)?.format).toBe('duel');
  });

  it('carries the shared bout members on a ranked bout', () => {
    expect(readMatch(worldWith(boutWire('1v1')))).toEqual({
      format: '1v1',
      state: 'active',
      map: 'sunken_pit',
      allies: combatants(ME),
      enemies: combatants(THEM),
      returnIn: null,
    });
  });

  // The wire omits the field entirely while a bout runs. Publishing 0 would say
  // the aftermath has already ended on every bout still being fought.
  it('leaves returnIn null while the bout runs and reports it once it is over', () => {
    expect(rankedRead(boutWire('1v1')).returnIn).toBeNull();
    expect(rankedRead(boutWire('1v1', { returnIn: 8 })).returnIn).toBe(8);
  });

  // The game types the field optional for rolling deploys, so a guess would be a
  // map id the server never sent. Written without the key rather than with an
  // undefined one: a server that predates the field omits it entirely.
  it('answers a null map rather than guessing one', () => {
    const mapless = { format: '1v1', state: 'active', allies: [], enemies: [] };

    expect(rankedRead(mapless).map).toBeNull();
  });

  it('answers null for a format it does not know', () => {
    expect(readMatch(worldWith(boutWire('bagchase')))).toBeNull();
  });
});

describe('readMatch on a Fiesta bout', () => {
  it('splits the scoreboard by the team letter, once, so nobody else compares one', () => {
    expect(fiestaRead().scoreboard.mine[0]?.pid).toBe(ME);
    expect(fiestaRead({ team: 'B' }).scoreboard.mine[0]?.pid).toBe(THEM);
    expect(fiestaRead({ team: 'B' }).scoreboard.theirs[0]?.pid).toBe(ME);
  });

  // The wire names the ring centre `cx`/`cz`; every coordinate this API
  // publishes is `x`/`z`, and an addon feeding `ui.anchor3d` needs the second.
  it('renames the ring centre to the coordinates the rest of the API uses', () => {
    expect(fiestaRead().ring).toEqual({ x: 120, z: -40, radius: 33.5 });
  });

  it('carries the power-up telegraph and the augment offer', () => {
    const fiesta = fiestaRead();

    expect(fiesta.powerups[0]).toEqual({
      id: 7,
      defId: 'haste',
      x: 1,
      z: 2,
      state: 'spawning',
      frac: 0.25,
      color: 0xff_00_ff,
    });
    expect(fiesta.offer).toEqual({ tier: 'gold', wave: 2, choices: ['a', 'b'] });
  });

  it('reads an unknown augment tier as the lowest rather than the rarest', () => {
    expect(fiestaRead({ offer: { tier: 'obsidian', wave: 3, choices: [] } }).offer?.tier).toBe(
      'silver',
    );
  });

  it('answers null when the format says fiesta and the record is missing', () => {
    expect(readMatch(worldWith(boutWire('fiesta')))).toBeNull();
  });
});

describe('readMatch on a Protect Yumi bout', () => {
  it('splits the cats by the team letter, which an objective display gets visibly wrong', () => {
    expect(yumiRead().cats.mine.entityId).toBe(900);
    expect(yumiRead({ team: 'B' }).cats.mine.entityId).toBe(901);
    expect(yumiRead({ team: 'B' }).cats.theirs.entityId).toBe(900);
  });

  // The server fills a dead or missing cat with zeroes at the world origin, so a
  // marker drawn on a truthiness check lands in the middle of the map.
  it('reads a missing cat as not alive rather than as a cat at the origin', () => {
    const gone = yumiRead({
      yumiA: { entityId: 900, hp: 0, maxHp: 5000, x: 0, z: 0, alive: false },
    });

    expect(gone.cats.mine.alive).toBe(false);
    expect(gone.cats.mine.hp).toBe(0);
  });

  it('publishes sudden death as the one bit the bout state does not already carry', () => {
    expect(yumiRead().suddenDeath).toBe(false);
    expect(yumiRead({ phase: 'sudden' }).suddenDeath).toBe(true);
    expect(yumiRead({ phase: 'sudden' }).format).toBe('yumi3');
  });

  it('narrows the team size to the two the brackets have', () => {
    expect(yumiRead({ size: 5 }).size).toBe(5);
    expect(yumiRead({ size: 4 }).size).toBe(3);
  });
});

describe('matchSignature', () => {
  // The whole watch contract: the ring eases every frame, so including it would
  // fire a subscription continuously to report that time is passing.
  it('ignores the ring easing and reports the score', () => {
    const wide = fiestaRead({ ring: { cx: 120, cz: -40, radius: 90 } });

    expect(matchSignature(wide)).toBe(matchSignature(fiestaRead()));
    expect(matchSignature(fiestaRead({ myScore: 5 }))).not.toBe(matchSignature(fiestaRead()));
  });

  it('reports a power-up appearing and ignores its telegraph filling', () => {
    const filling = fiestaRead({
      powerups: [{ id: 7, defId: 'haste', x: 1, z: 2, state: 'spawning', frac: 0.9, color: 1 }],
    });
    const second = fiestaRead({
      powerups: [
        { id: 7, defId: 'haste', x: 1, z: 2, state: 'spawning', frac: 0.25, color: 1 },
        { id: 8, defId: 'shield', x: 3, z: 4, state: 'ready', frac: 1, color: 2 },
      ],
    });

    expect(matchSignature(filling)).toBe(matchSignature(fiestaRead()));
    expect(matchSignature(second)).not.toBe(matchSignature(fiestaRead()));
  });

  // A cat's health is up to ten seconds old and the live path is `yumiStatus`.
  // Firing on it would invite an addon to treat the notification as the moment.
  it('ignores a cat losing health and reports it going down', () => {
    const hurt = yumiRead({
      yumiA: { entityId: 900, hp: 10, maxHp: 5000, x: 10, z: 20, alive: true },
    });
    const dead = yumiRead({
      yumiA: { entityId: 900, hp: 0, maxHp: 5000, x: 0, z: 0, alive: false },
    });

    expect(matchSignature(hurt)).toBe(matchSignature(yumiRead()));
    expect(matchSignature(dead)).not.toBe(matchSignature(yumiRead()));
  });

  it('ignores every countdown on a bout', () => {
    const later = yumiRead({ matchElapsed: 200, teleportIn: 1, suddenDeathIn: 2 });

    expect(matchSignature(later)).toBe(matchSignature(yumiRead()));
  });

  it('reports a duel by opponent and state, and answers empty for no bout', () => {
    const duel = readMatch(worldWith(null, { otherPid: THEM, otherName: 'R', state: 'countdown' }));

    expect(matchSignature(duel)).not.toBe(matchSignature(null));
    expect(matchSignature(null)).toBe('');
  });
});

/** Every case here builds a wire that reads, so the reading is taken as non-null. */
function arenaOf(wire: unknown): ArenaStandings {
  return readArena({ arenaInfo: wire }) as ArenaStandings;
}

describe('readArena', () => {
  const Wire = {
    format: '2v2',
    queued: true,
    queueSize: 6,
    standings: { '2v2': { rating: 1550, wins: 3, losses: 1 } },
    ladders: {
      '2v2': [{ pid: ME, name: 'Mine', cls: 'hunter', rating: 1550, wins: 3, losses: 1 }],
    },
    match: null,
  };

  // The three unranked brackets are server-side copies with no meaning, and
  // dropping them would make every lookup write a guard.
  it('fills every bracket so a lookup never needs a guard', () => {
    const arena = arenaOf(Wire);

    expect(Object.keys(arena.standings)).toEqual(['1v1', '2v2', 'fiesta', 'yumi3', 'yumi5']);
    expect(arena.standings['1v1']).toEqual({ rating: 0, wins: 0, losses: 0 });
    expect(arena.ladders.yumi5).toEqual([]);
  });

  it('reads the selected bracket, the queue and the ranked record', () => {
    const arena = arenaOf(Wire);

    expect(arena.format).toBe('2v2');
    expect(arena.queued).toBe(true);
    expect(arena.queueSize).toBe(6);
    expect(arena.standings['2v2'].rating).toBe(1550);
    expect(arena.ladders['2v2'][0]?.pid).toBe(ME);
  });

  it('answers a null bracket for a character in neither a queue nor a bout', () => {
    expect(arenaOf({ format: null }).format).toBeNull();
    expect(arenaOf({ format: 'bagchase' }).format).toBeNull();
    expect(readArena({})).toBeNull();
  });
});

describe('arenaSignature', () => {
  const Wire = {
    format: '1v1',
    queued: true,
    queueSize: 2,
    standings: { '1v1': { rating: 1500, wins: 1, losses: 1 } },
    ladders: { '1v1': [{ pid: ME, rating: 1500 }] },
    match: null,
  };

  it('reports a rating moving and a ladder reordering', () => {
    const base = arenaOf(Wire);
    const rated = arenaOf({ ...Wire, standings: { '1v1': { rating: 1520, wins: 2, losses: 1 } } });
    const reordered = arenaOf({ ...Wire, ladders: { '1v1': [{ pid: THEM, rating: 1600 }] } });

    expect(arenaSignature(rated)).not.toBe(arenaSignature(base));
    expect(arenaSignature(reordered)).not.toBe(arenaSignature(base));
  });

  // Their standings are copies of 2v2 and their ladders are always empty, so
  // including them would report the same change twice on one sample.
  it('leaves the unranked brackets out, since they mirror the ranked ones', () => {
    const base = arenaOf(Wire);
    const mirrored = arenaOf({
      ...Wire,
      standings: { '1v1': { rating: 1500, wins: 1, losses: 1 }, fiesta: { rating: 99 } },
    });

    expect(arenaSignature(mirrored)).toBe(arenaSignature(base));
  });
});
