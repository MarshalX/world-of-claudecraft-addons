// `pnpm site`: build the static site into site/dist.
//
// The socket around tools/site/build.ts, which is where every decision lives.
// This file reads argv, drives the page list, and prints what happened.
//
// The release is read from GitHub at build time and is ALLOWED to be absent:
// package.json stays at 0.0.0 on purpose (the tag is the only source of a release
// version, see vite.config.ts), so falling back to it would put an install button
// advertising 0.0.0 on the landing page. Absent means no version chip.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { addonDirs, readAddon } from './manifests.ts';
import { copyAssets, prepare, SITE } from './site/build.ts';
import { loadDocs } from './site/docs-source.ts';
import { addons } from './site/pages/addons.ts';
import { changelog } from './site/pages/changelog.ts';
import { docsPage } from './site/pages/docs.ts';
import { install } from './site/pages/install.ts';
import { landing } from './site/pages/landing.ts';
import { notFound } from './site/pages/not-found.ts';
import { ROOT } from './site/root.ts';

const OUT = 'site/dist';
const ORIGIN = SITE.origin;

const BYTES_PER_KB = 1024;

/** Bytes to the size a person reads. */
function humanSize(bytes) {
  return `${Math.round(bytes / BYTES_PER_KB)} kB`;
}

/**
 * The current release, or null when there is none.
 *
 * Network failure and "no release yet" are deliberately the same answer: the
 * button renders without a chip either way, and a build that fails because
 * GitHub was slow is a build that cannot run offline.
 */
async function readRelease() {
  const url = 'https://api.github.com/repos/MarshalX/world-of-claudecraft-addons/releases/latest';
  try {
    const response = await fetch(url, { headers: { accept: 'application/vnd.github+json' } });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    const asset = (data.assets ?? []).find((one) => one.name === 'woc-loader.user.js');
    if (!asset) {
      return null;
    }
    return { version: data.tag_name, size: humanSize(asset.size) };
  } catch {
    return null;
  }
}

/**
 * robots.txt and a sitemap, both derived from the page list.
 *
 * Generated rather than committed for the same reason everything else here is: a
 * hand-kept sitemap is a second list of pages, and it is the one that goes stale.
 * The 404 is excluded, since a search engine indexing it is the point of failure
 * the file exists to avoid.
 */
function writeStatics(out, pages) {
  const routes = pages.filter((page) => page.path !== '/404').map((page) => page.path);
  const urls = routes.map((route) => `  <url><loc>${ORIGIN}${route}</loc></url>`).join('\n');
  writeFileSync(
    join(ROOT, out, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
  );
  writeFileSync(
    join(ROOT, out, 'robots.txt'),
    `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`,
  );
}

/** What the build prints about the release it found, or did not. */
function describeRelease(release) {
  if (!release) {
    return '  release none yet, so the install button carries no version';
  }
  return `  release ${release.version} (${release.size})`;
}

async function main() {
  const offline = process.argv.includes('--offline');
  const build = await prepare(OUT);
  let release = null;
  if (!offline) {
    release = await readRelease();
  }
  const catalog = addonDirs()
    .map((dir) => readAddon(dir))
    .filter((entry) => entry.ok)
    .map((entry) => ({
      id: entry.manifest.id,
      name: entry.manifest.name,
      version: entry.manifest.version,
      author: entry.manifest.author,
      description: entry.manifest.description,
      tags: entry.manifest.tags ?? [],
      permissions: entry.manifest.permissions ?? [],
    }));
  const features = catalog.map((one) => `${one.name} · ${one.version}`);

  const docs = loadDocs(ROOT);
  const pages = [
    landing(build, { release, features }),
    install(build, release),
    addons(build, catalog),
    changelog(build, readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')),
    ...docs.map((_page, index) => docsPage(build, docs, index)),
    notFound(),
  ];
  for (const page of pages) {
    build.emit(page);
  }
  writeStatics(OUT, pages);
  copyAssets(OUT);

  const warnings = build.warnings();
  for (const line of warnings) {
    console.warn(`  warn  ${line}`);
  }
  console.log(`site: ${pages.length} pages into ${OUT}`);
  console.log(describeRelease(release));
  if (warnings.length > 0) {
    console.log(`  ${warnings.length} screenshot(s) under their slot; see SITE.md 3.3`);
  }
}

/** Errors reach here from any stage, and only the message is useful. */
function messageOf(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

main().catch((error) => {
  console.error(`site: ${messageOf(error)}`);
  process.exitCode = 1;
});
