// The player's SFX volume, read (never written) from the game's settings blob, since addon sound
// bypasses the game's mixer. `interfaceSfx` is deliberately NOT applied: it mutes the game's
// click-and-hover family, and muting clicks must not silence an addon's warnings.

/** The game's own key, shape, default, and range. See src/game/settings.ts. */
const SETTINGS_KEY = 'woc_settings';
const SFX_VOLUME_FIELD = 'sfxVolume';
const DEFAULT_SFX_VOLUME = 0.8;
const MIN_VOLUME = 0;
const MAX_VOLUME = 1;

function clampVolume(value: number): number {
  return Math.max(MIN_VOLUME, Math.min(MAX_VOLUME, value));
}

/** Every failure resolves to the game's default: the blob is absent until a setting is changed. */
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

/** Read fresh on every play, so the slider is live. */
function createVolumeReader(source: VolumeSource): () => number {
  return () => readSfxVolume(source.read());
}

export type { VolumeSource };
export { clampVolume, createVolumeReader, DEFAULT_SFX_VOLUME, readSfxVolume, SETTINGS_KEY };
