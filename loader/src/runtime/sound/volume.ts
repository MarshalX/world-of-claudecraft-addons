// The player's SFX volume, read from the game's own settings blob.
//
// Addon sound goes through the loader's own AudioContext rather than the game's
// mixer, so nothing connects the two automatically: without this, turning the
// SFX slider to zero would silence the game and leave addons playing. Reading
// the setting is the whole of the coupling, and it is one-way. The loader never
// writes to the game's settings.
//
// `interfaceSfx` is deliberately NOT applied. It silences one game family, the
// repetitive click-and-hover cues, rather than meaning "no interface sound"; an
// addon's alert is not that family, and a player who installed an addon for its
// warnings should not have them disappear because they muted the game's clicks.

/** The game's own key, shape, default, and range. See src/game/settings.ts. */
const SETTINGS_KEY = 'woc_settings';
const SFX_VOLUME_FIELD = 'sfxVolume';
const DEFAULT_SFX_VOLUME = 0.8;
const MIN_VOLUME = 0;
const MAX_VOLUME = 1;

function clampVolume(value: number): number {
  return Math.max(MIN_VOLUME, Math.min(MAX_VOLUME, value));
}

/**
 * Parse the SFX volume out of a raw settings blob.
 *
 * Every failure resolves to the game's own default rather than to silence or to
 * full volume: the blob is absent until the player first changes a setting, so
 * "not found" is the ordinary case for a new player and must sound the same as
 * the game does for them.
 */
function readSfxVolume(raw: string | null): number {
  if (raw === null) {
    return DEFAULT_SFX_VOLUME;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_SFX_VOLUME;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return DEFAULT_SFX_VOLUME;
  }
  const value = (parsed as Record<string, unknown>)[SFX_VOLUME_FIELD];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SFX_VOLUME;
  }
  return clampVolume(value);
}

interface VolumeSource {
  /** Null when localStorage is unreadable, which is a private-mode browser. */
  read: () => string | null;
}

/** Read fresh on every play, so moving the slider takes effect without a reload. */
function createVolumeReader(source: VolumeSource): () => number {
  return () => readSfxVolume(source.read());
}

export type { VolumeSource };
export { clampVolume, createVolumeReader, DEFAULT_SFX_VOLUME, readSfxVolume, SETTINGS_KEY };
