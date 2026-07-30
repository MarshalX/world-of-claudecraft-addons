// What the dev server decides, separate from how it answers.
//
// The two decisions worth testing are here rather than inside a request handler:
// what the index says, and whether a path may be served at all. tools/serve.mjs
// is the socket around them.

import { createHash } from 'node:crypto';
import { join, normalize } from 'node:path';
import type { MarketplaceIndex } from '../loader/src/shared/schema.ts';
import { LOADER_FILENAME, LOADER_OUT_DIR } from './artifact.ts';
import { addonDirs, newestManifestMs, ROOT, readAddon } from './manifests.ts';

/** Matched by shared/marketplace.ts LOCAL_ORIGIN and by the userscript @connect list. */
const PORT = 5180;

/**
 * The loopback interface only.
 *
 * This server hands out file contents from the working tree and has no
 * authentication, so binding it to every interface would put the repository on
 * the local network.
 */
const HOST = '127.0.0.1';

/** Only what an addon directory legitimately contains. */
const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const DEFAULT_TYPE = 'application/octet-stream';

/** A leading slash or backslash run, which normalize does not remove. */
const LEADING_SEPARATORS = /^[/\\]+/;

/** A quoted strong validator over the given bytes. */
function etagFor(body: string | Uint8Array): string {
  return `"${createHash('sha1').update(body).digest('hex')}"`;
}

function contentType(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot < 0) {
    return DEFAULT_TYPE;
  }
  return TYPES[path.slice(dot)] ?? DEFAULT_TYPE;
}

/**
 * The index, built from addons/*\/addon.json on every call.
 *
 * Generated rather than read from the committed marketplace.json, so saving a
 * manifest is visible on the next refresh instead of waiting for `pnpm index`.
 * It also means the dev index cannot diverge from what CI would accept, since
 * both go through the same reader.
 *
 * An invalid manifest is skipped rather than failing the whole index: a server
 * that answered 500 while an author was mid-edit on one addon would take away
 * every other addon they were testing at the same time.
 */
function buildIndex(onSkipped?: (dir: string) => void): MarketplaceIndex {
  const addons: MarketplaceIndex['addons'] = [];
  const dirs = addonDirs();
  const kept: string[] = [];

  for (const dir of dirs) {
    const result = readAddon(dir);
    if (result.ok) {
      addons.push({ ...result.manifest, path: `addons/${dir}` });
      kept.push(dir);
    } else {
      onSkipped?.(dir);
    }
  }

  return {
    schema: 1,
    name: 'Local dev server',
    maintainer: 'dev',
    // The newest manifest's mtime, NOT the current time. The response body is
    // what the ETag is taken over, so a clock in it would make every index
    // request a fresh body and the conditional GET would never answer 304.
    generated: new Date(newestManifestMs(kept)).toISOString(),
    addons,
  };
}

/**
 * The absolute path one request names, or null if it is outside addons/.
 *
 * `normalize` collapses `..` before the prefix check, so the check cannot be
 * walked past by a path that only looks like it is under addons/. The trailing
 * separator in the prefix matters: without it, `addons-other/` would pass.
 */
function resolveFile(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = normalize(decoded).replace(LEADING_SEPARATORS, '');
  if (!relative.startsWith('addons/') || relative.includes('\0')) {
    return null;
  }
  return join(ROOT, relative);
}

/** The one URL outside addons/ this server answers. */
const LOADER_PATH = `/${LOADER_FILENAME}`;

/**
 * The built userscript, so the loader can be installed from a URL.
 *
 * Installing from `file://` needs a per-manager permission that is off by
 * default and moves between browser versions, which makes "did the install even
 * happen" the first thing to debug in a session that was supposed to be about
 * something else. A localhost URL is the same flow a released loader uses, and
 * `localhost` is already in the userscript's @connect list.
 *
 * ONE EXACT PATH, matched before decoding and with no directory behind it. That
 * is the whole difference from resolveFile: this cannot be walked, because there
 * is nothing to walk. Serving loader/dist as a tree would put a second
 * traversal-guarded route in a server whose only real security property is that
 * it has exactly one.
 */
function resolveLoader(pathname: string): string | null {
  if (pathname !== LOADER_PATH) {
    return null;
  }
  return join(ROOT, LOADER_OUT_DIR, LOADER_FILENAME);
}

export { buildIndex, contentType, etagFor, HOST, LOADER_PATH, PORT, resolveFile, resolveLoader };
