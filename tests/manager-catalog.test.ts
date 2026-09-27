// Merging every source's index into the list Browse draws. Two sources may publish the
// same addon id, so a row's identity is the fqid, never the short id.

import { describe, expect, it } from 'vitest';
import {
  browseEmptiness,
  browseRows,
  catalogHasPreviews,
  catalogShots,
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

const NOTHING = new Map<string, boolean>();

/** The official source offering two addons, one of them tagged. */
function twoSources() {
  return [
    marketState(OFFICIAL, [
      marketEntry({ id: 'combat-meter', name: 'Combat Meter', tags: ['combat'] }),
      marketEntry({ id: 'bag-sort', name: 'Bag Sorter', author: 'Ada', tags: ['bags'] }),
    ]),
    marketState(THIRD_PARTY, [marketEntry({ id: 'combat-meter', name: 'Their Combat Meter' })], {
      builtin: false,
    }),
  ];
}

describe('browseRows', () => {
  it('lists every source in list order, official first', () => {
    const rows = browseRows(twoSources(), NOTHING);

    expect(rows.map((row) => row.fqid)).toEqual([
      'official/combat-meter',
      'official/bag-sort',
      'gh:someone/their-addons/combat-meter',
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

  it('marks only the copy that is installed when two sources share an id', () => {
    const rows = browseRows(twoSources(), new Map([['official/combat-meter', true]]));

    expect(rows.map((row) => [row.fqid, row.installed])).toEqual([
      ['official/combat-meter', true],
      ['official/bag-sort', false],
      ['gh:someone/their-addons/combat-meter', false],
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
      // The word must appear nowhere but the tags, or a hit proves nothing.
      const tagged = [marketState(OFFICIAL, [marketEntry({ id: 'bag-sort', tags: ['raiding'] })])];

      const rows = browseRows(tagged, NOTHING, { query: 'raiding', tag: null });

      expect(rows.map((row) => row.fqid)).toEqual(['official/bag-sort']);
    });

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

      expect(rows.map((row) => row.fqid)).toEqual(['official/combat-meter']);
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

// Browse's blank list has several causes, each needing a different remedy.
describe('browseEmptiness', () => {
  it('is unread while no source has been read and none has failed', () => {
    const markets = [marketState(OFFICIAL, [], { fetchedAt: null })];

    expect(browseEmptiness(markets)).toBe('unread');
  });

  it('is unreadable once a source has reported an error', () => {
    const markets = [marketState(OFFICIAL, [], { fetchedAt: null, error: 'HTTP 404' })];

    expect(browseEmptiness(markets)).toBe('unreadable');
  });

  // The actionable reading wins.
  it('is unreadable when one source failed and another read cleanly', () => {
    const markets = [
      marketState(OFFICIAL, []),
      marketState(LOCAL, [], { error: 'connection refused' }),
    ];

    expect(browseEmptiness(markets)).toBe('unreadable');
  });

  it('is empty when every source was read and none offers anything', () => {
    expect(browseEmptiness([marketState(OFFICIAL, [])])).toBe('empty');
  });
});

describe('pendingUpdates', () => {
  function row(overrides: Partial<UpdateRow> = {}): UpdateRow {
    return {
      fqid: 'official/combat-meter',
      name: 'Combat Meter',
      marketplace: 'official',
      installed: '1.2.0',
      available: '1.3.0',
      pin: null,
      ...overrides,
    };
  }

  it('leaves out anything the player pinned', () => {
    const rows = [row(), row({ fqid: 'official/bag-sort', pin: '1.2.0' })];

    expect(pendingUpdates(rows).map((each) => each.fqid)).toEqual(['official/combat-meter']);
  });

  it('is empty when every row is pinned', () => {
    expect(pendingUpdates([row({ pin: '1.2.0' })])).toEqual([]);
  });
});

// Read over every source, not the filtered rows, so the column holds still while typing.
describe('catalogHasPreviews', () => {
  const shot = { file: 'preview.png', alt: 'The panel, mid-fight.' };

  it('is false when nothing on offer declares one', () => {
    expect(catalogHasPreviews([marketState(OFFICIAL, [marketEntry()])])).toBe(false);
  });

  it('is true when one addon in any source declares one', () => {
    const markets = [
      marketState(OFFICIAL, [marketEntry()]),
      marketState(OFFICIAL, [marketEntry({ id: 'other', preview: shot })]),
    ];

    expect(catalogHasPreviews(markets)).toBe(true);
  });

  it('is false for a list with no sources at all', () => {
    expect(catalogHasPreviews([])).toBe(false);
  });
});

// The Installed pane's preview source: the registry keeps the manifest but not the
// addon's directory, so it cannot build the URL itself. Keyed by fqid.
describe('catalogShots', () => {
  const shot = { file: 'preview.png', alt: 'The panel, mid-fight.' };

  it("resolves the file against the addon's own directory in its source", () => {
    const markets = [marketState(OFFICIAL, [marketEntry({ preview: shot })])];

    expect(catalogShots(markets).get('official/combat-meter')?.url).toContain(
      '/addons/combat-meter/preview.png',
    );
  });

  it('carries the alt text the manifest declared', () => {
    const markets = [marketState(OFFICIAL, [marketEntry({ preview: shot })])];

    expect(catalogShots(markets).get('official/combat-meter')?.alt).toBe(shot.alt);
  });

  it('leaves out an addon that declares no screenshot', () => {
    expect(catalogShots([marketState(OFFICIAL, [marketEntry()])]).size).toBe(0);
  });

  it('keeps two sources publishing one addon id apart', () => {
    const markets = [
      marketState(OFFICIAL, [marketEntry({ preview: shot })]),
      marketState(THIRD_PARTY, [marketEntry({ preview: { file: 'shot.png', alt: 'Theirs.' } })], {
        builtin: false,
      }),
    ];

    const shots = catalogShots(markets);
    expect(shots.get('official/combat-meter')?.alt).toBe(shot.alt);
    expect(shots.get('gh:someone/their-addons/combat-meter')?.alt).toBe('Theirs.');
  });

  it('has no answer for an addon no source offers', () => {
    expect(catalogShots([]).get('official/combat-meter')).toBeUndefined();
  });
});
