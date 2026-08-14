// What counts as a change on the four keys about what the player is currently IN.
//
// Their own module rather than four more branches in `signature.ts`: the sheet
// keys describe what the player HAS, and these describe what the player is
// currently IN, which is a different question with a different lifetime.
//
// Every countdown is excluded, as everywhere else here: a bout's return timer, a
// respawn, a teleport clock, a queue's waited seconds and a proposal's thirty
// second deadline all move on every sample and none of them is a change in the
// set of things being watched.

import { fieldArray, fieldNumber, fieldScalar, fieldString, fieldValue } from '../net/frames.ts';

const SOCIAL_KEYS = ['match', 'arena', 'battleground', 'finder', 'finderBoard'] as const;

/** The two brackets that keep a record. The other three mirror 2v2, so they would report twice. */
const RANKED_FORMATS: readonly string[] = ['1v1', '2v2'];

type SocialKey = (typeof SOCIAL_KEYS)[number];

const SOCIAL_SET: ReadonlySet<string> = new Set<string>(SOCIAL_KEYS);

/**
 * Takes a plain string rather than a `WorldKey`.
 *
 * `signature.ts` imports this module, so naming its key union here would be a
 * cycle for no gain: the narrowing a caller wants happens against whatever union
 * it already holds.
 */
function isSocialKey(key: string): key is SocialKey {
  return SOCIAL_SET.has(key);
}

/** Any total order will do: the sort exists to make a signature order-independent. */
function byCodePoint(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a < b) {
    return -1;
  }
  return 1;
}

/** Who is in a bout, by pid alone. A combatant's level and class cannot move mid-bout. */
function pidsOf(rows: readonly unknown[]): string {
  return rows
    .map((row) => String(fieldNumber(row, 'pid') ?? 0))
    .sort(byCodePoint)
    .join(',');
}

function baseSignature(match: unknown): string {
  const roster = `${pidsOf(fieldArray(match, 'allies'))}/${pidsOf(fieldArray(match, 'enemies'))}`;
  return `${fieldString(match, 'format') ?? ''}|${fieldString(match, 'state') ?? ''}|${roster}|${
    fieldString(match, 'map') ?? ''
  }`;
}

/**
 * A power-up by id and phase, never by its telegraph.
 *
 * `frac` moves on every sample by construction, so including it would fire a
 * subscription continuously to say that a bar is filling. One appearing,
 * becoming grabbable, or being taken is the set change an addon acts on.
 */
function powerupsOf(match: unknown): string {
  return fieldArray(match, 'powerups')
    .map((powerup) => `${fieldNumber(powerup, 'id') ?? 0}:${fieldString(powerup, 'state') ?? ''}`)
    .sort(byCodePoint)
    .join(',');
}

/** The score, the wave, your bench, your augments, and which power-ups are on the ground. */
function fiestaSignature(match: unknown): string {
  const score = `${fieldNumber(match, 'myScore') ?? 0}:${fieldNumber(match, 'theirScore') ?? 0}`;
  const augments = fieldArray(match, 'augments').join(',');
  const offer = fieldArray(fieldValue(match, 'offer'), 'choices').join(',');
  return `${score}|${fieldNumber(match, 'wave') ?? 0}|${fieldScalar(match, 'down')}|${augments}|${
    offer
  }|${powerupsOf(match)}`;
}

/**
 * Sudden death, your bench, and whether each cat is still up.
 *
 * A cat's HEALTH and POSITION are excluded even though both move: this reading
 * is up to ten seconds old and the live path is the event queue, so firing on
 * them would notify an addon long after the fact and invite it to treat the
 * notification as the moment.
 */
function yumiSignature(match: unknown): string {
  const cats = fieldValue(match, 'cats');
  const alive = `${fieldScalar(fieldValue(cats, 'mine'), 'alive')}:${fieldScalar(
    fieldValue(cats, 'theirs'),
    'alive',
  )}`;
  return `${fieldScalar(match, 'suddenDeath')}|${fieldScalar(match, 'down')}|${alive}`;
}

/** Where each flag is and who has it. Its home team is its position, so only the pair's order carries it. */
function flagsOf(match: unknown): string {
  return fieldArray(match, 'flags')
    .map((flag) => `${fieldString(flag, 'state') ?? ''}:${fieldNumber(flag, 'carrierPid') ?? 0}`)
    .join(',');
}

/**
 * The roster by pid, with the four tallies and the two states a scoreboard draws.
 *
 * The tallies are numbers and are in anyway, for the reason the dungeon finder's
 * acceptance counts are: each increment is a discrete event a player is watching
 * for rather than a bar filling, the game itself forces a fresh readout on every
 * kill, and the key it rides cannot sample faster than 1 Hz.
 *
 * Sorted, because the wire's own roster order is not a fact about the match: a
 * reordering that changed nothing would otherwise repaint every scoreboard.
 */
