// The loader API major version this build implements.
//
// Its own module, and not a constant in shared/schema.ts, because both realms
// need the VALUE. schema.ts imports zod, and a value import of anything in it
// drags the whole library into whatever bundle asks: the runtime needs this
// number to refuse an addon built against another major, and the runtime is
// injected into the game's page on every load.
//
// That is not hypothetical. M5 wired the addon lifecycle, which made
// runtime/api/index.ts reachable from the entry for the first time, and the
// single `API_VERSION` it imported from schema.ts pulled zod and its fifty
// locale files into the page bundle. loader/build-runtime.mjs failed the build,
// which is what that guard is for.

export const API_VERSION = 1;
