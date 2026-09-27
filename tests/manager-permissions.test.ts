// An unknown permission comes from an addon written against a newer loader, and is shown
// verbatim: dropping it would understate what the player is installing.

import { describe, expect, it } from 'vitest';
import { describePermissions } from '../loader/src/runtime/ui/manager/permissions.ts';
import { PERMISSIONS } from '../loader/src/shared/permissions.ts';

describe('describePermissions', () => {
  it('describes every permission the schema allows', () => {
    const lines = describePermissions(PERMISSIONS);

    expect(lines).toHaveLength(PERMISSIONS.length);
    expect(new Set(lines).size).toBe(PERMISSIONS.length);
    for (const line of lines) {
      expect(line).not.toBe('');
    }
  });

  it('says what a permission lets the addon see, not which API it names', () => {
    const [line] = describePermissions(['net.read']);

    expect(line).not.toContain('net.read');
    expect(line).toContain('token');
  });

  it('keeps the manifest order', () => {
    const lines = describePermissions(['storage', 'ui']);

    expect(lines).toEqual(describePermissions(['storage', 'ui']));
    expect(lines).not.toEqual(describePermissions(['ui', 'storage']));
  });

  it('shows an unknown permission verbatim rather than hiding it', () => {
    expect(describePermissions(['world.write'])).toEqual(['world.write']);
  });

  it('is empty for an addon that declares nothing', () => {
    expect(describePermissions(undefined)).toEqual([]);
    expect(describePermissions([])).toEqual([]);
  });
});