function fightersOf(match: unknown): string {
  return fieldArray(match, 'fighters')
    .map((fighter) => {
      const state = `${fieldScalar(fighter, 'dead')}:${fieldScalar(fighter, 'carrying')}`;
      const kills = `${fieldNumber(fighter, 'kills') ?? 0}:${fieldNumber(fighter, 'deaths') ?? 0}`;
      const scored = `${fieldNumber(fighter, 'captures') ?? 0}:${fieldNumber(fighter, 'assists') ?? 0}`;
      return `${fieldNumber(fighter, 'pid') ?? 0}=${fieldNumber(fighter, 'team') ?? 0}:${state}:${kills}:${scored}`;
    })
    .sort(byCodePoint)
    .join(',');
}

/**
 * State, the score, both flags and the roster. No clock of any kind.
 *
 * Its own branch rather than `baseSignature`, because a battleground carries no
 * `allies`/`enemies` pair and no map: its roster is one list carrying each
 * fighter's team, which is also what its flags are indexed by.
 */
function bgMatchSignature(match: unknown): string {
  const score = fieldArray(match, 'scores').join(':');
  const result = `${fieldString(match, 'state') ?? ''}|${fieldNumber(match, 'winner') ?? ''}`;
  return `battleground|${result}|${score}|${flagsOf(match)}|${fightersOf(match)}`;
}

/** Format, state, both rosters, and whatever the format's own display repaints for. */
function matchSignature(match: unknown): string {
  if (match === null) {
    return '';
  }
  const format = fieldString(match, 'format');
  if (format === 'duel') {
    return `duel|${fieldNumber(match, 'otherPid') ?? 0}|${fieldString(match, 'state') ?? ''}`;
  }
  if (format === 'battleground') {
    return bgMatchSignature(match);
  }
  const base = baseSignature(match);
  if (format === 'fiesta') {
    return `${base}|${fiestaSignature(match)}`;
  }
  if (format === 'yumi3' || format === 'yumi5') {
    return `${base}|${yumiSignature(match)}`;
  }
  return base;
}

function recordsOf(standings: unknown): string {
  return RANKED_FORMATS.map((format) => {
    const bracket = fieldValue(standings, format);
    const wins = `${fieldNumber(bracket, 'wins') ?? 0}:${fieldNumber(bracket, 'losses') ?? 0}`;
    return `${fieldNumber(bracket, 'rating') ?? 0}:${wins}`;
  }).join(',');
}

/** The ladder in the order it arrives: a swap of two places is the change it exists to show. */
function laddersOf(ladders: unknown): string {
  return RANKED_FORMATS.map((format) =>
    fieldArray(ladders, format)
      .map((row) => `${fieldNumber(row, 'pid') ?? 0}:${fieldNumber(row, 'rating') ?? 0}`)
      .join(','),
  ).join(';');
}

/** Bracket, queue and the two ranked records. The unranked three are copies. */
function arenaSignature(arena: unknown): string {
  if (arena === null) {
    return '';
  }
  const queue = `${fieldScalar(arena, 'queued')}:${fieldNumber(arena, 'queueSize') ?? 0}`;
  const records = recordsOf(fieldValue(arena, 'standings'));
  return `${fieldString(arena, 'format') ?? ''}|${queue}|${records}|${laddersOf(
    fieldValue(arena, 'ladders'),
  )}`;
}

/** In arrival order, which is rank order: a swap of two places is the change it exists to show. */
function bgLadderOf(ladder: unknown): string {
  if (!Array.isArray(ladder)) {
    return '';
  }
  return (ladder as readonly unknown[])
    .map((row) => `${fieldNumber(row, 'pid') ?? 0}:${fieldNumber(row, 'rating') ?? 0}`)
    .join(',');
}

/**
 * The offer by acceptance, never by its clock.
 *
 * Its own reader rather than the dungeon finder's `proposalOf` above: that one
 * reads a per-role seat map this offer does not have, and the two shapes are
 * unrelated beyond both being called a proposal.
 */
function bgProposalOf(proposal: unknown): string {
  if (proposal === null) {
    return '';
  }
  const answered = `${fieldNumber(proposal, 'accepted') ?? 0}:${fieldString(proposal, 'myResponse') ?? ''}`;
  return `${fieldNumber(proposal, 'id') ?? 0}:${fieldString(proposal, 'kind') ?? ''}:${answered}`;
}

