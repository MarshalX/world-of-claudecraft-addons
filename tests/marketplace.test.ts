import { describe, expect, it } from 'vitest';

import {
  contentsApiUrl,
  fileUrl,
  fqid,
  indexUrl,
  marketplaceId,
  normalizeMarketplaceUrl,
  OFFICIAL,
  OFFICIAL_ID,
  splitFqid,
} from '../loader/src/shared/marketplace.ts';

describe('normalizeMarketplaceUrl', () => {
  it('accepts owner/repo shorthand', () => {
    const r = normalizeMarketplaceUrl('someone/their-addons');
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.ref.owner).toBe('someone');
    expect(r.ref.repo).toBe('their-addons');
    expect(r.ref.ref).toBe('HEAD');
    expect(r.ref.id).toBe('gh:someone/their-addons');
  });

  it('accepts a plain github URL', () => {
    const r = normalizeMarketplaceUrl('https://github.com/someone/their-addons');
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.ref.owner).toBe('someone');
    expect(r.ref.ref).toBe('HEAD');
  });

  it('pins the ref from a tree URL', () => {
    const r = normalizeMarketplaceUrl('https://github.com/someone/their-addons/tree/v1.2.0');
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.ref.ref).toBe('v1.2.0');
  });

  it('pins a slash-bearing branch from a tree URL', () => {
    const r = normalizeMarketplaceUrl('https://github.com/o/r/tree/release/2026-07');
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.ref.ref).toBe('release/2026-07');
  });

  it('strips a .git suffix', () => {
    const r = normalizeMarketplaceUrl('https://github.com/someone/their-addons.git');
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.ref.repo).toBe('their-addons');
  });

  it('accepts an scp-style clone URL', () => {
    const r = normalizeMarketplaceUrl('git@github.com:someone/their-addons.git');
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.ref.repo).toBe('their-addons');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeMarketplaceUrl('  someone/repo  ').ok).toBe(true);
  });

  // The short @connect allowlist depends on this: a non-GitHub marketplace must
  // never be constructible, or GM_xmlhttpRequest could be aimed anywhere.
  it.each([
    ['https://gitlab.com/someone/repo', 'non-github host'],
    ['https://evil.example/someone/repo', 'arbitrary host'],
    ['https://raw.githubusercontent.com/o/r/HEAD/x', 'raw host is not a repo URL'],
  ])('rejects %s (%s)', (input) => {
    const r = normalizeMarketplaceUrl(input);
    expect(r.ok).toBe(false);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'blank'],
    ['justonesegment', 'missing repo'],
    ['a/b/c', 'too many segments'],
    ['https://github.com/onlyowner', 'URL missing repo'],
    ['not a url at all://', 'malformed'],
  ])('rejects %s (%s)', (input) => {
    expect(normalizeMarketplaceUrl(input).ok).toBe(false);
  });

  it('rejects invalid characters in owner or repo', () => {
    expect(normalizeMarketplaceUrl('own er/repo').ok).toBe(false);
    expect(normalizeMarketplaceUrl('owner/re po').ok).toBe(false);
  });
});

describe('urls', () => {
  it('builds the index URL from the ref', () => {
    expect(indexUrl(OFFICIAL)).toBe(
      'https://raw.githubusercontent.com/MarshalX/world-of-claudecraft-addons/HEAD/marketplace.json',
    );
  });

  it('builds a file URL under the ref', () => {
    expect(fileUrl(OFFICIAL, 'addons/dps-meter/main.js')).toBe(
      'https://raw.githubusercontent.com/MarshalX/world-of-claudecraft-addons/HEAD/addons/dps-meter/main.js',
    );
  });

  it('encodes the ref in the contents API fallback', () => {
    const url = contentsApiUrl({ ...OFFICIAL, ref: 'release/2026-07' });
    expect(url).toContain('ref=release%2F2026-07');
  });
});

describe('fqid', () => {
  it('round-trips through splitFqid', () => {
    const id = fqid('gh:someone/their-addons', 'dps-meter');
    expect(id).toBe('gh:someone/their-addons/dps-meter');
    expect(splitFqid(id)).toEqual({
      marketplace: 'gh:someone/their-addons',
      addonId: 'dps-meter',
    });
  });

  it('splits the official namespace', () => {
    expect(splitFqid('official/dps-meter')).toEqual({
      marketplace: 'official',
      addonId: 'dps-meter',
    });
  });

  // Two marketplaces shipping the same addon id must stay distinct.
  it('keeps colliding addon ids apart', () => {
    expect(fqid('official', 'dps-meter')).not.toBe(fqid('gh:someone/x', 'dps-meter'));
  });

  it.each(['', 'nosep', '/leading', 'trailing/'])('rejects malformed fqid %j', (input) => {
    expect(splitFqid(input)).toBeNull();
  });
});

describe('official marketplace', () => {
  it('points at this repository', () => {
    expect(OFFICIAL.owner).toBe('MarshalX');
    expect(OFFICIAL.repo).toBe('world-of-claudecraft-addons');
    expect(OFFICIAL.id).toBe(OFFICIAL_ID);
  });

  it('is frozen so no caller can repoint it at runtime', () => {
    expect(Object.isFrozen(OFFICIAL)).toBe(true);
  });

  // A user-added marketplace must never be able to impersonate the built-in one.
  it('cannot be claimed by a user-added marketplace', () => {
    expect(marketplaceId('any', 'thing')).not.toBe(OFFICIAL_ID);
    const r = normalizeMarketplaceUrl('official/official');
    if (r.ok) {
      expect(r.ref.id).not.toBe(OFFICIAL_ID);
    }
  });
});
