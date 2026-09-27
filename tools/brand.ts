// The mark as a userscript `@icon`. Inlined as a data URI because a hosted icon is a second copy
// and a request that can 404 with nothing reporting it. Read from the favicon so there is no
// third copy of the mark to keep in step.

import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The repository root, from tools/. */
const ROOT = join(import.meta.dirname, '..');

/** The mark of record, also served as the site favicon. */
const MARK = join(ROOT, 'site', 'static', 'favicon.svg');

/**
 * `@icon` for the userscript metadata block, as a self-contained data URI.
 *
 * Base64 because a metadata block is line oriented and the SVG spans several lines: unencoded, it
 * would truncate the block silently.
 */
function loaderIcon(): string {
  const svg = readFileSync(MARK, 'utf8');
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

export { loaderIcon };
