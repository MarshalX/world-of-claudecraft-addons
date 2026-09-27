// Deciding whether a marketplace offers something newer than what is installed.

import { describe, expect, it } from 'vitest';
import { isNewerVersion } from '../loader/src/shared/version.ts';

describe('isNewerVersion', () => {
  it('reports a higher patch, minor, and major', () => {
    expect(isNewerVersion('1.2.1', '1.2.0')).toBe(true);
    expect(isNewerVersion('1.3.0', '1.2.9')).toBe(true);
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
  });

  it('orders 1.10.0 above 1.9.0, which a string comparison does not', () => {
    expect('1.10.0' > '1.9.0').toBe(false);
    expect(isNewerVersion('1.10.0', '1.9.0')).toBe(true);
  });

  it('reports nothing for the same version', () => {
    expect(isNewerVersion('1.2.0', '1.2.0')).toBe(false);
  });

  it('does not offer a downgrade as an update', () => {
    expect(isNewerVersion('1.1.0', '1.2.0')).toBe(false);
  });

  it('counts a prerelease of a higher version as newer', () => {
    expect(isNewerVersion('0.32.0-rc1', '0.31.0')).toBe(true);
    expect(isNewerVersion('1.2.0', '1.2.0-rc1')).toBe(true);
    expect(isNewerVersion('1.2.0-rc2', '1.2.0-rc1')).toBe(true);
  });

  // The badge invites a re-fetch of code, which an unparseable version does not justify.
  it('reports nothing when either side does not parse', () => {
    expect(isNewerVersion('nightly', '1.2.0')).toBe(false);
    expect(isNewerVersion('1.2.0', 'nightly')).toBe(false);
    expect(isNewerVersion('', '1.2.0')).toBe(false);
    expect(isNewerVersion('2.0', '1.2.0')).toBe(false);
  });
});
