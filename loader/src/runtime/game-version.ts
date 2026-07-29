// The running game's version and build, read from the page.
//
// The game compiles __APP_VERSION__ and __APP_BUILD_ID__ in as Vite defines, so
// there is no global to ask. The only external surface is the footer element the
// game's syncBuildInfo() fills in, which reads "v0.31 build 1a2b3c4d5e6f".
//
// Two things about that text are load-bearing. It is written by the game after
// its own boot, so before then the element still holds the hardcoded fallback
// from the document and carries no build id at all. And the version is
// FORMATTED: the game strips a trailing ".0" before displaying it, so "0.31.0"
// reaches the page as "0.31" and has to be restored to three parts before
// anything compares it to a manifest's gameVersion range.

/**
 * Tolerant on purpose. The separator between version and build is presentation
 * that a game update may restyle, and the build segment is absent until
 * syncBuildInfo() runs, so neither is part of the match.
 */
const VERSION_TEXT = /^\s*v(\d+\.\d+(?:\.\d+)?)\b(?:.*?\bbuild\s+(\S+))?/;

const FULL_VERSION_PARTS = 3;

interface GameVersion {
  /** Always three parts, with the patch the game's formatter dropped restored. */
  version: string;
  /** Absent until the game has filled the footer in. */
  build: string | null;
}

/** Undo the game's display formatting, which drops a trailing ".0". */
function restorePatch(version: string): string {
  if (version.split('.').length < FULL_VERSION_PARTS) {
    return `${version}.0`;
  }
  return version;
}

function parseGameVersion(text: string | null | undefined): GameVersion | null {
  if (typeof text !== 'string') {
    return null;
  }
  const match = VERSION_TEXT.exec(text);
  if (match?.[1] === undefined) {
    return null;
  }
  return { version: restorePatch(match[1]), build: match[2] ?? null };
}

export type { GameVersion };
export { parseGameVersion, restorePatch };
