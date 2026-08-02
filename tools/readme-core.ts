// The README's addon section, generated from the manifests.
//
// The section this replaced was three hand-written paragraphs, and it described
// the three addons that existed the week it was written for as long as it took
// somebody to count. Regenerating it is `pnpm readme`, and `tests/tools-readme`
// fails when the committed file and the manifests disagree, which is what makes
// this different from the version that went stale: the drift is a red run rather
// than something a reader notices a year later.
//
// The featured addons are the ones the landing page shows, from tools/featured.ts,
// because the site and the README picking different favourites is a small lie
// about what the project thinks is worth installing. How many there are is read
// from that list too, right down to the word in the sentence introducing them.
// Everything else on the page is the addon's own manifest: its name, its
// description, its screenshot and that screenshot's alt text.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CatalogAddon, isAuthorTool, pngWidth } from './catalog.ts';
import { FEATURED, spellOut } from './featured.ts';
import { ADDONS_DIR, ROOT } from './manifests.ts';
import { escapeHtml } from './site/html.ts';

/** The region `pnpm readme` owns. Everything outside it is written by hand. */
const START = '<!-- addons:start -->';
const END = '<!-- addons:end -->';

const README = join(ROOT, 'README.md');

const CATALOG_URL = 'https://woc.marshal.dev/addons';

/**
 * How wide a featured screenshot is drawn, in CSS pixels.
 *
 * A cap rather than a size. Previews are captured at whatever scale fills the
 * site's card slot, so their files run from 776px to 1904px wide and a single
 * fixed width would upscale the narrow ones into a blur. Half the file's natural
 * width is the retina reading, and the cap is what keeps a wide panel from
 * running the width of a README nobody scrolls sideways.
 */
const MAX_WIDTH = 440;

const RETINA = 2;

/** A sentence ends at a full stop followed by the start of another one. */
const SENTENCE_END = /\.\s+(?=[A-Z])/;

/**
 * The first sentence of a description, for the list of everything.
 *
 * A description runs from one line to a paragraph, and thirty paragraphs is the
 * catalog page pasted into a README. Truncating on the sentence rather than on a
 * character count is what keeps it readable: every description in this repository
 * opens by saying what the addon is, and the sentences after it qualify.
 */
function firstSentence(text: string): string {
  const found = SENTENCE_END.exec(text);
  if (!found) {
    return text;
  }
  return text.slice(0, found.index + 1);
}

/** Half the file's natural width, capped. See MAX_WIDTH. */
function previewWidth(id: string, file: string): number {
  const bytes = readFileSync(join(ADDONS_DIR, id, file));
  return Math.min(Math.round(pngWidth(bytes) / RETINA), MAX_WIDTH);
}

function link(addon: CatalogAddon): string {
  return `[${addon.name}](addons/${addon.id})`;
}

/**
 * One featured addon: a line, then its own screenshot.
 *
 * A featured addon MUST declare a preview, and this throws rather than quietly
 * emitting a nameless paragraph, for the reason the site build throws on the same
 * condition: the whole point of featuring an addon is the picture, and a silent
 * skip would leave a README that looks finished.
 */
function featuredBlock(addon: CatalogAddon): string {
  const { preview } = addon;
  if (preview === null) {
    throw new Error(`featured addon \`${addon.id}\` declares no preview; see tools/featured.ts`);
  }
  const width = previewWidth(addon.id, preview.file);
  const img =
    `<img src="addons/${addon.id}/${preview.file}" width="${width}" ` +
    `alt="${escapeHtml(preview.alt)}" />`;
  return `**${link(addon)}** — ${addon.description}\n\n${img}`;
}

function listItem(addon: CatalogAddon): string {
  return `- **${link(addon)}** — ${firstSentence(addon.description)}`;
}

/** The featured rows in the order tools/featured.ts names them. */
function chosen(catalog: readonly CatalogAddon[]): CatalogAddon[] {
  return FEATURED.map((id) => {
    const found = catalog.find((one) => one.id === id);
    if (!found) {
      throw new Error(`featured addon \`${id}\` is not in the catalog; see tools/featured.ts`);
    }
    return found;
  });
}

/**
 * The line about the addons that ship for AUTHORS rather than for players.
 *
 * Generated from the excluded rows for the reason the catalog page's line is: a
 * README that lists thirty-one while the game's Browse offers thirty-two invites
 * exactly one bug report, and hand-writing the exception is how it goes stale.
 */
function toolsLine(tools: readonly CatalogAddon[]): string[] {
  if (tools.length === 0) {
    return [];
  }
  return [
    'Shipped for people writing addons rather than playing with them, installed from ' +
      '**Addons → Browse** like anything else, and deliberately not in the list above:',
    tools.map((addon) => listItem(addon)).join('\n'),
  ];
}

/** Render the whole generated region, without its markers. */
function renderAddons(all: readonly CatalogAddon[]): string {
  const catalog = all.filter((one) => !isAuthorTool(one));
  const tools = all.filter((one) => isAuthorTool(one));
  const shown = chosen(catalog);
  const rest = catalog.filter((one) => !shown.includes(one));
  const blocks = [
    `**${catalog.length} addons ship with the loader**, reviewed and installed from inside the ` +
      `game. ${spellOut(shown.length)} of them:`,
    ...shown.map((addon) => featuredBlock(addon)),
    `### The other ${rest.length}`,
    rest.map((addon) => listItem(addon)).join('\n'),
    `[The full catalog, with a screenshot of each →](${CATALOG_URL})`,
    ...toolsLine(tools),
  ];
  return blocks.join('\n\n');
}

/**
 * Replace the generated region, leaving everything around it alone.
 *
 * A missing marker is an error rather than an append: the section has a place in
 * the document (under "What ships with it", above "For addon authors"), and a
 * generator that guessed where to put it would move it on the first edit that
 * removed a marker by accident.
 */
function spliceReadme(source: string, section: string): string {
  const from = source.indexOf(START);
  const to = source.indexOf(END);
  if (from === -1 || to === -1 || to < from) {
    throw new Error(`README.md is missing its ${START} / ${END} markers`);
  }
  const head = source.slice(0, from + START.length);
  const tail = source.slice(to);
  return `${head}\n\n${section}\n\n${tail}`;
}

function readReadme(): string {
  return readFileSync(README, 'utf8');
}

export { END, firstSentence, README, readReadme, renderAddons, START, spliceReadme };
