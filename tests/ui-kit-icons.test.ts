// The icon URL builders: the path shapes (the game's, so a moved directory is one edit),
// and what each builder answers before, after and without the game's served manifest.

import { describe, expect, it } from 'vitest';
import { createAuraArt } from '../loader/src/runtime/ui/kit/aura-art.ts';
import { createIconUrls } from '../loader/src/runtime/ui/kit/icons.ts';
import { createItemArt } from '../loader/src/runtime/ui/kit/item-art.ts';
import { createSkillArt } from '../loader/src/runtime/ui/kit/skill-art.ts';

type Fetch = (url: string) => Promise<unknown>;

/** A read that never settles, which is the optimistic state for either manifest. */
const NEVER: Fetch = () => new Promise(() => undefined);

/** A manifest naming exactly these ids for `hunter`, shaped as the game serves it. */
function manifest(...abilityIds: readonly string[]): unknown {
  return { class: 'hunter', abilities: abilityIds.map((abilityId) => ({ abilityId })) };
}

/** One curated entry, as an id and the name its art was filed under. */
type NamedArt = readonly [string, string];

/**
 * The item manifest as the game serves it: curated entries with a source name, plus
 * generated batches with ids only. Pairs, since an object keyed by game ids trips naming.
 */
function itemManifest(named: readonly NamedArt[], ...batched: readonly string[]) {
  return {
    iconSize: 128,
    entries: named.map(([itemId, name]) => ({ itemId, name })),
    generatedBatches: [{ source: 'a batch', itemIds: batched }],
  };
}

function builders(skills: Fetch, items: Fetch) {
  return createIconUrls(
    createSkillArt({ fetchJson: skills }),
    createItemArt({ fetchJson: items }),
    createAuraArt({ fetchJson: NEVER }),
  );
}

/** One curated item, used wherever a suite needs a real named entry. */
const BAKED_BREAD: NamedArt = ['baked_bread', 'Freshly Baked Bread'];

/** Builders over manifests that never arrive, which is the optimistic state. */
function pending() {
  return builders(NEVER, NEVER);
}

/** Builders over a skill manifest that is already known. */
async function loaded(...abilityIds: readonly string[]) {
  const icons = builders(() => Promise.resolve(manifest(...abilityIds)), NEVER);
  await icons.preload('hunter');
  return icons;
}

/** Builders over an item manifest that is already known. */
async function itemsLoaded(named: readonly NamedArt[], ...batched: readonly string[]) {
  const icons = builders(NEVER, () => Promise.resolve(itemManifest(named, ...batched)));
  await icons.preloadItems();
  return icons;
}

/** With no manifest read, every builder answers on path shape alone. */
const ICON_URLS = pending();

describe('ability icons', () => {
  it('files an ability under its class', () => {
    expect(ICON_URLS.ability('aimed_shot', 'hunter')).toBe('/ui/skills/hunter/aimed_shot.webp');
  });

  // A bundled ability-to-class table would be content going stale while looking authoritative.
  it('refuses to guess a missing class', () => {
    expect(ICON_URLS.ability('aimed_shot', '')).toBeNull();
  });

  it('refuses an empty ability id', () => {
    expect(ICON_URLS.ability('', 'hunter')).toBeNull();
  });
});

describe('mob and item icons', () => {
  it('builds a portrait path from a template id', () => {
    expect(ICON_URLS.mob('bog_bloat')).toBe('/ui/mobs/bog_bloat.webp');
  });

  it('builds an item path from an item id', () => {
    expect(ICON_URLS.item('baked_bread')).toBe('/ui/items/baked_bread.webp');
  });

  it.each([
    ['mob', ICON_URLS.mob],
    ['item', ICON_URLS.item],
  ])('answers null for an empty %s id', (_kind, build) => {
    expect(build('')).toBeNull();
  });
});

