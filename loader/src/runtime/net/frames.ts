// Decoding for the frames the game's world socket carries.
//
// The game parses every frame itself. We parse our own copy off the raw string,
// so nothing an addon does to a frame can reach what the game is about to read.

/** Frames the client dispatches on, from the inbound handler in src/net/online.ts. */
const INBOUND_TYPES = [
  'hello',
  'snap',
  'events',
  'social',
  'socialpos',
  'censor',
  'error',
  'challenge',
  'spectate',
  'commandOutcome',
  'gbanklog',
] as const;

/**
 * Outbound fields that are session credentials, redacted before any addon sees
 * the frame.
 *
 * The client's first frame on every socket, including every reconnect, is
 * `{t:'auth-world-N', token, character, clientSeed}` and `token` is the account
 * bearer token in plaintext (src/net/online.ts buildWebSocketAuthMessage).
 * Matching on the field name rather than the frame type is deliberate: the type
 * carries a version number, and a future frame that gains a token is covered
 * without anyone remembering to come back here.
 */
const SECRET_FIELDS = ['token', 'clientSeed'];

const REDACTED = '[redacted]';

export type FrameType = (typeof INBOUND_TYPES)[number];

export const FRAME_TYPES: readonly FrameType[] = INBOUND_TYPES;

export interface Frame {
  readonly t: string;
  readonly [field: string]: unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A frame, or null for anything that is not one.
 *
 * Binary frames are rejected rather than decoded: the game's socket is JSON text
 * in both directions, so a Blob or ArrayBuffer here is somebody else's traffic.
 */
export function parseFrame(data: unknown): Frame | null {
  if (typeof data !== 'string') {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (fieldString(value, 't') === null) {
    return null;
  }
  return value as Frame;
}

/** One field off any object, or null. Also the only place a key is indexed. */
export function fieldValue(source: unknown, key: string): unknown {
  if (!isRecord(source)) {
    return null;
  }
  return source[key] ?? null;
}

export function fieldString(source: unknown, key: string): string | null {
  const value = fieldValue(source, key);
  if (typeof value === 'string') {
    return value;
  }
  return null;
}

export function fieldNumber(source: unknown, key: string): number | null {
  const value = fieldValue(source, key);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return null;
}

/**
 * A field rendered for a signature, covering every scalar the game uses.
 *
 * Numbers alone is not enough: entity flags like `dead` and `inCombat` are
 * booleans, and reading those as numbers drops them from a signature without
 * failing, which looks exactly like a field that never changes.
 */
export function fieldScalar(source: unknown, key: string): string {
  const value = fieldValue(source, key);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return String(value);
  }
  return '';
}

export function fieldArray(source: unknown, key: string): readonly unknown[] {
  const value = fieldValue(source, key);
  if (Array.isArray(value)) {
    return value;
  }
  return [];
}

/**
 * A copy of an outbound frame with every credential field blanked.
 *
 * Returns the frame itself when it carries none, so the common case of an input
 * frame at 20 Hz allocates nothing.
 */
export function redactOutbound(frame: Frame): Frame {
  const secrets = SECRET_FIELDS.filter((field) => Object.hasOwn(frame, field));
  if (secrets.length === 0) {
    return frame;
  }
  const copy: Record<string, unknown> = { ...frame };
  for (const field of secrets) {
    copy[field] = REDACTED;
  }
  return copy as Frame;
}

/**
 * Freeze a parsed frame and everything under it, so one addon's handler cannot
 * change what the next one sees.
 *
 * Freezing before recursing makes this safe on a cyclic graph, though JSON.parse
 * cannot produce one.
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}
