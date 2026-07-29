// The dev server that stands in for a marketplace.
//
// Two things it does that a plain static server does not, and both are tested
// here rather than by hand: it generates the index from the addon directories on
// every request, and it refuses to serve anything outside addons/.

import { describe, expect, it } from 'vitest';
import { validateIndex } from '../loader/src/shared/schema.ts';
import { ROOT } from '../tools/manifests.ts';
import { buildIndex, etagFor, PORT, resolveFile } from '../tools/serve-core.ts';

describe('the generated index', () => {
  // Generated from addons/*/addon.json rather than read from the committed
  // marketplace.json, so saving a manifest is visible on the next refresh.
  it('validates against the same schema CI uses', () => {
    const result = validateIndex(buildIndex());

    expect(result.ok).toBe(true);
  });

  it('carries the addons in this repository, with their directories', () => {
    const index = buildIndex();

    expect(index.addons.length).toBeGreaterThan(0);
    for (const addon of index.addons) {
      expect(addon.path).toBe(`addons/${addon.id}`);
    }
  });

  it('offers the dev harness, which is what M5 is checked with', () => {
    expect(buildIndex().addons.map((addon) => addon.id)).toContain('dev-harness');
  });

  // The body is what the ETag is taken over, so a clock in it would make every
  // index request a fresh body and the conditional GET would never answer 304.
  it('is byte-identical across two builds with no edit between them', () => {
    expect(JSON.stringify(buildIndex())).toBe(JSON.stringify(buildIndex()));
  });
});

describe('etags', () => {
  it('differ for different bodies and match for identical ones', () => {
    expect(etagFor('a')).toBe(etagFor('a'));
    expect(etagFor('a')).not.toBe(etagFor('b'));
  });

  it('are quoted, as a strong validator has to be', () => {
    expect(etagFor('a')).toMatch(/^"[0-9a-f]+"$/);
  });
});

// This server hands out file contents from the working tree and has no
// authentication, so the prefix check is the only thing between a request and
// the repository.
describe('what may be served', () => {
  it('resolves a path inside addons/', () => {
    expect(resolveFile('/addons/dev-harness/main.js')).toBe(`${ROOT}addons/dev-harness/main.js`);
  });

  it.each([
    ['a sibling directory', '/loader/src/host/main.ts'],
    ['the repository root', '/package.json'],
    ['a traversal out of addons', '/addons/../package.json'],
    ['an encoded traversal', '/addons/%2e%2e/package.json'],
    ['a doubled traversal', '/addons/../../etc/hosts'],
    ['an absolute-looking path', '//etc/passwd'],
  ])('refuses %s', (_case, pathname) => {
    expect(resolveFile(pathname)).toBeNull();
  });

  // A path that only looks like it is under addons/ once `..` is collapsed.
  it('refuses a traversal that lands beside addons/', () => {
    expect(resolveFile('/addons/../addons-other/x.js')).toBeNull();
  });
});

describe('the port', () => {
  // Pinned in three places that have to agree: here, the loader's LOCAL_ORIGIN,
  // and the userscript @connect list.
  it('is the one the loader looks for', () => {
    expect(PORT).toBe(5180);
  });
});
