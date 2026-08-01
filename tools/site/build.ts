// The one module in the site generator that touches the filesystem or the
// network. Everything it calls is pure, which is what makes the rest testable.
//
// This is also the local build, and it is the REAL build: the same generator, the
// same inputs, the same output tree, with no dev-only branch anywhere in it. The
// site is not deployed until it is finished, so a generator that behaved
// differently under `site:dev` would move the first honest render of a page to
// the deploy, which is exactly what deferring the deploy is meant to prevent.

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { createHighlighter } from 'shiki';
import { ADDONS_DIR, addonDirs, readAddon } from '../manifests.ts';
import { render } from './html.ts';
import { type Context, createRenderer, type Renderer } from './markdown.ts';
import { extractRegion } from './regions.ts';
import { ROOT } from './root.ts';
import { type Page, type Site, shell } from './shell.ts';
import { type Measured, measure, parseShots, type Shot, undersizeReport } from './shots.ts';

const STYLE_ORDER = [
  'tokens.css',
  'base.css',
  'layout.css',
  'components.css',
  'steps.css',
  'surfaces.css',
  'navigation.css',
  'pages.css',
];

/** Both themes as custom properties, so switching costs no client JavaScript. */
const THEMES = { light: 'github-light', dark: 'github-dark' } as const;

const LANGS = ['javascript', 'typescript', 'json', 'css', 'html', 'yaml', 'bash', 'text'];

const PNG_SUFFIX = /\.png$/;
const LEADING_SLASH = /^\//;

/** Quality settings, picked so a screenshot's text stays crisp rather than by size. */
const AVIF_Q = 62;
const WEBP_Q = 82;

/**
 * The file a route is written to.
 *
 * Directory-style, so `/docs/patterns` resolves identically here, under
 * `site:dev`, and on Pages. A local pass that checked a different URL shape from
 * the one that ships would be the exact failure deferring the deploy is meant to
 * prevent.
 */
function outputPath(route: string): string {
  // Pages looks for exactly this filename at the artifact root; a directory-style
  // /404/index.html would never be served for a miss.
  if (route === '/404') {
    return '404.html';
  }
  if (route.endsWith('/')) {
    return `${route}index.html`.replace(LEADING_SLASH, '');
  }
  return `${route}/index.html`.replace(LEADING_SLASH, '');
}

function read(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), 'utf8');
}

function write(out: string, relative: string, body: string | Buffer): void {
  const target = join(out, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
}

/** The six sheets, concatenated in the order tools/site/build.ts declares. */
function styles(): string {
  return STYLE_ORDER.map((name) => read('site', 'assets', 'styles', name)).join('\n');
}

/** Measure every shot, and emit AVIF and WebP beside the PNG of record. */
async function shots(out: string): Promise<Map<string, Measured>> {
  const declared = parseShots(read('site', 'content', 'shots.json'), 'site/content/shots.json');
  const done = await Promise.all(
    [...declared].map(([, shot]) => encode(out, shot, { dir: SHOTS_DIR, file: shot.file })),
  );
  return new Map(done);
}

/**
 * The card slot an addon preview is shown in, in device pixels.
 *
 * One figure for every addon rather than a tuned one each, because these sit in a
 * uniform card grid: the slot is the same for all of them, so a per-addon number
 * would be the same number written thirty times.
 *
 * Previews are deliberately left OUT of the undersize report, and this is the
 * carve-out `site/content/shots.json` already describes for a fixed-size HUD
 * panel. An addon's preview is nearly always a picture of its own panel, which
 * cannot be captured wider without zooming the whole game, so measuring it
 * against a column reports a shortfall its author cannot act on. Both shipped
 * previews are exactly that, and the alternative that was tried first is worse:
 * declaring each one's own width as its target, which the comment on `measure`
 * calls out as a number that can only ever agree with itself. The figure still
 * caps at natural size, so a small panel renders small and sharp either way, and
 * what is lost is a warning nobody could have used.
 */
const PREVIEW_MIN_WIDTH = 700;

/** Where the site's own shots of record live. An addon's preview does not. */
const SHOTS_DIR = join(ROOT, 'screenshots');

/** Where a file of record lives: the directory holding it, and its name there. */
interface Source {
  readonly dir: string;
  readonly file: string;
}

/**
 * One addon's preview as a shot, or null when that addon declares none.
 *
 * The served name is prefixed rather than reusing `preview.png`, since every
 * addon names its file the same thing and they all land in one directory.
 */
function previewShot(dir: string): { shot: Shot; source: Source } | null {
  const result = readAddon(dir);
  if (!result.ok || result.manifest.preview === undefined) {
    return null;
  }
  const { preview } = result.manifest;
  return {
    shot: {
      id: dir,
      file: `addon-${dir}.png`,
      minWidth: PREVIEW_MIN_WIDTH,
      caption: null,
      alt: preview.alt,
    },
    source: { dir: join(ADDONS_DIR, dir), file: preview.file },
  };
}

/**
 * The addon previews, encoded from each addon's own directory.
 *
 * They are NOT in `site/content/shots.json` and must not be: an addon's preview
 * is declared by its `addon.json`, beside the file, which is the same manifest
 * the loader validates and the manager reads. Listing them again here would be a
 * second place for the alt text to go stale, and the whole point of the catalog
 * page is that nothing about an addon is written twice.
 */
async function previews(out: string): Promise<Map<string, Measured>> {
  const declared = addonDirs()
    .map((dir) => previewShot(dir))
    .filter((one) => one !== null);
  return new Map(await Promise.all(declared.map((one) => encode(out, one.shot, one.source))));
}

/**
 * Copy one PNG through and write its two derivatives.
 *
 * `source` is where the file of record lives, which is `screenshots/` for
 * anything the manifest declares and the addon's own directory for a preview. Its
 * name there differs from the served name only for a preview.
 */
async function encode(out: string, shot: Shot, source: Source): Promise<[string, Measured]> {
  const path = join(source.dir, source.file);
  const image = sharp(path);
  const { width = 0, height = 0 } = await image.metadata();
  const sized = measure(shot, { width, height });
  // The PNG is copied through as the last fallback and as what the README links.
  write(out, `shots/${shot.file}`, readFileSync(path));
  // One derivative each, at the SERVED width rather than the file's: a shot is
  // never sent wider than its slot needs. The figure caps at half of that, so what
  // arrives is exactly the 2x asset and a second density would be a third copy of
  // a file nothing asks for.
  const stem = shot.file.replace(PNG_SUFFIX, '');
  const fit = image.resize({ width: sized.served, withoutEnlargement: true });
  write(out, `shots/${stem}.avif`, await fit.clone().avif({ quality: AVIF_Q }).toBuffer());
  write(out, `shots/${stem}.webp`, await fit.webp({ quality: WEBP_Q }).toBuffer());
  return [shot.id, sized];
}

/** Resolve a `shot:` id or an `include:` path, failing the build when either is gone. */
function context(
  measured: ReadonlyMap<string, Measured>,
  shown: ReadonlyMap<string, Measured>,
): Context {
  return {
    shot(id) {
      const found = measured.get(id);
      if (!found) {
        throw new Error(`unknown shot \`${id}\`; add it to site/content/shots.json`);
      }
      return found;
    },
    preview(id) {
      const found = shown.get(id);
      if (!found) {
        throw new Error(`addon \`${id}\` declares no preview; add one to addons/${id}/addon.json`);
      }
      return found;
    },
    include(path, region) {
      const source = read(path);
      if (region === null) {
        return source.trimEnd();
      }
      return extractRegion(source, region, path);
    },
  };
}

/** Fall back rather than throw: an unhighlighted block beats a failed build. */
function known(loaded: readonly string[], lang: string): string {
  if (loaded.includes(lang)) {
    return lang;
  }
  return 'text';
}

async function renderer(): Promise<Renderer> {
  const highlighter = await createHighlighter({ themes: Object.values(THEMES), langs: LANGS });
  return createRenderer((code, lang) =>
    highlighter.codeToHtml(code, {
      lang: known(highlighter.getLoadedLanguages(), lang),
      themes: THEMES,
      defaultColor: false,
    }),
  );
}

/** Copy a tree into the output under `prefix`, skipping the stylesheet sources. */
function copyTree(out: string, dir: string, prefix: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && !entry.parentPath.endsWith('styles')) {
      const from = join(entry.parentPath, entry.name);
      write(out, `${prefix}${from.slice(dir.length + 1)}`, readFileSync(from));
    }
  }
}

