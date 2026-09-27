// Reading the game's /audio/sfx/runtime-pack.json, the file its own audio engine loads. It carries
// the per-clip gain and the hashed URLs a directory listing lacks.
//
// A cue is NOT a file: a numbered family collapses into one cue with variants (`combat_block` has
// three). Hand-validated, since zod must never reach this bundle.

import { diagError } from '../../shared/diag.ts';

/** The `format` field the game stamps, and the one schema version understood. */
const FORMAT = 'woc-sfx-runtime-pack';
const SCHEMA_VERSION = 1;

const PACK_URL = '/audio/sfx/runtime-pack.json';

const DEFAULT_GAIN = 1;
const DEFAULT_RATE = 1;

interface SoundClip {
  /** At least one. Playing the cue picks one of them. */
  variants: readonly string[];
  /** The loudness normalization the game applies to this clip. */
  gain: number;
  playbackRate: number;
}

type SoundPack = ReadonlyMap<string, SoundClip>;

type PackResult = { ok: true; pack: SoundPack } | { ok: false; reason: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/** The key as a value satisfies both `noPropertyAccessFromIndexSignature` and `useLiteralKeys`. */
function field(record: Record<string, unknown> | null, key: string): unknown {
  if (record === null) {
    return;
  }
  return record[key];
}

/** A positive finite number, or the fallback. Zero gain would be a silent cue. */
function positiveNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function readVariants(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const urls: string[] = [];
  for (const entry of value) {
    const url = field(asRecord(entry), 'url');
    if (typeof url === 'string' && url.length > 0) {
      urls.push(url);
    }
  }
  return urls;
}

/** A malformed entry is dropped, not fatal: one unreadable new row should cost one cue. */
function readClip(value: unknown): SoundClip | null {
  const clip = asRecord(value);
  if (clip === null) {
    return null;
  }
  const variants = readVariants(field(clip, 'variants'));
  if (variants.length === 0) {
    return null;
  }
  return {
    variants,
    gain: positiveNumber(field(clip, 'gain'), DEFAULT_GAIN),
    playbackRate: positiveNumber(field(clip, 'playbackRate'), DEFAULT_RATE),
  };
}

/** An unknown `format` or `version` is refused: fallback URLs are lossy, a mis-parse 404s. */
function parseSoundPack(input: unknown): PackResult {
  const root = asRecord(input);
  if (root === null) {
    return { ok: false, reason: 'the sound pack is not an object' };
  }
  const format = field(root, 'format');
  if (format !== FORMAT) {
    return { ok: false, reason: `expected format '${FORMAT}', got ${String(format)}` };
  }
  const version = field(root, 'version');
  if (version !== SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `sound pack schema ${String(version)} is newer than this loader understands`,
    };
  }

  const clips = asRecord(field(root, 'clips'));
  if (clips === null) {
    return { ok: false, reason: 'the sound pack has no clips' };
  }

  const pack = new Map<string, SoundClip>();
  for (const [cue, value] of Object.entries(clips)) {
    const clip = readClip(value);
    if (clip !== null) {
      pack.set(cue, clip);
    }
  }
  if (pack.size === 0) {
    return { ok: false, reason: 'the sound pack held no playable clips' };
  }
  return { ok: true, pack };
}

/** Every failure is reported and resolves empty; the engine carries on with fallback URLs. */
async function fetchSoundPack(fetchJson: (url: string) => Promise<unknown>): Promise<SoundPack> {
  let raw: unknown;
  try {
    raw = await fetchJson(PACK_URL);
  } catch (err) {
    diagError('could not fetch the game sound pack, cue names will be unavailable', err);
    return new Map();
  }
  const result = parseSoundPack(raw);
  if (!result.ok) {
    diagError(`could not read the game sound pack: ${result.reason}`);
    return new Map();
  }
  return result.pack;
}

/**
 * The URL for a cue with no pack entry. Degraded: a family cue has no file of its own name, and the
 * gain and cache-busting hash are lost.
 */
function fallbackCueUrl(cue: string): string {
  return `/audio/sfx/${cue}.mp3`;
}

export type { PackResult, SoundClip, SoundPack };
export { fallbackCueUrl, fetchSoundPack, PACK_URL, parseSoundPack };
