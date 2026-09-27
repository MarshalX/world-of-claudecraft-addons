// Comparing an installed addon's version against the one a marketplace offers, with semver
// because '1.10.0' sorts before '1.9.0' as a string. Host-only despite living in shared/: semver
// must not reach the page bundle, which is why update rows are computed in the host.

import { gt as semverGt, valid as semverValid } from 'semver';

/** Prereleases participate, so 0.32.0-rc1 is newer than 0.31.0. */
const OPTS = { includePrerelease: true, loose: false } as const;

/**
 * Whether `available` is a strictly newer release than `installed`. False when either side does
 * not parse, since the badge offers a one-click re-fetch of code.
 */
export function isNewerVersion(available: string, installed: string): boolean {
  if (semverValid(available, OPTS) === null || semverValid(installed, OPTS) === null) {
    return false;
  }
  return semverGt(available, installed, OPTS);
}
