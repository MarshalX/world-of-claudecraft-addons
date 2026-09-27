// The one module in the site generator that touches the filesystem or the network; everything
// it calls is pure. `site:dev` runs this same build, so never add a dev-only branch here.

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
  'addon.css',
];

/** Both themes as custom properties, so switching costs no client JavaScript. */
const THEMES = { light: 'github-light', dark: 'github-dark' } as const;

const LANGS = ['javascript', 'typescript', 'json', 'css', 'html', 'yaml', 'bash', 'text'];

const LEADING_SLASH = /^\//;

/** Picked so a screenshot's text stays crisp. */
const AVIF_Q = 62;
const WEBP_Q = 82;

/** The file a route is written to, directory-style so it resolves the same here and on Pages. */
function outputPath(route: string): string {
  // Pages serves a miss from exactly this filename; /404/index.html would never be served.
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

/** The stylesheets, concatenated in STYLE_ORDER. */
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
 * The catalog card slot an addon preview is shown in, in device pixels, one figure for the
 * uniform grid.
 *
 * Previews stay out of the undersize report: a preview pictures a fixed-size panel that cannot be
 * captured wider without zooming the game, so a shortfall is not actionable.
 */
const PREVIEW_MIN_WIDTH = 700;

/**
 * The same preview on the addon's own page, in device pixels: the 1120px content column less its
 * 24px gutters, times two.
 *
 * It is a second encode because the slots differ threefold: one file would either triple the
 * catalog's load or blur the page.
 */
const PREVIEW_PAGE_WIDTH = 2144;

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
function previewShot(dir: string, wide: boolean): { shot: Shot; source: Source } | null {
  const result = readAddon(dir);
  if (!result.ok || result.manifest.preview === undefined) {
    return null;
  }
  const { preview } = result.manifest;
  const base = {
    id: dir,
    file: `addon-${dir}.png`,
    caption: null,
    alt: preview.alt,
  };
  const sized = { minWidth: PREVIEW_MIN_WIDTH };
  const source = { dir: join(ADDONS_DIR, dir), file: preview.file };
  if (wide) {
    return {
      shot: { ...base, minWidth: PREVIEW_PAGE_WIDTH, stem: `addon-${dir}-wide` },
      source,
    };
  }
  return { shot: { ...base, ...sized }, source };
}

/**
 * The addon previews, encoded from each addon's own directory.
 *
 * Never list them in `site/content/shots.json`: the preview is declared once, in `addon.json`.
 */
async function previews(out: string, wide: boolean): Promise<Map<string, Measured>> {
  const declared = addonDirs()
    .map((dir) => previewShot(dir, wide))
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
  // One derivative each at the SERVED width, which is exactly the 2x asset. Take the stem from
  // `measure`: deriving it from the PNG would let the two preview widths silently overwrite
  // each other.
  const { stem } = sized;
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
   * One addon's preview, by addon id. Kept apart from `shots` so a docs page cannot reference an
   * addon's screenshot by id.
   */
  readonly previews: ReadonlyMap<string, Measured>;
  /**
   * The same previews at PREVIEW_PAGE_WIDTH, for an addon's own page and the landing page's
   * feature rows.
   */
  readonly previewsWide: ReadonlyMap<string, Measured>;
  readonly markdown: Renderer;
  readonly context: Context;
  readonly emit: (page: Page) => void;
  /** Undersized screenshots and anything else worth saying at the end of a build. */
  readonly warnings: () => readonly string[];
}

/**
 * Prepare a build: clear the output, process images, load the highlighter.
 *
 * Undersized screenshots are reported, never fatal: a hard failure fires during ordinary work
 * and gets switched off.
 */
export async function prepare(outDir: string): Promise<Build> {
  const out = join(ROOT, outDir);
  rmSync(out, { recursive: true, force: true });
  const sheet = styles();
  const measured = await shots(out);
  const shown = await previews(out, false);
  const large = await previews(out, true);
  const warnings = undersizeReport([...measured.values()]);
  const build: Build = {
    site: SITE,
    styles: sheet,
    shots: measured,
    previews: shown,
    previewsWide: large,
    markdown: await renderer(),
    context: context(measured, large),
    emit(page) {
      write(out, outputPath(page.path), render(shell(page, SITE, sheet)));
    },
    warnings: () => warnings,
  };
  return build;
}

/**
 * Copy the two asset trees: `site/assets` under /assets, `site/static` at the root, where a
 * favicon, robots.txt and CNAME have to be.
 *
 * CNAME must be in the uploaded artifact; without it the custom domain stops resolving on the next
 * deploy.
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
