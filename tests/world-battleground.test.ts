// Thornhollow Fields: the two readings and their two watch keys.
//
// The case that carries this file is the one `world-match.test.ts` opens with,
// in a second place: `bgInfo` IS PRESENT FOR EVERY CHARACTER, queued or not, and
// only its `match` member says a match is on. A reader that answered whenever
// the key existed would report the whole realm as fighting a battleground.
//
// The second is that this is where an enemy PLAYER is identified. A player
// entity never carries `hostile`, which the game sets on mobs alone, so the
// roster's `team` against `myTeam` is the only honest answer, and the read has
// to keep both sides in one list to give it.
//
// The third is the cadence split. The key rides at 1 Hz, so the signatures
// ignore every clock on it, and the events are the live path. A subscription
// that fired on `timeLeft` would fire once a second for the length of a match to
// say that time is passing.

import { describe, expect, it } from 'vitest';
import {
  type BattlegroundMatch,
  type BattlegroundStandings,
  battlegroundOf,
  readBattleground,
} from '../loader/src/runtime/world/battleground.ts';
import { readMatch } from '../loader/src/runtime/world/match.ts';
import {
  battlegroundSignature,
  matchSignature,
} from '../loader/src/runtime/world/signature-match.ts';

const ME = 11;
const ALLY = 12;
const THEM = 22;
const CRIMSON = 0;
const AZURE = 1;

function fighterWire(pid: number, team: number, over: Record<string, unknown> = {}) {
  return {
    pid,
    name: `p${pid}`,
    cls: 'hunter',
    team,
    carrying: false,
    dead: false,
    kills: 1,
    deaths: 0,
    captures: 0,
    assists: 2,
    ...over,
  };
}

function flagWire(over: Record<string, unknown> = {}) {
  return { state: 'home', carrierPid: null, carrierName: null, carrierTeam: null, ...over };
}

/** A match record as `bgInfoFor` builds it, with the wire's own `players` roster. */
function matchWire(over: Record<string, unknown> = {}) {
  return {
    state: 'active',
    myTeam: CRIMSON,
    capsToWin: 3,
    scores: [1, 2],
    flags: [flagWire(), flagWire()],
    players: [fighterWire(ME, CRIMSON), fighterWire(THEM, AZURE)],
    countdown: 0,
    timeLeft: 540,
    waveIn: [7, 3],
    respawnIn: 0,
    winner: null,
    ...over,
  };
}

function infoWire(over: Record<string, unknown> = {}) {
  return {
    rating: 1550,
    wins: 4,
    losses: 2,
    draws: 1,
    captures: 9,
    queued: false,
    queueSize: 6,
    queuedParty: 1,
    firstWinBonusReady: true,
    requeueIn: 0,
    proposal: null,
    ladder: [{ pid: ME, name: 'Mine', cls: 'hunter', rating: 1550, wins: 4, losses: 2, draws: 1 }],
    match: null,
    ...over,
  };
}

function worldWith(over: Record<string, unknown> = {}): unknown {
  return { duelInfo: null, arenaInfo: { format: null, match: null }, bgInfo: infoWire(over) };
}

/** Every case here builds a wire that reads, so the reading is taken as non-null. */
function matchOf(over: Record<string, unknown> = {}): BattlegroundMatch {
  return battlegroundOf(worldWith({ match: matchWire(over) })) as BattlegroundMatch;
}

function standingsOf(over: Record<string, unknown> = {}): BattlegroundStandings {
  return readBattleground(worldWith(over)) as BattlegroundStandings;
}

