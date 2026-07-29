// Comparing an installed addon's version against the one a marketplace offers.
//
// semver rather than a string comparison, because the case a string comparison
// gets wrong is silent and common: '1.10.0' sorts BEFORE '1.9.0'
// lexicographically, so the badge would simply never appear for the tenth
// release of a minor line.
//
// Like shared/gameversion.ts and shared/schema.ts this is a HOST-side module
// despite living in shared/. semver must not reach the page bundle any more than
// zod may, and loader/build-runtime.mjs is what enforces it. That is also why
// update rows are computed in the host and carried over the bridge rather than
// derived in the manager from two lists it already holds.

import { gt as semverGt, valid as semverValid } from 'semver';

/**
 * Prereleases participate, so 0.32.0-rc1 is newer than 0.31.0.
 *
 * The same option the gameVersion check passes, and for the same reason: this
 * project ships prereleases to PBE and a comparison that ignores them reports
 * nothing during exactly the period an author is iterating.
 */
const OPTS = { includePrerelease: true, loose: false } as const;

/**
 * Whether `available` is a strictly newer release than `installed`.
 *
 * False when either side does not parse. An unreadable version must not be
 * badged as having an update: the badge offers a one-click re-fetch of code, and
 * "these two cannot be compared" is not a reason to invite that. It also means a
 * marketplace that publishes a lower version than the one installed reports
 * nothing rather than offering a downgrade dressed as an update.
 */
export function isNewerVersion(available: string, installed: string): boolean {
  if (semverValid(available, OPTS) === null || semverValid(installed, OPTS) === null) {
    return false;
  }
  return semverGt(available, installed, OPTS);
}
