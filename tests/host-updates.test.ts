// Which installed addons have a newer version waiting.
//
// The property that matters most here is what it stays SILENT about. An update
// row is an invitation to re-fetch code, so an index that was never read, a
// marketplace that has been removed, and an addon that two sources both publish
// each have to produce the right answer rather than a plausible one.

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

  /**
   * An update this loader could not run is withheld, not offered.
   *
   * The failure it prevents is the quiet one: the newer addon installs, reports
   * running, and then throws against a member this loader does not have, on
   * whatever frame first reaches it. Nothing badges that, because the supervisor
   * only wraps the LOAD. Keeping the working version installed until the loader
   * catches up is the honest outcome.
   */
  it('withholds an update needing an API minor this loader does not implement', () => {
    const ahead = [marketState(OFFICIAL, [marketEntry({ version: '1.3.0', apiMinor: 99 })])];

    expect(computeUpdates([installed()], ahead)).toEqual([]);
  });

  it('withholds an update built for another API major', () => {
    const ahead = [marketState(OFFICIAL, [marketEntry({ version: '1.3.0', apiVersion: 2 })])];

    expect(computeUpdates([installed()], ahead)).toEqual([]);
  });

  // Absent reads as 0, which is what an addon published before the minor existed
  // was written against. A field its author never saw must not refuse it.
  it('offers an update from an addon that declares no minor at all', () => {
    const { apiMinor: _dropped, ...noMinor } = marketEntry({ version: '1.3.0' });
    const ahead = [marketState(OFFICIAL, [noMinor])];

    expect(computeUpdates([installed()], ahead)).toHaveLength(1);
  });

  // Silence is the honest reading of "not looked yet". An empty answer would be
  // drawn as "everything is up to date", which is a claim nothing established.
  it('reports nothing for a source whose index has never been read', () => {
    const unread = [marketState(OFFICIAL, [], { fetchedAt: null })];

    expect(computeUpdates([installed()], unread)).toEqual([]);
  });

  it('reports nothing for an addon whose marketplace is no longer in the list', () => {
    expect(computeUpdates([installed()], [marketState(LOCAL, [marketEntry()])])).toEqual([]);
  });

  // Two sources may legitimately publish the same addon id. The comparison is
  // keyed on the marketplace as well, or installing from one would be badged
  // against the other's release schedule.
  it('compares an addon only against the marketplace it came from', () => {
    const mine = installed({}, { marketplace: THIRD_PARTY.id });
    const markets = [
      marketState(OFFICIAL, [marketEntry({ version: '9.9.9' })]),
      marketState(THIRD_PARTY, [marketEntry({ version: '1.2.0' })], { builtin: false }),
    ];

    expect(computeUpdates([mine], markets)).toEqual([]);
  });

  // The pin travels with the row rather than suppressing it: the pane has to be
  // able to say that an update exists and that the player's own pin is what is
  // holding it back, which is the only thing a pin needs a UI for.
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
