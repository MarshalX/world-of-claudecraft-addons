// Reading a marketplace that has no marketplace.json.
//
// Driven through the real fetcher over the fake transport rather than by
// stubbing the fetch out, because what this path IS is a request count: one
// listing plus one per directory, against a limit of sixty an hour. A stub would
// let a version that issued them concurrently, or issued one per addon on every
// refresh, pass without anything noticing.

import { describe, expect, it } from 'vitest';
import { enumerateAddons, MAX_ENUMERATED } from '../loader/src/host/contents-fallback.ts';
import { createFetcher } from '../loader/src/host/fetcher.ts';
import { contentsApiUrl, fileUrl, type MarketplaceRef } from '../loader/src/shared/marketplace.ts';
import { type CapturedDiag, captureDiag } from './fakes/diag.ts';
import { createFakeHttp, createFakeValues } from './fakes/http.ts';

const MARKET: MarketplaceRef = {
  id: 'gh:someone/their-addons',
  name: 'someone/their-addons',
  source: { kind: 'github', owner: 'someone', repo: 'their-addons', ref: 'HEAD' },
};

const CONTENTS = contentsApiUrl(MARKET) as string;

function manifestUrl(dir: string): string {
  return fileUrl(MARKET, `addons/${dir}/addon.json`);
}

function listing(dirs: readonly string[]): string {
  return JSON.stringify(dirs.map((name) => ({ name, path: `addons/${name}`, type: 'dir' })));
}

function manifest(id: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id,
    name: `The ${id}`,
    version: '1.0.0',
    apiVersion: 1,
    author: 'someone',
    description: 'An addon.',
    entry: 'main.js',
    ...overrides,
  });
}

/** One diagnostic call flattened, since diag.ts passes its channel tag first. */
function said(capture: CapturedDiag, at = 0): string {
  return (capture.errors()[at] ?? []).map(String).join(' ');
}

function open(files: Record<string, string>) {
  const http = createFakeHttp(files);
  const fetcher = createFetcher({ request: http.request, cache: createFakeValues() });
  return { http, fetcher };
}

/** A repository with two ordinary addons in it. */
function twoAddons(): Record<string, string> {
  return {
    [CONTENTS]: listing(['cooldown-bars', 'combat-meter']),
    [manifestUrl('combat-meter')]: manifest('combat-meter'),
    [manifestUrl('cooldown-bars')]: manifest('cooldown-bars'),
  };
}

describe('enumerating a repository with no index', () => {
  it('builds index rows carrying each addon directory as its path', async () => {
    const { fetcher } = open(twoAddons());

    const addons = await enumerateAddons(fetcher, MARKET);

    // Sorted by directory name, which is why combat-meter leads: the listing
    // order the API happens to answer in is not what the manager shows.
    expect(addons.map((row) => [row.id, row.path])).toEqual([
      ['combat-meter', 'addons/combat-meter'],
      ['cooldown-bars', 'addons/cooldown-bars'],
    ]);
  });

  it('costs one listing plus one request per directory', async () => {
    const { fetcher, http } = open(twoAddons());

    await enumerateAddons(fetcher, MARKET);

    expect(http.calls).toEqual([
      CONTENTS,
      manifestUrl('combat-meter'),
      manifestUrl('cooldown-bars'),
    ]);
  });

  it('ignores anything in the listing that is not a directory', async () => {
    const { fetcher } = open({
      [CONTENTS]: JSON.stringify([
        { name: 'README.md', type: 'file' },
        { name: 'combat-meter', type: 'dir' },
      ]),
      [manifestUrl('combat-meter')]: manifest('combat-meter'),
    });

    const addons = await enumerateAddons(fetcher, MARKET);

    expect(addons.map((row) => row.id)).toEqual(['combat-meter']);
  });

  // One broken addon in a third-party repository must not hide the rest of it.
  it('skips a directory whose manifest does not validate, and keeps the others', async () => {
    const capture = captureDiag();
    try {
      const { fetcher } = open({
        [CONTENTS]: listing(['broken', 'combat-meter']),
        [manifestUrl('broken')]: JSON.stringify({ id: 'broken' }),
        [manifestUrl('combat-meter')]: manifest('combat-meter'),
      });

      const addons = await enumerateAddons(fetcher, MARKET);

      expect(addons.map((row) => row.id)).toEqual(['combat-meter']);
      expect(capture.errors()).toHaveLength(1);
    } finally {
      capture.restore();
    }
  });

  it('skips a directory with no addon.json in it', async () => {
    const capture = captureDiag();
    try {
      const { fetcher } = open({
        [CONTENTS]: listing(['docs', 'combat-meter']),
        [manifestUrl('combat-meter')]: manifest('combat-meter'),
      });

      const addons = await enumerateAddons(fetcher, MARKET);

      expect(addons.map((row) => row.id)).toEqual(['combat-meter']);
    } finally {
      capture.restore();
    }
  });

  // The directory is what the index publishes as `path` and the id is what the
  // fqid is built from, so a mismatch would install an addon whose storage
  // namespace names a directory that does not hold it.
  it('skips a directory whose manifest claims a different id', async () => {
    const capture = captureDiag();
    try {
      const { fetcher } = open({
        [CONTENTS]: listing(['combat-meter']),
        [manifestUrl('combat-meter')]: manifest('something-else'),
      });

      const addons = await enumerateAddons(fetcher, MARKET);

      expect(addons).toEqual([]);
      expect(said(capture)).toContain('something-else');
    } finally {
      capture.restore();
    }
  });

  it('fails when the listing itself cannot be read', async () => {
    const { fetcher } = open({});

    await expect(enumerateAddons(fetcher, MARKET)).rejects.toThrow(/404/);
  });

  it('fails when the repository has no addons directory to enumerate', async () => {
    const { fetcher } = open({ [CONTENTS]: JSON.stringify([]) });

    await expect(enumerateAddons(fetcher, MARKET)).rejects.toThrow(/no addons\/ directory/);
  });

  // Refused rather than truncated. One request per addon against sixty an hour
  // means a repository this size cannot be read this way even once, and showing
  // the first forty would be a silent lie about what the source offers.
  it('refuses a repository too large to read one addon at a time', async () => {
    const dirs = Array.from({ length: MAX_ENUMERATED + 1 }, (_, at) => `addon-${String(at)}`);
    const { fetcher, http } = open({ [CONTENTS]: listing(dirs) });

    await expect(enumerateAddons(fetcher, MARKET)).rejects.toThrow(/has to publish an index/);
    expect(http.calls).toEqual([CONTENTS]);
  });

  it('has nothing to enumerate for a source that is not a repository', async () => {
    const { fetcher } = open({});
    const local: MarketplaceRef = {
      id: 'local',
      name: 'Local dev server',
      source: { kind: 'local', origin: 'http://localhost:5180' },
    };

    await expect(enumerateAddons(fetcher, local)).rejects.toThrow(/no repository/);
  });
});
