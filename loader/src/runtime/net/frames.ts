// Decoding the world socket's frames. We parse our own copy off the raw string, so nothing an addon
// does to a frame reaches what the game reads.

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
 * Outbound credential fields, redacted before any addon sees the frame. The auth frame on every
 * socket, `{t:'auth-world-N', token, ...}`, carries the bearer token. Matched on the field NAME,
 * not the frame type, because the type carries a version number.
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

/** A frame, or null. Binary data is somebody else's traffic: the game's socket is JSON text. */
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

/** Every scalar kind: a boolean flag read as a number silently drops out of a signature. */
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

/** A copy with credentials blanked, or the frame itself when it has none, allocating nothing. */
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

/** Deep-freeze, so one addon's handler cannot change what the next one sees. */
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
