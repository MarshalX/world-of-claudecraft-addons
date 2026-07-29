import { describe, expect, it } from 'vitest';

import { isValidRange, satisfiesGameVersion } from '../loader/src/shared/gameversion.ts';

describe('isValidRange', () => {
  it.each(['>=0.31.0', '^0.31.0', '~0.31.0', '>=0.31.0 <0.33.0', '0.31.x', '*'])(
    'accepts %s',
    (range) => {
      expect(isValidRange(range)).toBe(true);
    },
  );

  it.each(['not a range', '>>0.31.0', ''])('rejects %j', (range) => {
    expect(isValidRange(range)).toBe(false);
  });
});

describe('satisfiesGameVersion', () => {
  it('matches a simple comparator', () => {
    expect(satisfiesGameVersion('0.31.0', '>=0.31.0')).toBe(true);
    expect(satisfiesGameVersion('0.30.9', '>=0.31.0')).toBe(false);
  });

  it('matches caret and range syntax', () => {
    expect(satisfiesGameVersion('0.31.5', '^0.31.0')).toBe(true);
    expect(satisfiesGameVersion('0.32.0', '>=0.31.0 <0.33.0')).toBe(true);
    expect(satisfiesGameVersion('0.33.0', '>=0.31.0 <0.33.0')).toBe(false);
  });

  // semver's default returns false here, since a prerelease only satisfies a
  // range naming its own tuple. PBE ships prereleases, so an addon declaring
  // '>=0.31.0' has to run on 0.32.0-rc1.
  it('matches a PBE prerelease build against a plain range', () => {
    expect(satisfiesGameVersion('0.32.0-rc1', '>=0.31.0')).toBe(true);
    expect(satisfiesGameVersion('0.32.0-pbe.3', '^0.31.0')).toBe(false);
  });

  it('still respects the lower bound for prereleases', () => {
    expect(satisfiesGameVersion('0.30.0-rc1', '>=0.31.0')).toBe(false);
  });

  it('treats an absent range as unconstrained', () => {
    expect(satisfiesGameVersion('0.31.0', undefined)).toBe(true);
  });

  // A malformed constraint must never silently hide an addon.
  it.each(['not a range', ''])('treats the malformed range %j as unconstrained', (range) => {
    expect(satisfiesGameVersion('0.31.0', range)).toBe(true);
  });

  it('treats an unparseable game version as unconstrained', () => {
    expect(satisfiesGameVersion('unknown', '>=0.31.0')).toBe(true);
  });
});
