// What the dev server decides (the index, and whether a path may be served), separate from the
// socket in tools/serve.mjs.

import { createHash } from 'node:crypto';
import { join, normalize } from 'node:path';
import type { MarketplaceIndex } from '../loader/src/shared/schema.ts';
import { LOADER_FILENAME, LOADER_OUT_DIR } from './artifact.ts';
import { addonDirs, newestManifestMs, ROOT, readAddon } from './manifests.ts';

/** Matched by shared/marketplace.ts LOCAL_ORIGIN and by the userscript @connect list. */
const PORT = 5180;

/** Loopback only: the server has no authentication and serves the working tree. */
const HOST = '127.0.0.1';

/** Only what an addon directory legitimately contains. */
const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  // An addon's preview; as application/octet-stream it would not render behind nosniff.
  '.png': 'image/png',
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
 * The index, built from addons/*\/addon.json on every call so a saved manifest shows on the next
 * refresh. An invalid manifest is skipped so one mid-edit addon does not take down the rest.
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
    // An mtime, NOT the clock: the ETag is taken over the body, so a clock would defeat the 304.
    generated: new Date(newestManifestMs(kept)).toISOString(),
    addons,
  };
}

/**
 * The absolute path one request names, or null if it is outside addons/. `normalize` runs before
 * the prefix check, and the prefix keeps its trailing slash so `addons-other/` fails.
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
 * The built userscript, so the loader installs from a URL rather than `file://`. ONE EXACT PATH,
 * matched before decoding: do not serve loader/dist as a tree, which would add a second route that
 * needs a traversal guard.
 */
function resolveLoader(pathname: string): string | null {
  if (pathname !== LOADER_PATH) {
    return null;
  }
  return join(ROOT, LOADER_OUT_DIR, LOADER_FILENAME);
}

export { buildIndex, contentType, etagFor, HOST, LOADER_PATH, PORT, resolveFile, resolveLoader };
