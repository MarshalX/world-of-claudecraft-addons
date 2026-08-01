// Every official addon carries its own suite, in its own directory.
//
// A repository-policy check rather than a behaviour one, and it exists because
// the failure it catches is invisible: an addon with no suite is not a red test,
// it is a green run with one fewer file in it. With one addon that is obvious and
// with thirty it is not, and the moment it stops being obvious is exactly when it
// starts happening.
//
// It reads the filesystem through tools/manifests.ts rather than directly, for
// the reason that module is TypeScript at all: `noNodejsModules` is not exempt
// under `tests/**`, so a suite cannot stat a path itself.

import { describe, expect, it } from 'vitest';
import { addonDirs, hasSuite, SUITE_FILE } from '../tools/manifests.ts';

describe('every official addon', () => {
  it(`has a ${SUITE_FILE} beside its source`, () => {
    expect(addonDirs().filter((dir) => !hasSuite(dir))).toEqual([]);
  });

  // Not an assertion about a number, which would need editing on every release.
  // It is the guard on the guard: an empty list makes the check above vacuous, so
  // a broken `addonDirs` would pass it while proving nothing.
  it('is actually being looked at', () => {
    expect(addonDirs().length).toBeGreaterThan(0);
  });
});
