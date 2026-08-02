// The item-art generator's reader and renderer.
//
// The fetch is in `tools/items.mjs` and everything it decides is here, so this suite
// drives the whole of it without a network, the same split the cue and icon
// generators use.
//
// What these are about is FAILING LOUDLY. A generator that answers empty writes a
// file that compiles, publishes, and quietly takes autocomplete away from every
// author, and nobody notices until someone asks why a valid id is not suggested. So
// a payload that is not a manifest throws rather than degrading. The check that does
// that work here is `iconSize`: unlike the skill manifests there is no per-class
// fan-out and so no `class` field to catch a path that resolved to another file.

import { describe, expect, it } from 'vitest';

import {
  GENERATED,
  ICON_SIZE,
  itemIconIds,
  manifestPath,
  renderItemTypes,
} from '../tools/items-core.ts';

/** A manifest shaped the way the game serves one: two lists that do not overlap. */
function manifest(named: readonly string[], batched: readonly string[]): unknown {
  return {
    license: 'irrelevant here',
    iconSize: ICON_SIZE,
    note: 'also irrelevant here',
    entries: named.map((itemId) => ({
      itemId,
      name: `The ${itemId} art`,
      sourcePack: 'a pack',
      sourceFile: '3.png',
      confidence: 'medium',
    })),
    generatedBatches: [{ source: 'a run', license: 'irrelevant', itemIds: batched }],
  };
}

describe('where the manifest lives', () => {
  it('builds the one path the game serves', () => {
    expect(manifestPath()).toBe('/ui/items/mapping.json');
  });

  it('writes where the published package can see it', () => {
    expect(GENERATED).toBe('packages/types/items.generated.d.ts');
  });
});

describe('reading the manifest', () => {
  // Both lists name ids with a committed file. Only the first carries a name, which
  // is why the name is read at run time and never generated.
  it('unions the curated entries and the generated batches', () => {
    expect(itemIconIds(manifest(['baked_bread'], ['copper_ore']))).toEqual([
      'baked_bread',
      'copper_ore',
    ]);
  });

  it('sorts and deduplicates, so a regenerate is a one-line diff or none', () => {
    const ids = itemIconIds(manifest(['tin_ore', 'baked_bread'], ['tin_ore', 'apple']));

    expect(ids).toEqual(['apple', 'baked_bread', 'tin_ore']);
  });

  it('reads a manifest carrying only curated entries', () => {
    expect(itemIconIds({ iconSize: ICON_SIZE, entries: [{ itemId: 'apple' }] })).toEqual(['apple']);
  });

  it('reads a manifest carrying only generated batches', () => {
    const payload = { iconSize: ICON_SIZE, generatedBatches: [{ itemIds: ['apple'] }] };

    expect(itemIconIds(payload)).toEqual(['apple']);
  });

  // One bad entry loses one id; rejecting the payload loses the certainty for all of
  // them, which is the trade the runtime reader makes too.
  it('costs one id for a malformed entry rather than the whole manifest', () => {
    const payload = {
      iconSize: ICON_SIZE,
      entries: [{ itemId: 'apple' }, { name: 'no id at all' }, { itemId: '' }, null],
      generatedBatches: [{ itemIds: ['tin_ore', 7, null] }],
    };

    expect(itemIconIds(payload)).toEqual(['apple', 'tin_ore']);
  });
});

describe('what it refuses', () => {
  it('throws for a payload that is not an object', () => {
    expect(() => itemIconIds('a 404 page')).toThrow(/not an object/);
  });

  // The stand-in for the skill manifests' class check. A payload that is not this
  // manifest fails here and on the empty union both.
  it('throws for a payload that does not declare the served icon size', () => {
    expect(() => itemIconIds({ entries: [{ itemId: 'apple' }] })).toThrow(/not 128/);
  });

  it('throws for a manifest with neither list', () => {
    expect(() => itemIconIds({ iconSize: ICON_SIZE })).toThrow(/neither an entries/);
  });

  // The failure that publishes: an empty union compiles and silently removes
  // autocomplete, so it has to be the loud one.
  it('throws rather than generating an empty union', () => {
    expect(() => itemIconIds(manifest([], []))).toThrow(/names no items/);
  });
});

describe('rendering the module', () => {
  const rendered = renderItemTypes(
    ['apple', 'baked_bread'],
    'https://example.test/ui/items/x.json',
  );

  it('declares the union one name per line, which is what makes a diff readable', () => {
    expect(rendered).toContain("export type KnownItemIcon =\n  | 'apple'\n  | 'baked_bread';");
  });

  it('says where it came from, so a file read from pbe is not mistaken for live', () => {
    expect(rendered).toContain('https://example.test/ui/items/x.json');
  });

  // A count going up is art landing and one going DOWN is art moving, which is the
  // change that would otherwise be silent on a regenerate.
  it('carries the count a reviewer reads on a regenerate diff', () => {
    expect(rendered).toContain('Ids with a file: 2');
  });

  // The manifest has a name per curated entry and it is the ART SOURCE name, which
  // drifts from the game's own display name on a content rename. Generating it would
  // publish a name that looks authoritative and is wrong for one entry in fourteen.
  it('generates no names at all, and says why', () => {
    expect(rendered).toContain('Names are NOT here');
    expect(rendered).not.toContain('KnownItemName');
  });
});
