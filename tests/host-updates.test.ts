// Which installed addons have a newer version waiting. An update row invites a re-fetch of code, so
// an unread index, a removed marketplace and a shared addon id must each stay silent.

import { describe, expect, it } from 'vitest';
import { computeUpdates } from '../loader/src/host/updates.ts';
import type { MarketplaceRef } from '../loader/src/shared/marketplace.ts';
import { LOCAL, OFFICIAL } from '../loader/src/shared/marketplace.ts';
import type { InstalledAddon } from '../loader/src/shared/protocol.ts';
import type { AddonManifest } from '../loader/src/shared/schema.ts';
import { marketEntry, marketState } from './fakes/market.ts';

const THIRD_PARTY: MarketplaceRef = {
  id: 'gh:someone/their-addons',
  name: 'someone/their-addons',
  source: { kind: 'github', owner: 'someone', repo: 'their-addons', ref: 'HEAD' },
};

/** An installed row, built from the same defaults as an index row. */
function installed(
  manifest: Partial<AddonManifest> = {},
  overrides: Partial<InstalledAddon> = {},
): InstalledAddon {
  const { path: _path, ...base } = marketEntry();
  const full = { ...base, ...manifest };
  const marketplace = overrides.marketplace ?? OFFICIAL.id;
  return {
    fqid: `${marketplace}/${full.id}`,
    marketplace,
    manifest: full,
    enabled: true,
    pin: null,
    ...overrides,
  };
}

/** The official source, read, offering `combat-meter` at the version given. */
function offering(version: string) {
  return [marketState(OFFICIAL, [marketEntry({ version })])];
}

describe('computeUpdates', () => {
  it('reports an addon whose marketplace moved ahead of it', () => {
    const rows = computeUpdates([installed()], offering('1.3.0'));

    expect(rows).toEqual([
      {
        fqid: 'official/combat-meter',
        name: 'Combat Meter',
        marketplace: 'official',
        installed: '1.2.0',
        available: '1.3.0',
        pin: null,
      },
    ]);
  });

  it('reports nothing when the index is at the installed version', () => {
    expect(computeUpdates([installed()], offering('1.2.0'))).toEqual([]);
  });

  it('reports nothing when the index is behind', () => {
    expect(computeUpdates([installed()], offering('1.1.0'))).toEqual([]);
  });

  // Offered anyway, it would install, report running, and throw later on a missing member, which
  // nothing badges because the supervisor only wraps the load.
  it('withholds an update needing an API minor this loader does not implement', () => {
    const ahead = [marketState(OFFICIAL, [marketEntry({ version: '1.3.0', apiMinor: 99 })])];

    expect(computeUpdates([installed()], ahead)).toEqual([]);
  });

  it('withholds an update built for another API major', () => {
    const ahead = [marketState(OFFICIAL, [marketEntry({ version: '1.3.0', apiVersion: 2 })])];

    expect(computeUpdates([installed()], ahead)).toEqual([]);
  });

  // Absent reads as 0, the surface an addon predating the field was written against.
  it('offers an update from an addon that declares no minor at all', () => {
    const { apiMinor: _dropped, ...noMinor } = marketEntry({ version: '1.3.0' });
    const ahead = [marketState(OFFICIAL, [noMinor])];

    expect(computeUpdates([installed()], ahead)).toHaveLength(1);
  });

  it('reports nothing for a source whose index has never been read', () => {
    const unread = [marketState(OFFICIAL, [], { fetchedAt: null })];

    expect(computeUpdates([installed()], unread)).toEqual([]);
  });

  it('reports nothing for an addon whose marketplace is no longer in the list', () => {
    expect(computeUpdates([installed()], [marketState(LOCAL, [marketEntry()])])).toEqual([]);
  });

  it('compares an addon only against the marketplace it came from', () => {
    const mine = installed({}, { marketplace: THIRD_PARTY.id });
    const markets = [
      marketState(OFFICIAL, [marketEntry({ version: '9.9.9' })]),
      marketState(THIRD_PARTY, [marketEntry({ version: '1.2.0' })], { builtin: false }),
    ];

    expect(computeUpdates([mine], markets)).toEqual([]);
  });

  // The pane has to say that an update exists and the player's pin is holding it back.
  it('still reports a pinned addon, carrying its pin', () => {
    const rows = computeUpdates([installed({}, { pin: '1.2.0' })], offering('1.3.0'));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.pin).toBe('1.2.0');
    expect(rows[0]?.available).toBe('1.3.0');
  });

  it('reports one row per addon that moved, and nothing for the rest', () => {
    const both = [installed(), installed({ id: 'cooldown-bars' })];
    const markets = [
      marketState(OFFICIAL, [
        marketEntry({ version: '1.3.0' }),
        marketEntry({ id: 'cooldown-bars', version: '1.2.0' }),
      ]),
    ];

    expect(computeUpdates(both, markets).map((row) => row.fqid)).toEqual(['official/combat-meter']);
  });

  it('reports nothing when the installed version cannot be parsed', () => {
    expect(computeUpdates([installed({ version: 'nightly' })], offering('1.3.0'))).toEqual([]);
  });
});
