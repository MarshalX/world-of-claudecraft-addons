// Merging every source's index into the list Browse draws.
//
// The case worth the most here is two marketplaces publishing the same addon id,
// which is legitimate and which the design says the loader has to survive. If a
// row's identity were the short id rather than the fqid, one would silently
// stand in for the other in the list, in the install call, and in the check for
// whether it is installed already.

import { describe, expect, it } from 'vitest';
import {
  browseRows,
  catalogTags,
  pendingUpdates,
} from '../loader/src/runtime/ui/manager/catalog.ts';
import type { MarketplaceRef } from '../loader/src/shared/marketplace.ts';
import { LOCAL, OFFICIAL } from '../loader/src/shared/marketplace.ts';
import type { UpdateRow } from '../loader/src/shared/protocol.ts';
import { marketEntry, marketState } from './fakes/market.ts';

const THIRD_PARTY: MarketplaceRef = {
  id: 'gh:someone/their-addons',
  name: 'someone/their-addons',
  source: { kind: 'github', owner: 'someone', repo: 'their-addons', ref: 'HEAD' },
};

const NOTHING = new Set<string>();

/** The official source offering two addons, one of them tagged. */
function twoSources() {
  return [
    marketState(OFFICIAL, [
      marketEntry({ id: 'dps-meter', name: 'DPS Meter', tags: ['combat'] }),
      marketEntry({ id: 'bag-sort', name: 'Bag Sorter', author: 'Ada', tags: ['bags'] }),
    ]),
    marketState(THIRD_PARTY, [marketEntry({ id: 'dps-meter', name: 'Their DPS Meter' })], {
      builtin: false,
    }),
  ];
}

describe('browseRows', () => {
  it('lists every source in list order, official first', () => {
    const rows = browseRows(twoSources(), NOTHING);

    expect(rows.map((row) => row.fqid)).toEqual([
      'official/dps-meter',
      'official/bag-sort',
      'gh:someone/their-addons/dps-meter',
    ]);
  });

  it('carries the source each row came from, for the badge', () => {
    const rows = browseRows(twoSources(), NOTHING);

    expect(rows.map((row) => row.market.name)).toEqual([
      OFFICIAL.name,
      OFFICIAL.name,
      THIRD_PARTY.name,
    ]);
  });

  // The whole reason the fqid exists. Marking one installed must not mark the
  // other, or a player would be told they already have an addon they do not.
  it('marks only the copy that is installed when two sources share an id', () => {
    const rows = browseRows(twoSources(), new Set(['official/dps-meter']));

    expect(rows.map((row) => [row.fqid, row.installed])).toEqual([
      ['official/dps-meter', true],
      ['official/bag-sort', false],
      ['gh:someone/their-addons/dps-meter', false],
    ]);
  });

  it('reports nothing for a source whose index has not been read', () => {
    const unread = [marketState(OFFICIAL, [], { fetchedAt: null })];

    expect(browseRows(unread, NOTHING)).toEqual([]);
  });

  describe('the search', () => {
    it('matches the name, case-insensitively', () => {
      const rows = browseRows(twoSources(), NOTHING, { query: 'bag sorter', tag: null });

      expect(rows.map((row) => row.fqid)).toEqual(['official/bag-sort']);
    });

    it('matches the author and the description too', () => {
      const byAuthor = browseRows(twoSources(), NOTHING, { query: 'ada', tag: null });

      expect(byAuthor.map((row) => row.fqid)).toEqual(['official/bag-sort']);
    });

    it('matches a tag', () => {
      const rows = browseRows(twoSources(), NOTHING, { query: 'combat', tag: null });

      expect(rows.map((row) => row.fqid)).toEqual(['official/dps-meter']);
    });

    // Two words is a player naming two things they remember, not quoting a
    // title, so order must not matter.
    it('requires every word but not their order', () => {
      const rows = browseRows(twoSources(), NOTHING, { query: 'sorter bag', tag: null });

      expect(rows.map((row) => row.fqid)).toEqual(['official/bag-sort']);
    });

    it('matches everything on an empty or whitespace query', () => {
      expect(browseRows(twoSources(), NOTHING, { query: '   ', tag: null })).toHaveLength(3);
    });

    it('matches nothing when a word appears nowhere', () => {
      expect(browseRows(twoSources(), NOTHING, { query: 'dps unicorn', tag: null })).toEqual([]);
    });
  });

  describe('the tag filter', () => {
    it('keeps only rows carrying that tag', () => {
      const rows = browseRows(twoSources(), NOTHING, { query: '', tag: 'bags' });

      expect(rows.map((row) => row.fqid)).toEqual(['official/bag-sort']);
    });

    it('drops rows with no tags at all', () => {
      const rows = browseRows(twoSources(), NOTHING, { query: '', tag: 'combat' });

      expect(rows.map((row) => row.fqid)).toEqual(['official/dps-meter']);
    });

    it('combines with the search rather than replacing it', () => {
      const rows = browseRows(twoSources(), NOTHING, { query: 'bag', tag: 'combat' });

      expect(rows).toEqual([]);
    });
  });
});

describe('catalogTags', () => {
  it('collects every tag any source offers, sorted and without repeats', () => {
    const markets = [
      marketState(OFFICIAL, [
        marketEntry({ id: 'a', tags: ['ui', 'combat'] }),
        marketEntry({ id: 'b', tags: ['combat'] }),
      ]),
      marketState(LOCAL, [marketEntry({ id: 'c', tags: ['bags'] })]),
    ];

    expect(catalogTags(markets)).toEqual(['bags', 'combat', 'ui']);
  });

  it('is empty when nothing on offer is tagged', () => {
    expect(catalogTags([marketState(OFFICIAL, [marketEntry()])])).toEqual([]);
  });
});

describe('pendingUpdates', () => {
  function row(overrides: Partial<UpdateRow> = {}): UpdateRow {
    return {
      fqid: 'official/dps-meter',
      name: 'DPS Meter',
      marketplace: 'official',
      installed: '1.2.0',
      available: '1.3.0',
      pin: null,
      ...overrides,
    };
  }

  // A pin is the player having decided. An action labelled "all" that overrode
  // it would make the pin advisory rather than a decision.
  it('leaves out anything the player pinned', () => {
    const rows = [row(), row({ fqid: 'official/bag-sort', pin: '1.2.0' })];

    expect(pendingUpdates(rows).map((each) => each.fqid)).toEqual(['official/dps-meter']);
  });

  it('is empty when every row is pinned', () => {
    expect(pendingUpdates([row({ pin: '1.2.0' })])).toEqual([]);
  });
});
