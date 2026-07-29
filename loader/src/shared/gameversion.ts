// gameVersion range evaluation.
//
// Every call passes `includePrerelease`. Without it semver counts a prerelease
// as satisfying a range only when the range names that same major.minor.patch,
// so '>=0.31.0' would not match the PBE build '0.32.0-rc1'.

import { satisfies as semverSatisfies, valid as semverValid, validRange } from 'semver';

const SATISFIES_OPTS = { includePrerelease: true, loose: false } as const;

/**
 * Whether a range string is well-formed.
 *
 * The empty string is rejected even though semver accepts it as an alias for
 * '*', so an empty `gameVersion` surfaces as an error instead of silently
 * matching everything.
 */
export function isValidRange(range: string): boolean {
  if (range.trim().length === 0) {
    return false;
  }
  return validRange(range, SATISFIES_OPTS) !== null;
}

/**
 * Whether the running game version satisfies an addon's `gameVersion` range.
 *
 * An unparseable version or range returns true, so a malformed constraint never
 * hides an addon. Callers treat a false result as an advisory, not a block.
 */
export function satisfiesGameVersion(version: string, range: string | undefined): boolean {
  if (range === undefined) {
    return true;
  }
  if (!isValidRange(range)) {
    return true;
  }
  // semver.satisfies returns false for an unparseable version rather than
  // throwing, so the version needs its own check.
  if (semverValid(version, SATISFIES_OPTS) === null) {
    return true;
  }
  return semverSatisfies(version, range, SATISFIES_OPTS);
}
