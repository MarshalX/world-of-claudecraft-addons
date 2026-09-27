// The item-art generator's reader and renderer, without a network. An empty union compiles and
// silently removes autocomplete, so a payload that is not the manifest throws.

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
  it('unions the curated entries and the generated batches', () => {
    expect(itemIconIds(manifest(['baked_bread'], ['copper_ore']))).toEqual([
      'baked_bread',
      'copper_ore',
    ]);
  });

  it('sorts and deduplicates', () => {
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

  it('drops a malformed entry and keeps the rest', () => {
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

  // `iconSize` stands in for the skill manifests' `class` check.
  it('throws for a payload that does not declare the served icon size', () => {
    expect(() => itemIconIds({ entries: [{ itemId: 'apple' }] })).toThrow(/not 128/);
  });

  it('throws for a manifest with neither list', () => {
    expect(() => itemIconIds({ iconSize: ICON_SIZE })).toThrow(/neither an entries/);
  });

  it('throws on an empty union', () => {
    expect(() => itemIconIds(manifest([], []))).toThrow(/names no items/);
  });
});

describe('rendering the module', () => {
  const rendered = renderItemTypes(
    ['apple', 'baked_bread'],
    'https://example.test/ui/items/x.json',
  );

  it('declares the union one name per line', () => {
    expect(rendered).toContain("export type KnownItemIcon =\n  | 'apple'\n  | 'baked_bread';");
  });

  it('names the host it was read from', () => {
    expect(rendered).toContain('https://example.test/ui/items/x.json');
  });

  // A count going down is art moving, which a regenerate diff would otherwise hide.
  it('carries the count', () => {
    expect(rendered).toContain('Ids with a file: 2');
  });

  // The manifest name is the art source name and drifts from the game's display name.
  it('generates no names at all, and says why', () => {
    expect(rendered).toContain('Names are NOT here');
    expect(rendered).not.toContain('KnownItemName');
  });
});