describe('battlegroundOf', () => {
  // The single most important case in the file, and the same shape as the arena
  // one: every character carries this key from login, match or no match.
  it('answers null for the reading every idle character receives', () => {
    expect(battlegroundOf(worldWith())).toBeNull();
    expect(battlegroundOf({})).toBeNull();
  });

  it('carries both sides in one roster, each with its own team', () => {
    expect(matchOf().fighters).toEqual([
      { ...fighterWire(ME, CRIMSON) },
      { ...fighterWire(THEM, AZURE) },
    ]);
  });

  it('reads the score, the caps and the wave pair as per-team pairs', () => {
    const match = matchOf();

    expect(match.scores).toEqual([1, 2]);
    expect(match.waveIn).toEqual([7, 3]);
    expect(match.capsToWin).toBe(3);
  });

  // A pair the wire did not send would otherwise be `[undefined, undefined]`,
  // and a NaN reaching a bar's width drops the declaration silently.
  it('answers a zeroed pair when the wire sent none', () => {
    const bare = battlegroundOf({ bgInfo: { match: {} } }) as BattlegroundMatch;

    expect(bare.scores).toEqual([0, 0]);
    expect(bare.waveIn).toEqual([0, 0]);
  });

  it('publishes the end state under the word every other format uses', () => {
    expect(matchOf({ state: 'ended', winner: AZURE }).state).toBe('over');
    expect(matchOf({ state: 'countdown' }).state).toBe('countdown');
  });

  // Guessing a boundary from a value the game has since added would draw a start
  // gate or an aftermath that is not there. The middle draws neither.
  it('reads an unrecognised state as active', () => {
    expect(matchOf({ state: 'intermission' }).state).toBe('active');
  });

  it('reads a carried flag, and its carrier as an entity id', () => {
    const carried = flagWire({
      state: 'carried',
      carrierPid: THEM,
      carrierName: 'p22',
      carrierTeam: AZURE,
    });
    const match = matchOf({ flags: [carried, flagWire()] });

    expect(match.flags[CRIMSON]).toEqual({
      state: 'carried',
      carrierPid: THEM,
      carrierName: 'p22',
      carrierTeam: AZURE,
    });
    expect(match.flags[AZURE].carrierPid).toBeNull();
  });

  // 'carried' and 'dropped' are both claims a display acts on. Home draws
  // nothing, so it is the safe reading of a state this loader does not know.
  it('reads an unrecognised flag state as home', () => {
    expect(matchOf({ flags: [flagWire({ state: 'returning' }), flagWire()] }).flags[0].state).toBe(
      'home',
    );
  });
});

describe('readMatch over a battleground', () => {
  it('answers the battleground as one member of the bout union', () => {
    const match = readMatch(worldWith({ match: matchWire() }));

    expect(match?.format).toBe('battleground');
  });

  // The order is falling freshness rather than taste: a duel rides every tick.
  it('answers a duel first', () => {
    const world = {
      duelInfo: { otherPid: THEM, otherName: 'R', state: 'active' },
      arenaInfo: { format: null, match: null },
      bgInfo: infoWire({ match: matchWire() }),
    };

    expect(readMatch(world)?.format).toBe('duel');
  });

  // The arena key is ten seconds stale where this one is a second stale, and
  // the game never puts a character in both.
  it('answers the battleground ahead of an arena bout', () => {
    const world = {
      duelInfo: null,
      arenaInfo: { format: '2v2', match: { format: '2v2', state: 'active' } },
      bgInfo: infoWire({ match: matchWire() }),
    };

    expect(readMatch(world)?.format).toBe('battleground');
  });
});

describe('readBattleground', () => {
  it('answers the record every character carries, with no match on it', () => {
    const standings = standingsOf();

    expect(standings.rating).toBe(1550);
    expect(standings.draws).toBe(1);
    expect(standings.captures).toBe(9);
    expect(standings.ladder).toHaveLength(1);
  });

  it('answers null only when the key itself is absent', () => {
    expect(readBattleground({})).toBeNull();
    expect(readBattleground({ bgInfo: null })).toBeNull();
  });

  it('reads a backfill offer as one, and an ordinary offer as a match', () => {
    const backfill = standingsOf({
      proposal: { id: 3, kind: 'backfill', size: 1, accepted: 0, myResponse: 'pending' },
    });

    expect(backfill.proposal?.kind).toBe('backfill');
    expect(standingsOf({ proposal: { id: 4, size: 10 } }).proposal?.kind).toBe('match');
  });

  it('reads my own answer, defaulting to unanswered', () => {
    const accepted = standingsOf({ proposal: { id: 3, myResponse: 'accepted' } });

    expect(accepted.proposal?.myResponse).toBe('accepted');
    expect(standingsOf({ proposal: { id: 3 } }).proposal?.myResponse).toBe('pending');
  });
});

