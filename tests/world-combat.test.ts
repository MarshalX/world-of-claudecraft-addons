// The combat reading, branch by branch.
//
// Every case here is a fight the loader has to describe correctly with no combat
// flag to read, so what is being tested is the ORDER the signals are consulted in
// and the honesty of the source that travels with the answer. The cases that
// matter most are the ones where a branch could look right and be wrong: a mob
// that is attacking but carries no targetId, and a hate table that outlives the
// player who was on it.

import { describe, expect, it } from 'vitest';
import {
  type CombatInputs,
  IDLE_WINDOW_MS,
  readCombat,
} from '../loader/src/runtime/world/combat.ts';
import type { Entity } from '../loader/src/runtime/world/game-types.ts';
import type { MatchInfo } from '../loader/src/runtime/world/match.ts';
import type { PartyInfo } from '../loader/src/runtime/world/party-types.ts';
import { PLAYER_ENTITY } from './fakes/frames.ts';

const PLAYER_ID = 3267;
const MOB_ID = 286;
/** Another player: the one kind of unit whose side is not on its record. */
const RIVAL_ID = 42;
/** The two teams, by the index the game gives each. */
const CRIMSON = 0;
const AZURE = 1;

function player(over: Partial<Entity> = {}): Entity {
  return { ...(PLAYER_ENTITY as unknown as Entity), id: PLAYER_ID, ...over };
}

/** A mob as the wire actually delivers one: no targetId, ever. */
function mob(over: Partial<Entity> = {}): Entity {
  return {
    ...(PLAYER_ENTITY as unknown as Entity),
    id: MOB_ID,
    kind: 'mob',
    hostile: true,
    dead: false,
    targetId: null,
    aggroTargetId: null,
    threat: new Map<number, number>(),
    ...over,
  };
}

/**
 * Another PLAYER, as the wire actually delivers one: `hostile` false, always.
 *
 * The flag is written where the game builds a mob, so an opponent carries the
 * same false your own party does and only the bout tells them apart.
 */
function rival(over: Partial<Entity> = {}): Entity {
  return mob({ id: RIVAL_ID, kind: 'player', hostile: false, ...over });
}

function duel(otherPid: number): MatchInfo {
  return { format: 'duel', state: 'active', otherPid, otherName: 'Dravin' };
}

/** One fighter on each side, the player on Crimson. Every clock at rest. */
function battleground(): MatchInfo {
  return {
    format: 'battleground',
    state: 'active',
    myTeam: CRIMSON,
    capsToWin: 3,
    scores: [0, 0],
    flags: [
      { state: 'home', carrierPid: null, carrierName: null, carrierTeam: null },
      { state: 'home', carrierPid: null, carrierName: null, carrierTeam: null },
    ],
    fighters: [
      {
        pid: PLAYER_ID,
        name: 'You',
        cls: 'hunter',
        team: CRIMSON,
        carrying: false,
        dead: false,
        kills: 0,
        deaths: 0,
        captures: 0,
        assists: 0,
      },
      {
        pid: RIVAL_ID,
        name: 'Dravin',
        cls: 'rogue',
        team: AZURE,
        carrying: false,
        dead: false,
        kills: 0,
        deaths: 0,
        captures: 0,
        assists: 0,
      },
    ],
    countdown: 0,
    timeLeft: 300,
    waveIn: [0, 0],
    respawnIn: 0,
    winner: null,
  };
}

function party(inCombat: 0 | 1): PartyInfo {
  return {
    leader: PLAYER_ID,
    raid: false,
    members: [
      {
        pid: PLAYER_ID,
        name: 'Someone',
        cls: 'hunter',
        level: 10,
        hp: 100,
        mhp: 100,
        res: 0,
        mres: 0,
        rtype: null,
        x: 0,
        z: 0,
        dead: 0,
        inCombat,
        group: 1,
      },
    ],
  };
}

function inputs(over: Partial<CombatInputs> = {}): CombatInputs {
  return {
    player: player(),
    party: null,
    entities: new Map<number, Entity>(),
    match: null,
    lastDamageAt: null,
    now: 0,
    ...over,
  };
}

