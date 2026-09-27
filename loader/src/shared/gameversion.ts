// gameVersion range evaluation. Every call passes `includePrerelease`, or '>=0.31.0' would not
// match a prerelease such as '0.32.0-rc1'.

import { satisfies as semverSatisfies, valid as semverValid, validRange } from 'semver';

const SATISFIES_OPTS = { includePrerelease: true, loose: false } as const;

/** Whether a range string is well-formed. Empty is refused, though semver reads it as '*'. */
export function isValidRange(range: string): boolean {
  if (range.trim().length === 0) {
    return false;
  }
  return validRange(range, SATISFIES_OPTS) !== null;
}

/**
 * Whether the running game version satisfies an addon's `gameVersion` range. An unparseable
 * version or range answers true so it never hides an addon; false is advisory, never a block.
 */
export function satisfiesGameVersion(version: string, range: string | undefined): boolean {
  if (range === undefined) {
    return true;
  }
  if (!isValidRange(range)) {
    return true;
  }
  // satisfies() answers false for an unparseable version, which would hide the addon.
  if (semverValid(version, SATISFIES_OPTS) === null) {
    return true;
  }
  return semverSatisfies(version, range, SATISFIES_OPTS);
}
