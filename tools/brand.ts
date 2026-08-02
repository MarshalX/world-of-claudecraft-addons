// The mark, in the one form a userscript manager can render.
//
// A metadata block with no `@icon` gets the manager's own placeholder, so the
// loader sat in Violentmonkey's script list under a generic glyph and in
// Tampermonkey's dashboard under a blank tile: identical to every other script
// installed, and the one place a player looks to confirm the loader is the thing
// that is running.
//
// A data URI rather than a URL. Hosting the icon would put a second copy of the
// mark somewhere, which is the drift AGENTS.md keeps naming, and it would make
// the manager's list view depend on a request that can fail: the previous
// download URL was a 404 no manager reports, and an icon that 404s is the same
// silence one level quieter. Inline, it costs nothing, works offline, and is
// exactly as old as the build.
//
// Read from the favicon rather than written out here, for the reason the site's
// stylesheet says beside `.lockup::before`: that rule and `favicon.svg` are
// already one mark with two renderers, and a base64 blob pasted into
// vite.config.ts would be a third that nothing could keep in step.

import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The repository root, from tools/. */
const ROOT = join(import.meta.dirname, '..');

/**
 * The mark of record.
 *
 * `site/static/` lands at the site root, so this same file is what the site
 * serves as its favicon. One file, two consumers, neither holding a copy.
 */
const MARK = join(ROOT, 'site', 'static', 'favicon.svg');

/**
 * `@icon` for the userscript metadata block, as a self-contained data URI.
 *
 * Base64 rather than raw or percent-encoded markup. A metadata block is line
 * oriented: every directive is one `// @key value` line and the block ends at
 * the first line that is not one. The mark is authored across five lines, so an
 * unencoded SVG would end the `@icon` line inside its opening tag and leave the
 * rest of the markup outside the block entirely, which no manager reports as an
 * error because a truncated block is a valid one.
 */
function loaderIcon(): string {
  const svg = readFileSync(MARK, 'utf8');
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

export { loaderIcon };
