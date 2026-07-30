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

import { createIconUrls } from '../loader/src/runtime/ui/kit/icons.ts';
import { createSkillArt } from '../loader/src/runtime/ui/kit/skill-art.ts';

/** A manifest naming exactly these ids for `hunter`, shaped as the game serves it. */
function manifest(...abilityIds: readonly string[]): unknown {
  return { class: 'hunter', abilities: abilityIds.map((abilityId) => ({ abilityId })) };
}

/** Builders over a manifest that never arrives, which is the optimistic state. */
function pending() {
  return createIconUrls(createSkillArt({ fetchJson: () => new Promise(() => undefined) }));
}

/** Builders over a manifest that is already known. */
async function loaded(...abilityIds: readonly string[]) {
  const icons = createIconUrls(
    createSkillArt({ fetchJson: () => Promise.resolve(manifest(...abilityIds)) }),
  );
  await icons.preload('hunter');
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
    const icons = createIconUrls(
      createSkillArt({
        fetchJson: () => Promise.reject(new Error('404, as a class with no manifest answers')),
      }),
    );
    await icons.preload('hunter');

    expect(icons.ability('aimed_shot', 'hunter')).toBe('/ui/skills/hunter/aimed_shot.webp');
  });

  it('rejects a manifest that is for a different class', async () => {
    const icons = createIconUrls(
      createSkillArt({ fetchJson: () => Promise.resolve({ class: 'mage', abilities: [] }) }),
    );
    await icons.preload('hunter');

    expect(icons.ability('aimed_shot', 'hunter')).toBe('/ui/skills/hunter/aimed_shot.webp');
  });

  // One request per class however many rows ask, since an addon draws a frameful.
  it('reads a class once however many abilities are asked about', async () => {
    let reads = 0;
    const icons = createIconUrls(
      createSkillArt({
        fetchJson: () => {
          reads += 1;
          return Promise.resolve(manifest('aimed_shot'));
        },
      }),
    );

    await Promise.all([icons.preload('hunter'), icons.preload('hunter')]);
    icons.ability('volley', 'hunter');
    icons.ability('aimed_shot', 'hunter');

    expect(reads).toBe(1);
  });

  it('never rejects preload, so an addon need not guard it', async () => {
    const icons = createIconUrls(
      createSkillArt({
        fetchJson: () => Promise.reject(new Error('404, as a class with no manifest answers')),
      }),
    );

    await expect(icons.preload('hunter')).resolves.toBeUndefined();
  });
});