/**
 * Your record, your queue, the offer and the ladder.
 *
 * `requeueIn` is carried as a BOOLEAN, exactly as the dungeon finder's cooldown
 * is: it counts down every second, and what an addon acts on is the transition
 * from locked out to clear rather than the number.
 */
function battlegroundSignature(info: unknown): string {
  if (info === null) {
    return '';
  }
  const wins = `${fieldNumber(info, 'wins') ?? 0}:${fieldNumber(info, 'losses') ?? 0}:${fieldNumber(info, 'draws') ?? 0}`;
  const record = `${fieldNumber(info, 'rating') ?? 0}:${wins}:${fieldNumber(info, 'captures') ?? 0}`;
  const queue = `${fieldScalar(info, 'queued')}:${fieldNumber(info, 'queueSize') ?? 0}:${fieldNumber(info, 'queuedParty') ?? 0}`;
  const held = String((fieldNumber(info, 'requeueIn') ?? 0) > 0);
  const bonus = `${fieldScalar(info, 'firstWinBonusReady')}:${held}`;
  return `${record}|${queue}|${bonus}|${bgProposalOf(fieldValue(info, 'proposal'))}|${bgLadderOf(
    fieldValue(info, 'ladder'),
  )}`;
}

function needsOf(needs: unknown): string {
  const healers = `${fieldNumber(needs, 'healer') ?? 0}`;
  return `${fieldNumber(needs, 'tank') ?? 0}/${healers}/${fieldNumber(needs, 'dps') ?? 0}`;
}

/**
 * The proposal, by acceptance rather than by clock.
 *
 * The counts are in even though they are numbers: a proposal meter is the whole
 * display, each increment is the discrete event a player is watching for, and
 * there are at most five of them before the proposal resolves.
 */
function proposalOf(proposal: unknown): string {
  if (proposal === null) {
    return '';
  }
  const seats = needsOf(fieldValue(proposal, 'acceptedByRole'));
  const accepted = `${fieldNumber(proposal, 'accepted') ?? 0}:${fieldString(proposal, 'response') ?? ''}`;
  return `${fieldNumber(proposal, 'id') ?? 0}:${accepted}:${seats}`;
}

/** Your own listing, by id and by who has applied to it. */
function listingOf(listing: unknown): string {
  if (listing === null) {
    return '';
  }
  const applicants = fieldArray(listing, 'applicants')
    .map((applicant) => String(fieldNumber(applicant, 'pid') ?? 0))
    .sort(byCodePoint)
    .join(',');
  return `${fieldNumber(listing, 'id') ?? 0}=${applicants}`;
}

/**
 * Selection, queue membership, the proposal's acceptance, and your listing's applicants.
 *
 * The cooldown is carried as a BOOLEAN. It ticks every second, and what an addon
 * acts on is the transition from blocked to clear rather than the count.
 */
function finderSignature(finder: unknown): string {
  if (finder === null) {
    return '';
  }
  const roles = `${fieldArray(finder, 'roles').join(',')}/${fieldArray(finder, 'eligibleRoles').join(',')}`;
  const queued = fieldArray(fieldValue(finder, 'queue'), 'activities').join(',');
  const blocked = String((fieldNumber(finder, 'cooldown') ?? 0) > 0);
  const listing = listingOf(fieldValue(finder, 'listing'));
  return `${roles}|${queued}|${blocked}|${proposalOf(fieldValue(finder, 'proposal'))}|${listing}|${
    fieldNumber(finder, 'appliedTo') ?? ''
  }`;
}

/**
 * Listing ids with their sizes. Nothing else on a board row can move.
 *
 * The COUNT leads so that a board which has synced and is empty is a different
 * signature from one that has not synced at all. Those are different things to
 * draw, and without the count both would render as the empty string and the
 * first sync of an idle realm would notify nobody.
 */
function boardSignature(board: unknown): string {
  if (!Array.isArray(board)) {
    return '';
  }
  const rows = (board as readonly unknown[])
    .map((row) => `${fieldNumber(row, 'id') ?? 0}:${fieldNumber(row, 'size') ?? 0}`)
    .sort(byCodePoint)
    .join(',');
  return `${board.length}|${rows}`;
}

/** The five keys about what the player is currently in, dispatched by key. */
function socialCapture(key: SocialKey, value: unknown): string {
  if (key === 'match') {
    return matchSignature(value);
  }
  if (key === 'arena') {
    return arenaSignature(value);
  }
  if (key === 'battleground') {
    return battlegroundSignature(value);
  }
  if (key === 'finder') {
    return finderSignature(value);
  }
  return boardSignature(value);
}

export type { SocialKey };
export {
  arenaSignature,
  battlegroundSignature,
  boardSignature,
  finderSignature,
  isSocialKey,
  matchSignature,
  socialCapture,
};
