// The aura art manifest reader. Its shape assertions are a claim about the game's served
// manifest, captured from live at game 0.39.0.

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

  // A borrowed painting lives outside /ui/auras, which is why this module answers a URL.
  it('resolves a borrowed entry to the family that owns the painting', () => {
    const urls = urlsFrom(manifest([], [['bad_air', '/ui/delve-affixes/bad_air.webp']]));

    expect(urls?.get('bad_air')).toBe('/ui/delve-affixes/bad_air.webp');
  });

  it('tolerates a manifest that borrows nothing', () => {
    const urls = urlsFrom({ family: 'auras', assets: [{ auraId: 'sated', output: 'sated.webp' }] });

    expect(urls?.get('sated')).toBe('/ui/auras/sated.webp');
  });

  // Lenient per entry, strict about the shape: one malformed row costs one icon.
  it('drops an unreadable entry and keeps the rest', () => {
    const urls = urlsFrom({
      family: 'auras',
      assets: [{ auraId: 'sated', output: 'sated.webp' }, { auraId: 7 }, null],
    });

    expect(urls?.size).toBe(1);
    expect(urls?.get('sated')).toBe('/ui/auras/sated.webp');
  });

  // `family` is the shape check; without it a foreign payload reads as a manifest naming nothing.
  it('refuses a payload that is not this manifest', () => {
    expect(urlsFrom({ family: 'items', assets: [] })).toBeNull();
    expect(urlsFrom({ assets: [] })).toBeNull();
    expect(urlsFrom({ family: 'auras' })).toBeNull();
    expect(urlsFrom(null)).toBeNull();
    expect(urlsFrom('auras')).toBeNull();
  });

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

  // Unlike skill and item art: the family is closed and small, so a guess would 404 for most ids.
  it('answers null before the manifest lands', () => {
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

  // A retry would cost a request per row for the rest of the session.
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