describe('ids that are not file names', () => {
  // Ids arrive from the wire; an unencoded slash would request elsewhere on the origin.
  it('encodes a separator so it cannot walk the path', () => {
    expect(ICON_URLS.mob('../secrets/thing')).toBe('/ui/mobs/..%2Fsecrets%2Fthing.webp');
  });

  it('encodes a class the same way', () => {
    expect(ICON_URLS.ability('x', '../..')).toBe('/ui/skills/..%2F../x.webp');
  });

  it('answers null for anything that is not a string at all', () => {
    expect(ICON_URLS.mob(null as unknown as string)).toBeNull();
    expect(ICON_URLS.item(7 as unknown as string)).toBeNull();
  });
});

// The manifest separates "the game ships no file" from "the loader built the wrong id".
describe('what the served manifest settles', () => {
  it('withholds the URL for an ability the game has no file for', async () => {
    const icons = await loaded('aimed_shot', 'volley');

    expect(icons.ability('fevered_draw', 'hunter')).toBeNull();
  });

  it('builds the URL for one it does have', async () => {
    const icons = await loaded('aimed_shot', 'volley');

    expect(icons.ability('volley', 'hunter')).toBe('/ui/skills/hunter/volley.webp');
  });

  // "Not read yet" is a third answer; reading it as "no file" blanks every first row.
  it('stays optimistic until the manifest has been read', () => {
    expect(pending().ability('fevered_draw', 'hunter')).toBe('/ui/skills/hunter/fevered_draw.webp');
  });

  it('knows nothing about a class whose manifest it has not read', async () => {
    const icons = await loaded('aimed_shot');

    expect(icons.ability('fireball', 'mage')).toBe('/ui/skills/mage/fireball.webp');
  });

  // A class with no manifest is ordinary and must not mean "no icons for that class".
  it('falls back to optimistic when a manifest cannot be read', async () => {
    const icons = builders(
      () => Promise.reject(new Error('404, as a class with no manifest answers')),
      NEVER,
    );
    await icons.preload('hunter');

    expect(icons.ability('aimed_shot', 'hunter')).toBe('/ui/skills/hunter/aimed_shot.webp');
  });

  it('rejects a manifest that is for a different class', async () => {
    const icons = builders(() => Promise.resolve({ class: 'mage', abilities: [] }), NEVER);
    await icons.preload('hunter');

    expect(icons.ability('aimed_shot', 'hunter')).toBe('/ui/skills/hunter/aimed_shot.webp');
  });

  it('reads a class once however many abilities are asked about', async () => {
    let reads = 0;
    const icons = builders(() => {
      reads += 1;
      return Promise.resolve(manifest('aimed_shot'));
    }, NEVER);

    await Promise.all([icons.preload('hunter'), icons.preload('hunter')]);
    icons.ability('volley', 'hunter');
    icons.ability('aimed_shot', 'hunter');

    expect(reads).toBe(1);
  });

  it('never rejects preload, so an addon need not guard it', async () => {
    const icons = builders(
      () => Promise.reject(new Error('404, as a class with no manifest answers')),
      NEVER,
    );

    await expect(icons.preload('hunter')).resolves.toBeUndefined();
  });
});

