// Reading site/content/docs/, and the one generated block on those pages. Order comes from
// frontmatter, never the filename.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AddonManifest } from '../../loader/src/shared/schema.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { fieldDocs } from './manifest-docs.ts';
import type { DocPage } from './pages/docs.ts';
import { ROOT } from './root.ts';

const MARKDOWN = /\.md$/;
const MANIFEST_TABLE = /^[ \t]*<!--\s*generated:\s*manifest-fields\s*-->[ \t]*$/gm;
const PIPE = /\|/g;

/** The first page is /docs/ itself, so the section has an index rather than a redirect. */
const INDEX_ORDER = 1;

function yesNo(value: boolean): string {
  if (value) {
    return 'yes';
  }
  return 'no';
}

function escapeCell(text: string): string {
  return text.replace(PIPE, '\\|');
}

/**
 * The manifest field table: order and field set from `AddonManifest.shape`, prose from
 * manifest-docs.ts. A field without prose fails the build.
 */
function manifestTable(): string {
  const rows = fieldDocs(Object.keys(AddonManifest.shape)).map(
    (field) =>
      `| \`${field.name}\` | ${yesNo(field.required)} | ${escapeCell(field.description)} |`,
  );
  return ['| Field | Required | Notes |', '|---|---|---|', ...rows].join('\n');
}

function expand(body: string): string {
  return body.replaceAll(MANIFEST_TABLE, manifestTable);
}

function hrefFor(slug: string, order: number): string {
  if (order === INDEX_ORDER) {
    return '/docs/';
  }
  return `/docs/${slug}`;
}

/** Every docs page, in sidebar order. Throws on a duplicate order, which sorts unpredictably. */
export function loadDocs(root: string = ROOT): DocPage[] {
  const dir = join(root, 'site', 'content', 'docs');
  const pages = readdirSync(dir)
    .filter((name) => MARKDOWN.test(name))
    .map((name) => {
      const slug = name.replace(MARKDOWN, '');
      const at = `site/content/docs/${name}`;
      const page = parseFrontmatter(readFileSync(join(dir, name), 'utf8'), at);
      return { slug, ...page, body: expand(page.body), href: hrefFor(slug, page.order) };
    })
    .sort((a, b) => a.order - b.order);
  const orders = new Set(pages.map((page) => page.order));
  if (orders.size !== pages.length) {
    throw new Error('site/content/docs: two pages share an `order`');
  }
  return pages;
}
