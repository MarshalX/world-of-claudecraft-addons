import { describe, expect, it } from 'vitest';

import {
  contentsApiUrl,
  fileUrl,
  fqid,
  fromStored,
  githubMarketplace,
  indexUrl,
  isBuiltinMarketplace,
  LOCAL,
  LOCAL_ID,
  LOCAL_ORIGIN,
  type MarketplaceRef,
  marketplaceId,
  normalizeMarketplaceUrl,
  OFFICIAL,
  OFFICIAL_ID,
  splitFqid,
  toStored,
} from '../loader/src/shared/marketplace.ts';

/**
 * The GitHub arm of a ref's source.
 *
 * A helper rather than a cast: reading owner off a source that turned out to be
 * the local one has to be a test failure, not `undefined` flowing into an
 * assertion that then passes for the wrong reason.
 */
function github(ref: MarketplaceRef) {
  if (ref.source.kind !== 'github') {
    throw new Error(`${ref.id} is not a GitHub marketplace`);
  }
  return ref.source;
}

describe('normalizeMarketplaceUrl', () => {
  it('accepts owner/repo shorthand', () => {
    const r = normalizeMarketplaceUrl('someone/their-addons');
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(github(r.ref).owner).toBe('someone');
    expect(github(r.ref).repo).toBe('their-addons');
    expect(github(r.ref).ref).toBe('HEAD');
    expect(r.ref.id).toBe('gh:someone/their-addons');
  });

  it('accepts a plain github URL', () => {
    const r = normalizeMarketplaceUrl('https://github.com/someone/their-addons');
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(github(r.ref).owner).toBe('someone');
    expect(github(r.ref).ref).toBe('HEAD');
  });

  it('pins the ref from a tree URL', () => {
    const r = normalizeMarketplaceUrl('https://github.com/someone/their-addons/tree/v1.2.0');
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(github(r.ref).ref).toBe('v1.2.0');
  });

  it('pins a slash-bearing branch from a tree URL', () => {
    const r = normalizeMarketplaceUrl('https://github.com/o/r/tree/release/2026-07');
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(github(r.ref).ref).toBe('release/2026-07');
  });

  it('strips a .git suffix', () => {
    const r = normalizeMarketplaceUrl('https://github.com/someone/their-addons.git');
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(github(r.ref).repo).toBe('their-addons');
  });

  it('accepts an scp-style clone URL', () => {
    const r = normalizeMarketplaceUrl('git@github.com:someone/their-addons.git');
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(github(r.ref).repo).toBe('their-addons');
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
    expect(fileUrl(OFFICIAL, 'addons/combat-meter/main.js')).toBe(
      'https://raw.githubusercontent.com/MarshalX/world-of-claudecraft-addons/HEAD/addons/combat-meter/main.js',
    );
  });

  it('encodes the ref in the contents API fallback', () => {
    const pinned = githubMarketplace('MarshalX', 'world-of-claudecraft-addons', 'release/2026-07');
    if (!pinned.ok) {
      throw new Error('expected a pinned ref');
    }
    const url = contentsApiUrl(pinned.ref);
    expect(url).toContain('ref=release%2F2026-07');
  });
});

describe('fqid', () => {
  it('round-trips through splitFqid', () => {
    const id = fqid('gh:someone/their-addons', 'combat-meter');
    expect(id).toBe('gh:someone/their-addons/combat-meter');
    expect(splitFqid(id)).toEqual({
      marketplace: 'gh:someone/their-addons',
      addonId: 'combat-meter',
    });
  });

  it('splits the official namespace', () => {
    expect(splitFqid('official/combat-meter')).toEqual({
      marketplace: 'official',
      addonId: 'combat-meter',
    });
  });

  // Two marketplaces shipping the same addon id must stay distinct.
  it('keeps colliding addon ids apart', () => {
    expect(fqid('official', 'combat-meter')).not.toBe(fqid('gh:someone/x', 'combat-meter'));
  });

  it.each(['', 'nosep', '/leading', 'trailing/'])('rejects malformed fqid %j', (input) => {
    expect(splitFqid(input)).toBeNull();
  });
});

