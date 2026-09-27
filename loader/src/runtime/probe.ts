// window.__game shape probe, recorded per host since channels diverge.

import { isRecord } from './net/frames.ts';

/** What src/main.ts assigns. A record of what was seen, not a contract; drift is the signal. */
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
 * Only `world`, which backs the world API. `online` is deliberately absent: its drainEvents is
 * destructive, so the loader reads the socket instead.
 */
const REQUIRED_MEMBERS: readonly string[] = ['world'];

export interface GameProbe {
  readonly present: readonly string[];
  readonly missing: readonly string[];
  /** Members not in KNOWN_MEMBERS. */
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
