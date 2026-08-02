// What the stage server decides, separate from how it answers.
//
// The same split `serve-core.ts` makes, and for the same reason: a Vitest suite
// drives these directly, and `tools/stage.mjs` is only the socket around them.
//
// This is a SECOND server rather than another route on the dev one. AGENTS.md
// records that the dev server's only real security property is that it has
// exactly one route outside `addons/`, and the stage needs four plus a proxy.
// Bolting them on would spend that property to save a port.

/** Alongside serve on 5180 and site-dev on 5181. */
const STAGE_PORT = 5182;

/** Loopback only, for the reason serve-core binds there: this reads the tree. */
const STAGE_HOST = '127.0.0.1';

/** The addon list, at a name that cannot be mistaken for the real marketplace. */
const INDEX_PATH = '/index.json';

/**
 * Every path this server answers from the tree, by exact match.
 *
 * A table of exact paths rather than a directory served as a tree, which is the
 * shape `resolveLoader` takes and for the same reason: there is then nothing to
 * traverse. `addons/**` is the one directory here, and it goes through
 * serve-core's `resolveFile`, which already collapses `..` before its prefix
 * check. Entry pairs because these are file names rather than identifiers.
 */
const STAGE_FILE_PAIRS = Object.freeze([
  ['/', { file: 'stage/index.html', type: 'text/html; charset=utf-8' }],
  ['/stage.js', { file: 'stage/stage.js', type: 'text/javascript; charset=utf-8' }],
  ['/stage.css', { file: 'stage/stage.css', type: 'text/css; charset=utf-8' }],
  ['/theme.generated.css', { file: 'stage/theme.generated.css', type: 'text/css; charset=utf-8' }],
] as const);

interface StageFile {
  /** Repository-relative, so the caller joins it against its own root. */
  file: string;
  type: string;
}

const STAGE_FILES: Record<string, StageFile> = Object.fromEntries(STAGE_FILE_PAIRS);

/**
 * The path prefixes proxied to the deployed game.
 *
 * `/ui/` carries the skill and item art manifests, and `/audio/` carries the
 * sound pack. Both are read by `fetch` from the page, and neither sends an
 * `access-control-allow-origin`, so without this every icon slot on the stage
 * comes up blank and every cue is silent. That is worst for exactly the addons
 * whose screenshots are mostly icons.
 *
 * Read-only GETs to a fixed host on a loopback server, which is the whole of what
 * this is. It is not a general proxy and must not become one: a prefix added here
 * is a prefix a page on this port can reach on another origin.
 */
const PROXY_PREFIXES = Object.freeze(['/ui/', '/audio/']);

/** The game the proxy points at. PBE by default, where drift shows up first. */
const DEFAULT_GAME_HOST = 'https://pbe.worldofclaudecraft.com';

/** One served file, or null when the path is not one of them. */
function resolveStage(pathname: string): StageFile | null {
  return STAGE_FILES[pathname] ?? null;
}

/**
 * Where one request proxies to, or null when it does not.
 *
 * The built URL's origin is checked against the configured host rather than
 * trusted, because a pathname is attacker-shaped input in general even though
 * nothing here is exposed: a `//evil.example/x` pathname resolves to another
 * origin entirely, and the prefix test alone would not catch it.
 */
function proxyTarget(pathname: string, gameHost: string): string | null {
  if (!PROXY_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return null;
  }
  const target = new URL(pathname, gameHost);
  if (target.origin !== new URL(gameHost).origin) {
    return null;
  }
  return target.href;
}

export type { StageFile };
export {
  DEFAULT_GAME_HOST,
  INDEX_PATH,
  PROXY_PREFIXES,
  proxyTarget,
  resolveStage,
  STAGE_HOST,
  STAGE_PORT,
};