describe('readCombat', () => {
  it('answers from the party row when the player is grouped, and says so', () => {
    expect(readCombat(inputs({ party: party(1) }))).toEqual({ active: true, source: 'party' });
    expect(readCombat(inputs({ party: party(0) }))).toEqual({ active: false, source: 'party' });
  });

  // The branch the whole feature turns on. A mob beating on the player carries no
  // targetId at all, so anything reading that field sees an idle world; the hate
  // table is what the server actually fills in.
  it('reads a mob hate table that names the player, which is the only mob signal there is', () => {
    const attacker = mob({ threat: new Map([[PLAYER_ID, 840]]), aggroTargetId: PLAYER_ID });

    expect(readCombat(inputs({ entities: new Map([[MOB_ID, attacker]]) }))).toEqual({
      active: true,
      source: 'threat',
    });
  });

  it('ignores a mob whose table names somebody else', () => {
    const attacker = mob({ threat: new Map([[999, 840]]), aggroTargetId: 999 });

    expect(readCombat(inputs({ entities: new Map([[MOB_ID, attacker]]) }))).toEqual({
      active: false,
      source: 'none',
    });
  });

  // A corpse holds its table for a while. Reading it would keep the player in
  // combat after the fight they just won.
  it('ignores a dead mob still carrying the player on its table', () => {
    const corpse = mob({ dead: true, threat: new Map([[PLAYER_ID, 840]]) });

    expect(readCombat(inputs({ entities: new Map([[MOB_ID, corpse]]) }))).toEqual({
      active: false,
      source: 'none',
    });
  });

  it('reads a duel opponent targeting you, which is the one place targetId is set', () => {
    const enemy = rival({ targetId: PLAYER_ID });

    expect(
      readCombat(inputs({ entities: new Map([[RIVAL_ID, enemy]]), match: duel(RIVAL_ID) })),
    ).toEqual({
      active: true,
      source: 'pvp',
    });
  });

  // The fixture this replaced set `hostile: true` on a player, which the game
  // never does: it is written when a MOB is built and nowhere else. So the branch
  // it was proving read as a restriction and was a permanent no, and this is the
  // case that fails if hostility ever goes back to being read off the entity.
  it('does not treat a stranger with you selected as a pvp attacker', () => {
    const stranger = rival({ targetId: PLAYER_ID });

    expect(readCombat(inputs({ entities: new Map([[RIVAL_ID, stranger]]) }))).toEqual({
      active: false,
      source: 'none',
    });
  });

  it('reads an enemy fighter in a battleground, where nobody carries the flag', () => {
    const enemy = rival({ targetId: PLAYER_ID });

    expect(
      readCombat(inputs({ entities: new Map([[RIVAL_ID, enemy]]), match: battleground() })),
    ).toEqual({
      active: true,
      source: 'pvp',
    });
  });

  it('does not treat your own side in a battleground as an attacker', () => {
    const ally = rival({ targetId: PLAYER_ID });
    const sameSide = { ...battleground(), myTeam: AZURE };

    expect(readCombat(inputs({ entities: new Map([[RIVAL_ID, ally]]), match: sameSide }))).toEqual({
      active: false,
      source: 'none',
    });
  });

  // The same fields on a MOB must not answer, or the pvp branch would silently
  // stand in for the mob branch and hide a broken hate table read.
  it('does not treat a mob with a targetId as a pvp attacker', () => {
    const impossible = mob({ targetId: PLAYER_ID });

    expect(readCombat(inputs({ entities: new Map([[MOB_ID, impossible]]) }))).toEqual({
      active: false,
      source: 'none',
    });
  });

  it('falls back to recent damage, and lets it lapse', () => {
    const recent = inputs({ lastDamageAt: 1000, now: 1000 + IDLE_WINDOW_MS - 1 });
    const lapsed = inputs({ lastDamageAt: 1000, now: 1000 + IDLE_WINDOW_MS });

    expect(readCombat(recent)).toEqual({ active: true, source: 'recent' });
    expect(readCombat(lapsed)).toEqual({ active: false, source: 'none' });
  });

  // Confidence order, not first-match order: a grouped player fighting a mob has
  // two branches that would both answer, and the server's per-member flag is the
  // one that knows about a fight happening out of interest scope.
  it('prefers the party row over a hate table that would also answer', () => {
    const attacker = mob({ threat: new Map([[PLAYER_ID, 840]]) });

    expect(
      readCombat(inputs({ party: party(0), entities: new Map([[MOB_ID, attacker]]) })),
    ).toEqual({ active: false, source: 'party' });
  });

  it('is out of combat while dead, whatever is still holding threat', () => {
    const attacker = mob({ threat: new Map([[PLAYER_ID, 840]]) });

    expect(
      readCombat(
        inputs({
          player: player({ dead: true }),
          entities: new Map([[MOB_ID, attacker]]),
          lastDamageAt: 0,
          now: 1,
        }),
      ),
    ).toEqual({ active: false, source: 'none' });
  });

  it('answers before the world exists rather than throwing at an addon', () => {
    expect(readCombat(inputs({ player: null }))).toEqual({ active: false, source: 'none' });
  });
});
