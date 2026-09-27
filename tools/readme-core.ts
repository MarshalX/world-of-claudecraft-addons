// The README's addon section, generated from the manifests. The featured addons come from
// tools/featured.ts, shared with the landing page; everything else is the addon's own manifest.

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
 * The widest a featured screenshot is drawn, in CSS pixels. A cap rather than a size, because
 * previews are captured at varying scales and a fixed width would upscale the narrow ones.
 */
const MAX_WIDTH = 440;

const RETINA = 2;

/** A sentence ends at a full stop followed by the start of another one. */
const SENTENCE_END = /\.\s+(?=[A-Z])/;

/** The first sentence of a description, for the list of everything. */
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

/** One featured addon: a line, then its own screenshot. Throws when it declares no preview. */
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

/** The line naming the addons that ship for AUTHORS, so the README count matches Browse. */
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

/** Replace the generated region, leaving everything around it alone. Throws on a missing marker. */
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
