// What counts as a change on the keys about what the player is currently IN. Every countdown
// is excluded: it moves on every sample without changing what is being watched.

import { fieldArray, fieldNumber, fieldScalar, fieldString, fieldValue } from '../net/frames.ts';

const SOCIAL_KEYS = ['match', 'arena', 'battleground', 'finder', 'finderBoard'] as const;

/** The two brackets that keep a record. The other three mirror 2v2, so they would report twice. */
const RANKED_FORMATS: readonly string[] = ['1v1', '2v2'];

type SocialKey = (typeof SOCIAL_KEYS)[number];

const SOCIAL_SET: ReadonlySet<string> = new Set<string>(SOCIAL_KEYS);

/** Takes a plain string: naming `WorldKey` would be an import cycle with `signature.ts`. */
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
 * A power-up by id and phase, never by its telegraph `frac`, which moves on every sample.
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
 * Sudden death, your bench, and whether each cat is still up. A cat's health and position are
 * excluded: this reading can be ten seconds stale, and the event queue is the live path.
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
 * The roster by pid, with the four tallies and the two states a scoreboard draws. The tallies
 * are discrete events, not a filling bar. Sorted, since the wire's roster order means nothing.
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
 * State, the score, both flags and the roster. No clock of any kind. Not `baseSignature`: a
 * battleground has no `allies`/`enemies` pair and no map.
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
 * The offer by acceptance, never by its clock. Unrelated to the finder's `proposalOf` shape.
 */
function bgProposalOf(proposal: unknown): string {
  if (proposal === null) {
    return '';
  }
  const answered = `${fieldNumber(proposal, 'accepted') ?? 0}:${fieldString(proposal, 'myResponse') ?? ''}`;
  return `${fieldNumber(proposal, 'id') ?? 0}:${fieldString(proposal, 'kind') ?? ''}:${answered}`;
}

/**
 * Your record, your queue, the offer and the ladder. `requeueIn` is signed as a boolean, since
 * only the transition to clear matters.
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
 * The proposal, by acceptance rather than by clock. The counts are in: each increment is a
 * discrete event.
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
 * Selection, queue membership, the proposal's acceptance, and your listing's applicants. The
 * cooldown is signed as a boolean, since only the transition to clear matters.
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
 * Listing ids with their sizes. The count leads so a synced empty board differs from one never
 * synced, or the first sync of an idle realm would notify nobody.
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
