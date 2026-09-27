// Every official addon carries its own suite: a missing one is a green run with one fewer file.
// The filesystem is read through tools/manifests.ts because `noNodejsModules` applies here.

import { describe, expect, it } from 'vitest';
import { addonDirs, hasSuite, SUITE_FILE } from '../tools/manifests.ts';

describe('every official addon', () => {
  it(`has a ${SUITE_FILE} beside its source`, () => {
    expect(addonDirs().filter((dir) => !hasSuite(dir))).toEqual([]);
  });

  // An empty list would make the check above pass vacuously.
  it('is actually being looked at', () => {
    expect(addonDirs().length).toBeGreaterThan(0);
  });
});
