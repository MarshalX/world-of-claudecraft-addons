// Which side a unit is on, which no field answers for a player.
//
// Every case here is one the flag gets WRONG, which is the whole reason the rule
// exists: `hostile` is written where the game builds a mob and nowhere else, so
// an opponent in a duel, an arena and a battleground all carry the same false
// your own healer does. A suite that set the flag on a player would pass against
// a game nobody is running, which is exactly what the fixtures below refuse to
// do: no player here is ever hostile.

import { describe, expect, it } from 'vitest';
import type { Entity } from '../loader/src/runtime/world/game-types.ts';
import type { MatchInfo } from '../loader/src/runtime/world/match.ts';
import { fightsPlayer, reactionOf } from '../loader/src/runtime/world/reaction.ts';
import { PLAYER_ENTITY } from './fakes/frames.ts';

const PLAYER_ID = 3267;
const RIVAL_ID = 42;
const ALLY_ID = 43;
const MOB_ID = 286;
const PET_ID = 287;
/** The two teams, by the index the game gives each. */
const CRIMSON = 0;
const AZURE = 1;

function entity(over: Partial<Entity>): Entity {
  return {
    ...(PLAYER_ENTITY as unknown as Entity),
    hostile: false,
    ownerId: null,
    dead: false,
    ...over,
  };
}

/** A player, as the wire delivers one: never hostile, whoever they are fighting for. */
function rival(over: Partial<Entity> = {}): Entity {
  return entity({ id: RIVAL_ID, kind: 'player', ...over });
}

/** A wild mob, which is the one kind the flag is true about. */
function beast(over: Partial<Entity> = {}): Entity {
  return entity({ id: MOB_ID, kind: 'mob', hostile: true, ...over });
}

function roster(...units: readonly Entity[]): ReadonlyMap<number, Entity> {
  return new Map(units.map((unit) => [unit.id, unit]));
}

function duel(otherPid: number): MatchInfo {
  return { format: 'duel', state: 'active', otherPid, otherName: 'Dravin' };
}

function arena(...enemyPids: readonly number[]): MatchInfo {
  return {
    format: '2v2',
    state: 'active',
    map: 'coliseum',
    returnIn: null,
    allies: [],
    enemies: enemyPids.map((pid) => ({ pid, name: 'Dravin', cls: 'rogue', level: 20 })),
  };
}

function battleground(myTeam: number): MatchInfo {
  return {
    format: 'battleground',
    state: 'active',
    myTeam,
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
        pid: ALLY_ID,
        name: 'Anserra',
        cls: 'priest',
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

describe('reactionOf', () => {
  it('reads a stranger as friendly, which is what the game draws', () => {
    expect(reactionOf(rival(), roster(rival()), null)).toBe('friendly');
  });

  it('reads a wild mob as neutral, which is a third answer and not a missing one', () => {
    const critter = beast({ hostile: false });

    expect(reactionOf(critter, roster(critter), null)).toBe('neutral');
  });

  it('reads a hostile mob from its own flag, with no bout anywhere', () => {
    expect(reactionOf(beast(), roster(beast()), null)).toBe('hostile');
  });

  it('reads an npc as friendly', () => {
    const guard = entity({ id: 500, kind: 'npc' });

    expect(reactionOf(guard, roster(guard), null)).toBe('friendly');
  });

  // The three bouts, which are the three sources the game's own renderer folds
  // together and the three the flag is silently false for.
  it('reads a duel opponent as hostile', () => {
    expect(reactionOf(rival(), roster(rival()), duel(RIVAL_ID))).toBe('hostile');
  });

  it('reads an arena enemy as hostile and leaves the ally alone', () => {
    const ally = rival({ id: ALLY_ID });

    expect(reactionOf(rival(), roster(rival(), ally), arena(RIVAL_ID))).toBe('hostile');
    expect(reactionOf(ally, roster(rival(), ally), arena(RIVAL_ID))).toBe('friendly');
  });

  it('reads a battleground fighter by team rather than by roster membership', () => {
    const ally = rival({ id: ALLY_ID });
    const bout = battleground(CRIMSON);

    expect(reactionOf(rival(), roster(rival(), ally), bout)).toBe('hostile');
    expect(reactionOf(ally, roster(rival(), ally), bout)).toBe('friendly');
  });

  it('follows the side YOU are on, so the same roster answers the other way round', () => {
    const ally = rival({ id: ALLY_ID });
    const swapped = battleground(AZURE);

    expect(reactionOf(rival(), roster(rival(), ally), swapped)).toBe('friendly');
    expect(reactionOf(ally, roster(rival(), ally), swapped)).toBe('hostile');
  });

  it('leaves a player who is in no bout friendly while one is on', () => {
    const bystander = entity({ id: 900, kind: 'player' });

    expect(reactionOf(bystander, roster(rival(), bystander), duel(RIVAL_ID))).toBe('friendly');
  });

  // A pet is the case the flag looks right for and is not: it is a mob, so the
  // flag is real, and it is somebody's, so the flag is not the answer.
  it("takes an enemy pet's side from its owner", () => {
    const pet = beast({ id: PET_ID, hostile: false, ownerId: RIVAL_ID });

    expect(reactionOf(pet, roster(rival(), pet), duel(RIVAL_ID))).toBe('hostile');
  });

  it('reads your own pet as friendly rather than as a wild mob', () => {
    const mine = beast({ id: PET_ID, hostile: false, ownerId: PLAYER_ID });
    const me = entity({ id: PLAYER_ID, kind: 'player' });

    expect(reactionOf(mine, roster(me, mine), null)).toBe('friendly');
  });

  it('falls back to the pet itself when its owner is out of scope', () => {
    const stray = beast({ id: PET_ID, ownerId: 9999 });

    expect(reactionOf(stray, roster(stray), null)).toBe('hostile');
  });
});

describe('fightsPlayer', () => {
  it('answers no with no bout at all', () => {
    expect(fightsPlayer(null, RIVAL_ID)).toBe(false);
  });

  it('answers no for a pid the bout does not name', () => {
    expect(fightsPlayer(battleground(CRIMSON), 9999)).toBe(false);
    expect(fightsPlayer(arena(RIVAL_ID), 9999)).toBe(false);
    expect(fightsPlayer(duel(RIVAL_ID), 9999)).toBe(false);
  });
});
