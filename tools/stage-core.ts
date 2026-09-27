// What the stage server decides, separate from how it answers: a Vitest suite drives this, and
// `tools/stage.mjs` is the socket around it. A SECOND server rather than routes on the dev one,
// whose only real security property is having exactly one route outside `addons/`.

/** Alongside serve on 5180 and site-dev on 5181. */
const STAGE_PORT = 5182;

/** Loopback only, for the reason serve-core binds there: this reads the tree. */
const STAGE_HOST = '127.0.0.1';

/** The addon list, at a name that cannot be mistaken for the real marketplace. */
const INDEX_PATH = '/index.json';

/**
 * Every path this server answers from the tree, by exact match, so there is nothing to traverse.
 * `addons/**` is the one directory, and it goes through serve-core's `resolveFile`. Entry pairs
 * because these are file names rather than identifiers.
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
 * The path prefixes proxied to the deployed game: the art manifests and the sound pack, which the
 * game serves without `access-control-allow-origin`. Not a general proxy and must not become one:
 * a prefix added here is a prefix a page on this port can reach on another origin.
 */
const PROXY_PREFIXES = Object.freeze(['/ui/', '/audio/']);

/** The game the proxy points at. PBE by default, where drift shows up first. */
const DEFAULT_GAME_HOST = 'https://pbe.worldofclaudecraft.com';

/** One served file, or null when the path is not one of them. */
function resolveStage(pathname: string): StageFile | null {
  return STAGE_FILES[pathname] ?? null;
}

/**
 * Where one request proxies to, or null when it does not. The built origin is checked because a
 * `//evil.example/x` pathname resolves to another origin and passes the prefix test.
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