describe('the battleground signatures', () => {
  it('ignores every clock on the match', () => {
    const later = matchOf({ timeLeft: 12, countdown: 3, waveIn: [1, 1], respawnIn: 9 });

    expect(matchSignature(later)).toBe(matchSignature(matchOf()));
  });

  it('reports a capture, a flag being taken, and the match ending', () => {
    const scored = matchOf({ scores: [2, 2] });
    const taken = matchOf({
      flags: [flagWire({ state: 'carried', carrierPid: THEM }), flagWire()],
    });
    const over = matchOf({ state: 'ended', winner: CRIMSON });

    expect(matchSignature(scored)).not.toBe(matchSignature(matchOf()));
    expect(matchSignature(taken)).not.toBe(matchSignature(matchOf()));
    expect(matchSignature(over)).not.toBe(matchSignature(matchOf()));
  });

  // A kill moves the tallies AND the dead column, and both are discrete events a
  // scoreboard repaints for. The key cannot sample faster than 1 Hz.
  it('reports a kill and a body', () => {
    const killed = matchOf({
      players: [fighterWire(ME, CRIMSON, { kills: 2 }), fighterWire(THEM, AZURE, { dead: true })],
    });

    expect(matchSignature(killed)).not.toBe(matchSignature(matchOf()));
  });

  // The wire's roster order is not a fact about the match, so a reordering that
  // changed nothing would otherwise repaint every scoreboard in the match.
  it('ignores the roster arriving in another order', () => {
    const swapped = matchOf({ players: [fighterWire(THEM, AZURE), fighterWire(ME, CRIMSON)] });

    expect(matchSignature(swapped)).toBe(matchSignature(matchOf()));
  });

  it('reports the queue and the ladder moving, and the record changing', () => {
    const queued = standingsOf({ queued: true });
    const rated = standingsOf({ rating: 1580 });
    const ladder = standingsOf({
      ladder: [
        { pid: ALLY, name: 'Other', cls: 'mage', rating: 1600, wins: 9, losses: 0, draws: 0 },
      ],
    });

    expect(battlegroundSignature(queued)).not.toBe(battlegroundSignature(standingsOf()));
    expect(battlegroundSignature(rated)).not.toBe(battlegroundSignature(standingsOf()));
    expect(battlegroundSignature(ladder)).not.toBe(battlegroundSignature(standingsOf()));
  });

  // The lockout ticks every second and what an addon acts on is the transition
  // from locked out to clear, exactly as the dungeon finder's cooldown does.
  it('carries the requeue lockout as a boolean', () => {
    const locked = standingsOf({ requeueIn: 30 });
    const nearly = standingsOf({ requeueIn: 2 });

    expect(battlegroundSignature(locked)).toBe(battlegroundSignature(nearly));
    expect(battlegroundSignature(locked)).not.toBe(battlegroundSignature(standingsOf()));
  });

  it('reports an offer opening and being accepted, and ignores its clock', () => {
    const offered = standingsOf({ proposal: { id: 3, kind: 'match', size: 10, accepted: 4 } });
    const ticking = standingsOf({
      proposal: { id: 3, kind: 'match', size: 10, accepted: 4, remaining: 9 },
    });
    const fuller = standingsOf({ proposal: { id: 3, kind: 'match', size: 10, accepted: 5 } });

    expect(battlegroundSignature(offered)).not.toBe(battlegroundSignature(standingsOf()));
    expect(battlegroundSignature(ticking)).toBe(battlegroundSignature(offered));
    expect(battlegroundSignature(fuller)).not.toBe(battlegroundSignature(offered));
  });

  it('answers empty for no reading at all', () => {
    expect(battlegroundSignature(null)).toBe('');
    expect(matchSignature(null)).toBe('');
  });
});
