// The footer build readout is the only external surface carrying the game's
// version, and it is FORMATTED: the game strips a trailing ".0" before drawing
// it. Every case below is a real state that element passes through.

import { describe, expect, it } from 'vitest';
import { parseGameVersion, restorePatch } from '../loader/src/runtime/game-version.ts';

describe('restorePatch', () => {
  // The game's formatFooterVersion() drops a trailing ".0", so a two-part
  // version means patch zero. Left as-is it is not a semver range can match,
  // which is what the manifest gameVersion check will compare against.
  it('restores the patch the game dropped', () => {
    expect(restorePatch('0.31')).toBe('0.31.0');
  });

  it('leaves a three-part version alone', () => {
    expect(restorePatch('0.31.4')).toBe('0.31.4');
  });

  // Only a trailing .0 is dropped, so a version that genuinely ends in zero
  // patch is indistinguishable from a two-part one and must not gain a fourth.
  it('does not add a part to a version that already has three', () => {
    expect(restorePatch('1.0.0')).toBe('1.0.0');
  });
});

describe('parseGameVersion', () => {
  // What the element holds after the game's syncBuildInfo() has run.
  it('reads the version and build the game writes', () => {
    expect(parseGameVersion('v0.31 build 1a2b3c4d5e6f')).toEqual({
      version: '0.31.0',
      build: '1a2b3c4d5e6f',
    });
  });

  // What the element holds before that: the hardcoded fallback in the document,
  // which has a full version and no build at all.
  it('reads the document fallback, which carries no build', () => {
    expect(parseGameVersion('v0.31.0')).toEqual({ version: '0.31.0', build: null });
  });

  // The separator between the two is presentation. A game restyle that changes
  // it must not cost the reading.
  it('does not depend on the separator', () => {
    expect(parseGameVersion('v1.2.3 :: build abc')?.build).toBe('abc');
  });

  it('reads a prerelease patch version', () => {
    expect(parseGameVersion('v2.10.7 build zz')).toEqual({ version: '2.10.7', build: 'zz' });
  });

  it.each([
    ['an empty element', ''],
    ['an element the game never filled', 'loading'],
    ['a version with no leading v', '0.31.0'],
    ['an absent element', null],
    ['an element with no text', undefined],
  ])('answers null for %s', (_label, text) => {
    expect(parseGameVersion(text)).toBeNull();
  });
});
