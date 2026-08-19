// The icon URL builders.
//
// A pure module with a Node test, which is the point of it existing at all: the
// paths are the GAME'S, not the loader's, so the value of having one home for them
// is that a game update that moves a directory is one edit here, and the thing
// that would otherwise catch it is a player reporting missing icons.
//
// Only a subset of abilities ship a painted FILE; the rest are composited on a canvas
// inside the game and have no URL at all. The game serves a manifest of which ids have
// one, so "is there a file" is answerable before a request is made rather than only by
// loading the image and watching it fail. Both halves are under test: the shape of the
// path, and what the builder answers before, after, and without that manifest.

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
 * The item manifest, shaped as the game serves it: curated entries carrying a source
 * name, plus generated batches carrying ids and no names at all.
 *
 * Entry PAIRS rather than an object, because every id here is a name the GAME owns.
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

/**
 * The path-shape cases below predate the manifest and are unchanged by it: with none
 * read, every builder answers exactly as it did before one existed.
 */
const ICON_URLS = pending();

describe('ability icons', () => {
  it('files an ability under its class, which is where the game puts it', () => {
    expect(ICON_URLS.ability('aimed_shot', 'hunter')).toBe('/ui/skills/hunter/aimed_shot.webp');
  });

  // The class is not guessable from an ability id and a bundled table of every
  // ability's class would be content going stale while looking authoritative.
  it('refuses to guess a missing class', () => {
    expect(ICON_URLS.ability('aimed_shot', '')).toBeNull();
  });

  it('refuses an empty ability id rather than building a path to a directory', () => {
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
  // Ids arrive from the wire. One carrying a slash would otherwise build a URL
  // pointing somewhere else on the origin entirely, which is the difference
  // between a missing icon and a request the addon did not intend to make.
  it('encodes a separator rather than letting it walk the path', () => {
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

// The reason this module gained a manifest at all. A blank icon slot used to mean
// either "the game ships no file for this" or "the loader built the wrong id", and
// telling those apart cost a long session chasing the second while looking at rows
// from the first. Now the first case is answerable without a request.
describe('what the served manifest settles', () => {
  it('withholds the URL for an ability the game has no file for', async () => {
    const icons = await loaded('aimed_shot', 'volley');

    expect(icons.ability('fevered_draw', 'hunter')).toBeNull();
  });

  it('still builds the URL for one it does have', async () => {
    const icons = await loaded('aimed_shot', 'volley');

    expect(icons.ability('volley', 'hunter')).toBe('/ui/skills/hunter/volley.webp');
  });

  // The distinction that matters most: "not read yet" is a third answer, and turning
  // it into "no file" would cost an icon on every first row an addon draws.
  it('stays optimistic until the manifest has been read', () => {
    expect(pending().ability('fevered_draw', 'hunter')).toBe('/ui/skills/hunter/fevered_draw.webp');
  });

  it('knows nothing about a class whose manifest it has not read', async () => {
    const icons = await loaded('aimed_shot');

    expect(icons.ability('fireball', 'mage')).toBe('/ui/skills/mage/fireball.webp');
  });

  // A class with no manifest is ordinary, not a fault: the game does not have every
  // class an addon might name. It must not turn into "no icons for that class".
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

  // One request per class however many rows ask, since an addon draws a frameful.
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

// The same settlement, one content table over, with a bigger gap behind it: a WEAPON
// has an icon in the game and none an addon can point at, since weapon art is filed
// under a model name through a table the game does not serve. Without the manifest
// every one of those was a URL that 404s.
describe('what the served item manifest settles', () => {
  it('withholds the URL for an item the game has no file for', async () => {
    const icons = await itemsLoaded([BAKED_BREAD]);

    expect(icons.item('rusty_shortsword')).toBeNull();
  });

  it('still builds the URL for one it does have', async () => {
    const icons = await itemsLoaded([BAKED_BREAD]);

    expect(icons.item('baked_bread')).toBe('/ui/items/baked_bread.webp');
  });

  // A generated batch names ids and no names, and those ids have files like any
  // other: dropping them would blank a third of the game's item art.
  it('counts a generated batch id as having a file', async () => {
    const icons = await itemsLoaded([], 'copper_ore');

    expect(icons.item('copper_ore')).toBe('/ui/items/copper_ore.webp');
  });

  // The distinction that matters most: a bag grid drawn before the manifest lands
  // must not lose every cell it was entitled to.
  it('stays optimistic until the manifest has been read', () => {
    expect(pending().item('rusty_shortsword')).toBe('/ui/items/rusty_shortsword.webp');
  });

  // Permanently unknown, never permanently blank. A game that does not serve this
  // manifest must behave exactly as the loader did before it existed.
  it('falls back to optimistic when the manifest cannot be read', async () => {
    const icons = builders(NEVER, () => Promise.reject(new Error('404')));
    await icons.preloadItems();

    expect(icons.item('rusty_shortsword')).toBe('/ui/items/rusty_shortsword.webp');
  });

  // `iconSize` is the shape check standing in for the skill manifests' `class`
  // field: there is no per-class fan-out here to catch a path that resolved wrong.
  it('rejects a payload that is not this manifest', async () => {
    const icons = builders(NEVER, () => Promise.resolve({ entries: [{ itemId: 'baked_bread' }] }));
    await icons.preloadItems();

    expect(icons.item('rusty_shortsword')).toBe('/ui/items/rusty_shortsword.webp');
  });

  // The regression is a request per cell out of a bag grid. One manifest, one URL.
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

// The name is the ART SOURCE name, not the item's, and the two drift on a content
// rename with nothing keeping them in step. It is served labelled for that reason,
// and is deliberately absent from the generated union.
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

  // Unlike `item`, there is nothing optimistic to answer: a made-up name is worse
  // than none, which is the whole reason this member is labelled the way it is.
  it('answers null before the manifest has been read', () => {
    expect(pending().itemArtName('baked_bread')).toBeNull();
  });
});

// Game 0.36.0 gave every authored weapon its own painting and listed it here, and
// then declined to list one thing: a generated Heroic copy ships NO file and is
// drawn from its base weapon's painting. The manifest is therefore no longer the
// whole answer, and the resolution mirrors the game's own rather than guessing,
// since the resolved base is checked against the manifest like any other id.
describe('a Heroic variant, which reuses its base weapon art', () => {
  it('answers the base weapon file for a variant the manifest does not list', async () => {
    const icons = await itemsLoaded([], 'hoarfrost_edge');

    expect(icons.item('heroic_hoarfrost_edge')).toBe('/ui/items/hoarfrost_edge.webp');
  });

  // The base arm is reached only when the item's OWN id is absent, so an id that
  // merely begins with the prefix and ships its own painting is unaffected.
  // `heroic_mark` is that id in the live table and it is not a variant of anything.
  it('prefers an id its own file, whatever it starts with', async () => {
    const icons = await itemsLoaded([], 'heroic_mark', 'mark');

    expect(icons.item('heroic_mark')).toBe('/ui/items/heroic_mark.webp');
  });

  it('still answers null when neither the variant nor its base has a file', async () => {
    const icons = await itemsLoaded([], 'baked_bread');

    expect(icons.item('heroic_nothing_at_all')).toBeNull();
  });

  // The prefix is not a licence to strip anything: only a leading one resolves.
  it('does not strip the prefix from the middle of an id', async () => {
    const icons = await itemsLoaded([], 'mark');

    expect(icons.item('sigil_heroic_mark')).toBeNull();
  });

  // The name describes the FILE, and the file is the base's painting. A Heroic
  // copy is displayed under the base item's name anyway, so this cannot disagree
  // with the item's own name any more than the base's entry already does.
  it('answers the base entry name, because that is whose file it is', async () => {
    const icons = await itemsLoaded([['hoarfrost_edge', 'Hoarfrost Edge']]);

    expect(icons.itemArtName('heroic_hoarfrost_edge')).toBe('Hoarfrost Edge');
  });
});