describe('official marketplace', () => {
  it('points at this repository', () => {
    expect(github(OFFICIAL).owner).toBe('MarshalX');
    expect(github(OFFICIAL).repo).toBe('world-of-claudecraft-addons');
    expect(OFFICIAL.id).toBe(OFFICIAL_ID);
  });

  it('is frozen so no caller can repoint it at runtime', () => {
    expect(Object.isFrozen(OFFICIAL)).toBe(true);
    expect(Object.isFrozen(OFFICIAL.source)).toBe(true);
  });

  // A user-added marketplace must never be able to impersonate a built-in one.
  it.each([OFFICIAL_ID, LOCAL_ID])('id %s cannot be claimed by a user-added source', (reserved) => {
    expect(marketplaceId('any', 'thing')).not.toBe(reserved);
    const r = normalizeMarketplaceUrl(`${reserved}/${reserved}`);
    if (r.ok) {
      expect(r.ref.id).not.toBe(reserved);
    }
  });
});

describe('the local dev source', () => {
  it('is a loopback origin fixed at build time', () => {
    expect(LOCAL.source).toEqual({ kind: 'local', origin: LOCAL_ORIGIN });
    expect(LOCAL_ORIGIN).toBe('http://localhost:5180');
    expect(Object.isFrozen(LOCAL)).toBe(true);
  });

  it('builds its URLs off that origin rather than off raw.githubusercontent.com', () => {
    expect(indexUrl(LOCAL)).toBe(`${LOCAL_ORIGIN}/marketplace.json`);
    expect(fileUrl(LOCAL, 'addons/dev-harness/main.js')).toBe(
      `${LOCAL_ORIGIN}/addons/dev-harness/main.js`,
    );
  });

  // The dev server generates its index on every request, so there is nothing for
  // the contents-API fallback to fall back to and no reason to enumerate.
  it('has no contents-API fallback', () => {
    expect(contentsApiUrl(LOCAL)).toBeNull();
  });

  // The short @connect list is what bounds where GM_xmlhttpRequest can be aimed,
  // and it stays bounded because the local origin is a constant rather than
  // something the normalizer can be talked into producing.
  it.each([LOCAL_ORIGIN, 'http://localhost:5180/marketplace.json', 'localhost/5180'])(
    'cannot be reconstructed by pasting %s',
    (input) => {
      const r = normalizeMarketplaceUrl(input);
      if (r.ok) {
        expect(r.ref.source.kind).toBe('github');
      }
    },
  );

  it('counts as built in, so it has no remove control', () => {
    expect(isBuiltinMarketplace(LOCAL_ID)).toBe(true);
    expect(isBuiltinMarketplace(OFFICIAL_ID)).toBe(true);
    expect(isBuiltinMarketplace('gh:someone/repo')).toBe(false);
  });
});

// The id is the storage namespace of every addon installed from a source, so it
// is re-derived on read rather than trusted. A stored id a player could edit
// would be a way to point one source's addon at another's settings and data.
describe('persisting a user-added marketplace', () => {
  it('round-trips the three fields the user chose', () => {
    const added = normalizeMarketplaceUrl('https://github.com/someone/their-addons/tree/v1.2.0');
    if (!added.ok) {
      throw new Error('expected the URL to normalize');
    }

    const stored = toStored(added.ref);
    expect(stored).toEqual({ owner: 'someone', repo: 'their-addons', ref: 'v1.2.0' });
    expect(fromStored(stored)).toEqual(added.ref);
  });

  it('re-derives the id rather than reading a stored one', () => {
    const forged = {
      owner: 'someone',
      repo: 'repo',
      ref: 'HEAD',
      id: OFFICIAL_ID,
      name: 'Official',
    };

    expect(fromStored(forged)?.id).toBe('gh:someone/repo');
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['a string', 'someone/repo'],
    ['a missing ref', { owner: 'someone', repo: 'repo' }],
    ['an owner with a slash', { owner: 'a/b', repo: 'repo', ref: 'HEAD' }],
    ['a ref with a space', { owner: 'a', repo: 'repo', ref: 'my branch' }],
  ])('drops %s', (_case, value) => {
    expect(fromStored(value)).toBeNull();
  });

  // Built-ins come from the loader build on every read, so persisting one would
  // create a second copy that a later loader version could not move.
  it('refuses to persist a built-in source', () => {
    expect(toStored(OFFICIAL)).toBeNull();
    expect(toStored(LOCAL)).toBeNull();
  });
});

describe('githubMarketplace', () => {
  it('applies the same validation the normalizer does', () => {
    expect(githubMarketplace('someone', 'repo', 'HEAD').ok).toBe(true);
    expect(githubMarketplace('own er', 'repo', 'HEAD').ok).toBe(false);
    expect(githubMarketplace('someone', 'repo', 'my branch').ok).toBe(false);
  });
});
