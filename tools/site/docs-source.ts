// Reading site/content/docs/, and the one block on those pages that is generated
// rather than written.
//
// Order comes from frontmatter, never from the filename, so renaming a file does
// not silently reorder the sidebar and inserting a page between two others does
// not mean renumbering the ones after it.

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
 * The manifest field table, built from the live schema.
 *
 * The ORDER and the field SET come from `AddonManifest.shape`, and the prose from
 * manifest-docs.ts; a test asserts the two agree. So a field added to the schema
 * appears on this page in the right place without anyone editing the page, and a
 * field added without prose fails the build rather than rendering a blank cell.
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

/**
 * Every docs page, in sidebar order.
 *
 * Throws on a duplicate order, because two pages claiming the same position sort
 * unpredictably and the failure looks like a page that moves on its own.
 */
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
