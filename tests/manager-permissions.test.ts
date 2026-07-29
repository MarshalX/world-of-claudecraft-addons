// Turning a manifest's declared permissions into sentences a player can weigh.
//
// The case that matters is a value this loader does not know, which is what an
// addon written against a newer loader looks like. Dropping it would understate
// what is being installed at exactly the moment the player is deciding, so it is
// shown verbatim instead.

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

  // The player has no reason to know what `net.read` names, so the line has to
  // be about what the addon can see rather than about the API it calls.
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
