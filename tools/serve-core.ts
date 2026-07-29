// What the dev server decides, separate from how it answers.
//
// The two decisions worth testing are here rather than inside a request handler:
// what the index says, and whether a path may be served at all. tools/serve.mjs
// is the socket around them.

import { createHash } from 'node:crypto';
import { join, normalize } from 'node:path';
import type { MarketplaceIndex } from '../loader/src/shared/schema.ts';
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

export { buildIndex, contentType, etagFor, HOST, PORT, resolveFile };
