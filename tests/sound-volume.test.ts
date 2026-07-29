// Reading the player's SFX slider out of the game's settings blob.
//
// Every failure path resolves to the game's own default rather than to silence
// or to full volume. The blob does not exist until the player first changes a
// setting, so "not found" is the ordinary case for a new player and has to
// sound exactly like the game does for them.

import { describe, expect, it } from 'vitest';
import {
  clampVolume,
  createVolumeReader,
  DEFAULT_SFX_VOLUME,
  readSfxVolume,
  SETTINGS_KEY,
} from '../loader/src/runtime/sound/volume.ts';

describe('readSfxVolume', () => {
  it('reads the slider out of a real settings blob', () => {
    const blob = JSON.stringify({
      cameraSpeed: 0.7,
      sfxVolume: 0.35,
      musicVolume: 0.8,
      interfaceSfx: true,
    });

    expect(readSfxVolume(blob)).toBeCloseTo(0.35);
  });

  it('reads a deliberate mute as a mute rather than as absent', () => {
    expect(readSfxVolume(JSON.stringify({ sfxVolume: 0 }))).toBe(0);
  });

  it.each([
    ['no blob at all', null],
    ['a corrupt blob', '{not json'],
    ['a blob that is not an object', '42'],
    ['a blob that is null', 'null'],
    ['a blob with no sfxVolume', '{"musicVolume":0.5}'],
    ['a non-numeric sfxVolume', '{"sfxVolume":"loud"}'],
    ['a NaN sfxVolume', '{"sfxVolume":null}'],
  ])('falls back to the game default for %s', (_case, raw) => {
    expect(readSfxVolume(raw)).toBe(DEFAULT_SFX_VOLUME);
  });

  it('clamps a blob edited outside the game', () => {
    expect(readSfxVolume('{"sfxVolume":9}')).toBe(1);
    expect(readSfxVolume('{"sfxVolume":-3}')).toBe(0);
  });

  it('matches the range and default the game itself declares', () => {
    expect(DEFAULT_SFX_VOLUME).toBe(0.8);
    expect(SETTINGS_KEY).toBe('woc_settings');
    expect(clampVolume(0.5)).toBe(0.5);
  });
});

describe('createVolumeReader', () => {
  // Read per play rather than cached, so moving the slider takes effect without
  // a reload. A cached reader would pass every test above and still be wrong.
  it('re-reads storage on every call', () => {
    let raw = '{"sfxVolume":0.2}';
    const volume = createVolumeReader({ read: () => raw });

    expect(volume()).toBeCloseTo(0.2);
    raw = '{"sfxVolume":0.9}';
    expect(volume()).toBeCloseTo(0.9);
  });

  it('answers the default when localStorage is unreadable', () => {
    expect(createVolumeReader({ read: () => null })()).toBe(DEFAULT_SFX_VOLUME);
  });
});
