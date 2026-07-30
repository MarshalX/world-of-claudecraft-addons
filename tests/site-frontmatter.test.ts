import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../tools/site/frontmatter.ts';

const AT = 'docs/manifest.md';

function page(fields: string, body = '\nBody text.\n'): string {
  return `---\n${fields}\n---\n${body}`;
}

describe('parseFrontmatter', () => {
  it('reads the three fields and returns the body', () => {
    const result = parseFrontmatter(
      page('title: The manifest\norder: 2\nsummary: Every field, what it is for.'),
      AT,
    );
    expect(result).toMatchObject({
      title: 'The manifest',
      order: 2,
      summary: 'Every field, what it is for.',
    });
    expect(result.body.trim()).toBe('Body text.');
  });

  it('strips surrounding quotes', () => {
    const result = parseFrontmatter(page(`title: "The manifest"\norder: 1\nsummary: 'x'`), AT);
    expect(result.title).toBe('The manifest');
    expect(result.summary).toBe('x');
  });

  it('keeps a colon inside a value', () => {
    const result = parseFrontmatter(
      page('title: Patterns\norder: 4\nsummary: One rule: read the wire.'),
      AT,
    );
    expect(result.summary).toBe('One rule: read the wire.');
  });

  it('ignores blank lines in the block', () => {
    expect(parseFrontmatter(page('title: A\n\norder: 0\n\nsummary: B'), AT).order).toBe(0);
  });

  it('leaves a --- inside the body alone', () => {
    const result = parseFrontmatter(
      page('title: A\norder: 1\nsummary: B', '\nabove\n\n---\n\nbelow\n'),
      AT,
    );
    expect(result.body).toContain('above');
    expect(result.body).toContain('below');
  });

  // Every failure below is a build failure on purpose: a docs page that silently
  // defaults is one that lands in the wrong place in the sidebar and stays there.
  it('rejects a file with no frontmatter', () => {
    expect(() => parseFrontmatter('# Just a heading\n', AT)).toThrow(/missing frontmatter/);
  });

  it('rejects an unknown key, which is how a typo is caught', () => {
    expect(() => parseFrontmatter(page('title: A\norder: 1\nsummary: B\nsumary: C'), AT)).toThrow(
      /unknown frontmatter key `sumary`/,
    );
  });

  it('rejects a missing field', () => {
    expect(() => parseFrontmatter(page('title: A\norder: 1'), AT)).toThrow(/missing `summary`/);
  });

  it('rejects an empty field', () => {
    expect(() => parseFrontmatter(page('title: A\norder: 1\nsummary:'), AT)).toThrow(
      /missing `summary`/,
    );
  });

  it('rejects a duplicate key', () => {
    expect(() => parseFrontmatter(page('title: A\ntitle: B\norder: 1\nsummary: C'), AT)).toThrow(
      /duplicate frontmatter key `title`/,
    );
  });

  it('rejects a non-numeric order', () => {
    expect(() => parseFrontmatter(page('title: A\norder: first\nsummary: B'), AT)).toThrow(
      /`order` must be a non-negative integer/,
    );
  });

  it('rejects a line that is not key: value', () => {
    expect(() => parseFrontmatter(page('title: A\norder: 1\nsummary: B\njust a line'), AT)).toThrow(
      /not `key: value`/,
    );
  });

  it('names the file in the error', () => {
    expect(() => parseFrontmatter('nope', 'docs/patterns.md')).toThrow(/docs\/patterns\.md/);
  });
});
