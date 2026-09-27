// The game's version and build, from the footer syncBuildInfo() fills in ("v0.31 build 1a2b3c").
// There is no global; the version is compiled in. Before boot the footer holds a fallback with no
// build id, and the game strips a trailing ".0", which must be restored before a range compare.

/** Tolerant: the separator is presentation and the build segment appears only after boot. */
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
