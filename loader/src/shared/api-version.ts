// The loader API version this build implements. Kept out of shared/schema.ts because the runtime
// needs the value, and a value import from schema.ts drags zod into the page bundle.

export const API_VERSION = 1;

/**
 * How much surface this major has grown. A separate integer because a decimal `1.10` equals
 * `1.1`, and semver is banned in the runtime that reads it.
 *
 * A new published member moves this; a member changing shape or leaving moves API_VERSION. An
 * addon declares the minor it needs and runs on any loader implementing that or more.
 */
export const API_MINOR = 12;