/** Everything a page builder is handed. */
export interface Build {
  readonly site: Site;
  readonly styles: string;
  readonly shots: ReadonlyMap<string, Measured>;
  /**
   * One addon's preview, by addon id.
   *
   * Separate from `shots` rather than merged into it, because the two have
   * different owners: a shot is declared in `site/content/shots.json` and is the
   * site's own, while a preview is declared in an `addon.json` and belongs to the
   * addon. Merging them would let a prose page reference a preview by id and so
   * make an addon's screenshot load-bearing for a docs page.
   */
  readonly previews: ReadonlyMap<string, Measured>;
  readonly markdown: Renderer;
  readonly context: Context;
  readonly emit: (page: Page) => void;
  /** Undersized screenshots and anything else worth saying at the end of a build. */
  readonly warnings: () => readonly string[];
}

/**
 * Prepare a build: clear the output, process images, load the highlighter.
 *
 * Returns the handle every page builder writes through, plus the warnings
 * collected on the way. Undersized screenshots are REPORTED, never fatal: a hard
 * failure on a small shot fires during ordinary work and gets switched off, while
 * a list printed at the end of a build is a signal that survives.
 */
export async function prepare(outDir: string): Promise<Build> {
  const out = join(ROOT, outDir);
  rmSync(out, { recursive: true, force: true });
  const sheet = styles();
  const measured = await shots(out);
  const shown = await previews(out);
  const warnings = undersizeReport([...measured.values()]);
  const build: Build = {
    site: SITE,
    styles: sheet,
    shots: measured,
    previews: shown,
    markdown: await renderer(),
    context: context(measured, shown),
    emit(page) {
      write(out, outputPath(page.path), render(shell(page, SITE, sheet)));
    },
    warnings: () => warnings,
  };
  return build;
}

/**
 * Copy the two asset trees.
 *
 * `site/assets` lands under /assets. `site/static` lands at the ROOT, because
 * some files only work there: a favicon by convention, robots.txt and CNAME by
 * requirement, and 404.html because that is where Pages looks for it.
 *
 * CNAME is emitted into the ARTIFACT rather than kept only at the repository
 * root, because the artifact is what Pages serves. A CNAME that exists in the
 * tree but not in the upload is a custom domain that silently stops resolving on
 * the next deploy.
 */
export function copyAssets(outDir: string): void {
  const out = join(ROOT, outDir);
  copyTree(out, join(ROOT, 'site', 'assets'), 'assets/');
  copyTree(out, join(ROOT, 'site', 'static'), '');
}

export const SITE: Site = {
  name: 'ClaudeCraft Addons',
  origin: 'https://woc.marshal.dev',
  repo: 'https://github.com/MarshalX/world-of-claudecraft-addons',
};
