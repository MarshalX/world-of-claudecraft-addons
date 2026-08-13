// The loader API major version this build implements.
//
// Its own module, and not a constant in shared/schema.ts, because both realms
// need the VALUE. schema.ts imports zod, and a value import of anything in it
// drags the whole library into whatever bundle asks: the runtime needs this
// number to refuse an addon built against another major, and the runtime is
// injected into the game's page on every load.
//
// That is not hypothetical. Wiring the addon lifecycle made runtime/api/index.ts
// reachable from the entry for the first time, and the single `API_VERSION` it
// imported from schema.ts pulled zod and its fifty locale files into the page
// bundle. loader/build-runtime.mjs failed the build, which is what that guard is
// for. shared/permissions.ts exists for the same reason, one release later.

export const API_VERSION = 1;

/**
 * How much surface this major has grown, bumped by every ADDITIVE change.
 *
 * A separate integer rather than a decimal on the major, because a decimal is
 * silently wrong the tenth time it is bumped: `1.10` parses to the same double as
 * `1.1`, so the tenth additive release would collide with the first, and it also
 * orders 1.10 BELOW 1.9. This repo already carries that lesson for strings, where
 * `1.10.0` sorts before `1.9.0`, which is why real version comparison lives in the
 * host behind semver. The check that reads this runs in the RUNTIME, where semver
 * is a banned import, so two plain integers is the encoding that is trivially
 * right with nothing to import.
 *
 * The rule for bumping: a new member on the published surface moves this, and a
 * member changing shape or leaving moves API_VERSION instead. An addon declares
 * the minor it needs and runs on any loader implementing that or more.
 */
export const API_MINOR = 6;
