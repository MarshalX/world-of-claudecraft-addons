// The aura art manifest reader.
//
// The third served art manifest and the one shaped least like the other two, so
// what is under test here is mostly the ways it differs. It resolves to a whole
// URL rather than a file id, because five of its entries point into ANOTHER art
// family and carry the finished path; and it answers null until it has been read
// rather than guessing, because the family is closed and most ids asked about are
// legitimately not in it.
//
// The manifest is the game's, so the shape assertions here are a claim about a
// document this repository cannot compile against. They were taken from the live
// manifest at game 0.39.0.

import { describe, expect, it } from 'vitest';

import { createAuraArt, MANIFEST_URL, urlsFrom } from '../loader/src/runtime/ui/kit/aura-art.ts';

type Fetch = (url: string) => Promise<unknown>;

/** A read that never settles, which is the state every first row is drawn in. */
const NEVER: Fetch = () => new Promise(() => undefined);

/** The manifest, shaped as the game serves it: own files, plus borrowed paintings. */
function manifest(
  own: readonly string[],
  external: readonly (readonly [string, string])[] = [],
): unknown {
  return {
    schemaVersion: 1,
    family: 'auras',
    iconSize: 128,
    assets: own.map((auraId) => ({ auraId, output: `${auraId}.webp` })),
    externalAssets: external.map(([auraId, runtimeUrl]) => ({ auraId, runtimeUrl })),
  };
}

/** An art reader over a manifest that is already known, awaited before asserting. */
async function readable(payload: unknown) {
  const art = createAuraArt({ fetchJson: () => Promise.resolve(payload) });
  await art.preload();
  return art;
}

describe('the manifest URL', () => {
  it('is the one file the game serves for the whole family', () => {
    expect(MANIFEST_URL).toBe('/ui/auras/mapping.json');
  });
});

describe('reading the manifest', () => {
  it('resolves an own entry to a file in the aura directory', () => {
    const urls = urlsFrom(manifest(['nythraxis_soul_rend']));

    expect(urls?.get('nythraxis_soul_rend')).toBe('/ui/auras/nythraxis_soul_rend.webp');
  });

  // The five borrowed paintings are the reason this module answers a URL rather
  // than a file id: composing a path under /ui/auras for one would name a file
  // that is not there.
  it('resolves a borrowed entry to the family that owns the painting', () => {
    const urls = urlsFrom(manifest([], [['bad_air', '/ui/delve-affixes/bad_air.webp']]));

    expect(urls?.get('bad_air')).toBe('/ui/delve-affixes/bad_air.webp');
  });

  it('tolerates a manifest that borrows nothing', () => {
    const urls = urlsFrom({ family: 'auras', assets: [{ auraId: 'sated', output: 'sated.webp' }] });

    expect(urls?.get('sated')).toBe('/ui/auras/sated.webp');
  });

  // Lenient about one entry, strict about the shape: one malformed row costs one
  // icon, where rejecting the document costs the certainty for every aura.
  it('drops an unreadable entry and keeps the rest', () => {
    const urls = urlsFrom({
      family: 'auras',
      assets: [{ auraId: 'sated', output: 'sated.webp' }, { auraId: 7 }, null],
    });

    expect(urls?.size).toBe(1);
    expect(urls?.get('sated')).toBe('/ui/auras/sated.webp');
  });

  // `family` stands in for the `class` field the per-class skill manifests carry.
  // Without it a payload that is not this manifest reads as one naming nothing,
  // which is indistinguishable from a game that paints no auras at all.
  it('refuses a payload that is not this manifest', () => {
    expect(urlsFrom({ family: 'items', assets: [] })).toBeNull();
    expect(urlsFrom({ assets: [] })).toBeNull();
    expect(urlsFrom({ family: 'auras' })).toBeNull();
    expect(urlsFrom(null)).toBeNull();
    expect(urlsFrom('auras')).toBeNull();
  });

  // The value is a URL taken from a document on the game's origin, so anything
  // that could leave that origin is dropped rather than handed to an addon.
  it('refuses a borrowed URL that could leave the origin', () => {
    const urls = urlsFrom(
      manifest(
        [],
        [
          ['a', 'https://elsewhere.example/x.webp'],
          ['b', '//elsewhere.example/x.webp'],
          ['c', 'relative.webp'],
        ],
      ),
    );

    expect(urls?.size).toBe(0);
  });
});

describe('answering for an aura', () => {
  it('hands back the URL once the manifest has been read', async () => {
    const art = await readable(manifest(['moontide']));

    expect(art.urlFor('moontide')).toBe('/ui/auras/moontide.webp');
  });

  it('answers null for an aura the manifest does not name', async () => {
    const art = await readable(manifest(['moontide']));

    expect(art.urlFor('rejuvenation')).toBeNull();
  });

  // The one place this departs from `skill-art` and `item-art`, and the reason is
  // the ratio rather than taste: this family is closed and covers the complement
  // of what `icon.ability` answers, so a guess would 404 for most ids and reach
  // the same empty slot having spent a request to get there.
  it('answers null before the manifest lands rather than guessing a URL', () => {
    const art = createAuraArt({ fetchJson: NEVER });

    expect(art.urlFor('moontide')).toBeNull();
  });

  it('answers null for a manifest it could not read at all', async () => {
    const art = createAuraArt({ fetchJson: () => Promise.reject(new Error('404')) });
    await art.preload();

    expect(art.urlFor('moontide')).toBeNull();
  });

  it('answers null for an id it cannot make a file name from', async () => {
    const art = await readable(manifest(['moontide']));

    expect(art.urlFor('')).toBeNull();
  });

  // One manifest and one URL, so a frameful of aura rows costs one request rather
  // than one per row.
  it('reads the manifest once however many rows ask', async () => {
    let reads = 0;
    const art = createAuraArt({
      fetchJson: () => {
        reads += 1;
        return Promise.resolve(manifest(['moontide']));
      },
    });

    art.urlFor('moontide');
    art.urlFor('sated');
    await art.preload();
    art.urlFor('moontide');
    await art.preload();

    expect(reads).toBe(1);
  });

  // A failed read is recorded rather than retried, or every row for the rest of
  // the session would spend a request re-learning the same answer.
  it('does not retry a manifest that could not be read', async () => {
    let reads = 0;
    const art = createAuraArt({
      fetchJson: () => {
        reads += 1;
        return Promise.reject(new Error('404'));
      },
    });

    await art.preload();
    art.urlFor('moontide');
    await art.preload();

    expect(reads).toBe(1);
  });
});