describe('what the served item manifest settles', () => {
  it('withholds the URL for an item the game has no file for', async () => {
    const icons = await itemsLoaded([BAKED_BREAD]);

    expect(icons.item('rusty_shortsword')).toBeNull();
  });

  it('builds the URL for one it does have', async () => {
    const icons = await itemsLoaded([BAKED_BREAD]);

    expect(icons.item('baked_bread')).toBe('/ui/items/baked_bread.webp');
  });

  // Batch ids have no names but do have files.
  it('counts a generated batch id as having a file', async () => {
    const icons = await itemsLoaded([], 'copper_ore');

    expect(icons.item('copper_ore')).toBe('/ui/items/copper_ore.webp');
  });

  // A bag grid drawn before the manifest lands must keep every cell.
  it('stays optimistic until the manifest has been read', () => {
    expect(pending().item('rusty_shortsword')).toBe('/ui/items/rusty_shortsword.webp');
  });

  // Permanently unknown, never permanently blank.
  it('falls back to optimistic when the manifest cannot be read', async () => {
    const icons = builders(NEVER, () => Promise.reject(new Error('404')));
    await icons.preloadItems();

    expect(icons.item('rusty_shortsword')).toBe('/ui/items/rusty_shortsword.webp');
  });

  // `iconSize` is the shape check, standing in for the skill manifests' `class` field.
  it('rejects a payload that is not this manifest', async () => {
    const icons = builders(NEVER, () => Promise.resolve({ entries: [{ itemId: 'baked_bread' }] }));
    await icons.preloadItems();

    expect(icons.item('rusty_shortsword')).toBe('/ui/items/rusty_shortsword.webp');
  });

  it('reads the manifest once however many items a grid asks about', async () => {
    let reads = 0;
    const icons = builders(NEVER, () => {
      reads += 1;
      return Promise.resolve(itemManifest([BAKED_BREAD]));
    });

    await icons.preloadItems();
    for (let cell = 0; cell < 200; cell += 1) {
      icons.item(`slot_${String(cell)}`);
    }

    expect(reads).toBe(1);
  });

  it('never rejects preloadItems, so an addon need not guard it', async () => {
    const icons = builders(NEVER, () => Promise.reject(new Error('404')));

    await expect(icons.preloadItems()).resolves.toBeUndefined();
  });
});

// The ART SOURCE name, which drifts from the item's display name on a content rename.
describe('the art name', () => {
  it('answers the name the art was filed under', async () => {
    const icons = await itemsLoaded([BAKED_BREAD]);

    expect(icons.itemArtName('baked_bread')).toBe('Freshly Baked Bread');
  });

  it('answers null for a generated batch id, which has a file and no name', async () => {
    const icons = await itemsLoaded([], 'copper_ore');

    expect(icons.item('copper_ore')).toBe('/ui/items/copper_ore.webp');
    expect(icons.itemArtName('copper_ore')).toBeNull();
  });

  it('answers null for an item with no art at all', async () => {
    const icons = await itemsLoaded([BAKED_BREAD]);

    expect(icons.itemArtName('rusty_shortsword')).toBeNull();
  });

  // Unlike `item`, nothing optimistic exists to answer: a made-up name is worse than none.
  it('answers null before the manifest has been read', () => {
    expect(pending().itemArtName('baked_bread')).toBeNull();
  });
});

// A Heroic copy ships no file and is drawn from its base weapon's painting, as the game
// resolves it; the resolved base is checked against the manifest like any other id.
describe('a Heroic variant, which reuses its base weapon art', () => {
  it('answers the base weapon file for a variant the manifest does not list', async () => {
    const icons = await itemsLoaded([], 'hoarfrost_edge');

    expect(icons.item('heroic_hoarfrost_edge')).toBe('/ui/items/hoarfrost_edge.webp');
  });

  // `heroic_mark` ships its own file and is not a variant.
  it("prefers an id's own file, whatever it starts with", async () => {
    const icons = await itemsLoaded([], 'heroic_mark', 'mark');

    expect(icons.item('heroic_mark')).toBe('/ui/items/heroic_mark.webp');
  });

  it('answers null when neither the variant nor its base has a file', async () => {
    const icons = await itemsLoaded([], 'baked_bread');

    expect(icons.item('heroic_nothing_at_all')).toBeNull();
  });

  it('does not strip the prefix from the middle of an id', async () => {
    const icons = await itemsLoaded([], 'mark');

    expect(icons.item('sigil_heroic_mark')).toBeNull();
  });

  it("answers the base entry name, since the file is the base's", async () => {
    const icons = await itemsLoaded([['hoarfrost_edge', 'Hoarfrost Edge']]);

    expect(icons.itemArtName('heroic_hoarfrost_edge')).toBe('Hoarfrost Edge');
  });
});
