// window.__game shape probe.
//
// Results are recorded per host: PBE runs ahead of live, so a member missing
// there is the earliest signal that a game update will break addons.

import { isRecord } from './net/frames.ts';

/**
 * The members the game assigns, from the one assignment site in src/main.ts.
 *
 * `__game` is an undeclared debug hook with no compatibility promise, so this
 * list is a record of what was seen, not a contract. Drift against it is the
 * signal the probe exists to produce.
 */
const KNOWN_MEMBERS = [
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
  // biome-ignore lint/security/noSecrets: a member name copied from the game, which the entropy heuristic cannot tell from a token
  'flushLockpickEvents',
] as const;

/**
 * What the loader itself cannot work without.
 *
 * Only `world`: it backs the whole world API. Everything else degrades a
 * specific surface rather than the loader, and `online` is deliberately absent
 * because its drainEvents is destructive and we read the socket instead.
 */
const REQUIRED_MEMBERS: readonly string[] = ['world'];

export interface GameProbe {
  readonly present: readonly string[];
  readonly missing: readonly string[];
  /** Members the game has grown since KNOWN_MEMBERS was written. */
  readonly added: readonly string[];
  /** Whether every member the loader depends on is there. */
  readonly ok: boolean;
}

export const GAME_MEMBERS: readonly string[] = KNOWN_MEMBERS;

export function probeGame(candidate: unknown): GameProbe {
  if (!isRecord(candidate)) {
    return Object.freeze({
      present: [],
      missing: KNOWN_MEMBERS.slice(),
      added: [],
      ok: false,
    });
  }

  const present: string[] = [];
  const missing: string[] = [];
  for (const member of KNOWN_MEMBERS) {
    if (candidate[member] === undefined) {
      missing.push(member);
    } else {
      present.push(member);
    }
  }
  const known = new Set<string>(KNOWN_MEMBERS);
  const added = Object.keys(candidate).filter((key) => !known.has(key));

  return Object.freeze({
    present,
    missing,
    added,
    ok: REQUIRED_MEMBERS.every((member) => candidate[member] !== undefined),
  });
}
