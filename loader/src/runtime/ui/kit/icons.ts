// Where the game's own art lives, in one place so no addon hardcodes a path.
//
// These are the same directories the game's HUD reads, served from the same
// origin, with file names derived from ids an addon already holds, so the answer is
// a computed string rather than a lookup.
//
// The awkward part is real and is not hidden. A skill icon is filed UNDER ITS
// CLASS, so an ability id alone is not enough to locate one, and the caller has to
// say which class. For the common case that is one read (`world.player.templateId`
// is the class for a player), and the alternative would have been a bundled table
// of every ability's class, which is content and would go stale looking correct.
//
// The other honest limit: not every ability ships painted art. The ones that do
// not fall through to a procedural canvas recipe inside the game, which is not
// reachable from here, so there is no URL for one of those at all. The GAME still
// draws it; the loader simply cannot point at it.
//
// `kit/skill-art.ts` is what makes that answerable rather than guessed. The game
// serves a manifest of which ids have a file, so `ability()` returns null for an
// ability it knows has none, instead of a URL that 404s. Until the manifest for a
// class has been read the answer stays optimistic and the image decides, which is
// what `kit/bar.ts` hiding its own icon slot on error has always covered.
//
// `kit/item-art.ts` does the same job for `item()`, off a second served manifest,
// and the gap it describes is larger: a WEAPON's art is filed under a model name
// through a table the game does not serve at all, so no weapon icon is reachable
// from here and none can be. That manifest also carries the name each art file was
// filed under, which `itemArtName()` serves as exactly that and never as the item's
// name: nothing in the game keeps the two in step.

import type { ItemArt } from './item-art.ts';
import type { SkillArt } from './skill-art.ts';

/** Painted class-ability art, one directory per class. */
const SKILL_DIR = '/ui/skills';

/** Mob and npc portraits, by template id. */
const MOB_DIR = '/ui/mobs';

/** Item art, by item id. */
const ITEM_DIR = '/ui/items';

const EXTENSION = '.webp';

/**
 * An id that could name a file, or null.
 *
 * Encoded rather than trusted. Ids are snake_case in practice, but they arrive
 * from the wire and one carrying a slash would otherwise build a URL pointing
 * somewhere else on the origin entirely.
 */
function segment(id: unknown): string | null {
  if (typeof id !== 'string' || id.length === 0) {
    return null;
  }
  return encodeURIComponent(id);
}

/**
 * The URL builders addons use rather than writing a path.
 *
 * Every one answers null for an id it cannot make a file name out of, so a
 * missing id reads as "no icon" rather than as a request for `/ui/mobs/.webp`.
 */
export interface IconUrls {
  /**
   * A class ability's icon, or null when there is none to point at.
   *
   * `cls` is the class the ability belongs to, which for anything you cast is
   * `world.player.templateId`. Answers null without one, because the file is
   * filed under the class and there is nothing to guess from.
   *
   * Null also once the loader KNOWS the game ships no file for this ability, which
   * it learns from the manifest the game serves per class. Before that manifest has
   * been read the answer is the URL, and the image load decides.
   */
  ability: (abilityId: string, cls: string) => string | null;
  /** A mob or npc portrait, by the `templateId` on its entity. */
  mob: (templateId: string) => string | null;
  /**
   * An item's icon, or null when there is none to point at.
   *
   * Null once the loader KNOWS the game ships no file, which it learns from the
   * manifest the game serves. Before that has been read the answer is the URL and
   * the image load decides. A WEAPON never has one: weapon art is filed under a
   * model name through a table the game does not serve.
   */
  item: (itemId: string) => string | null;
  /**
   * The name the item's ART was filed under, or null.
   *
   * Not the item's name. This is provenance for the icon file, so it drifts
   * whenever content is renamed and the art is not. Null for an item with no file,
   * for one whose art came from a generated batch, and before the manifest is read.
   */
  itemArtName: (itemId: string) => string | null;
  /**
   * Read a class's art manifest, so `ability` is exact from the first call.
   *
   * Never rejects, and needing it is optional: the manifest is fetched in the
   * background on first use either way. Await it when a blank slot on the first row
   * drawn would be worse than a frame's delay.
   */
  preload: (cls: string) => Promise<void>;
  /** The same for items, so `item` and `itemArtName` are exact from the first call. */
  preloadItems: () => Promise<void>;
}

/** The URL builders, over a source of truth about which ids have a file. */
export function createIconUrls(art: SkillArt, items: ItemArt): IconUrls {
  return {
    ability: (abilityId, cls) => {
      const ability = segment(abilityId);
      const owner = segment(cls);
      if (ability === null || owner === null) {
        return null;
      }
      // Only a definite `false` withholds the URL. `null` is "not read yet", and
      // treating that as absent would cost an icon on every first row.
      if (art.has(cls, abilityId) === false) {
        return null;
      }
      return `${SKILL_DIR}/${owner}/${ability}${EXTENSION}`;
    },

    mob: (templateId) => {
      const template = segment(templateId);
      if (template === null) {
        return null;
      }
      return `${MOB_DIR}/${template}${EXTENSION}`;
    },

    item: (itemId) => {
      const item = segment(itemId);
      if (item === null) {
        return null;
      }
      // Only a definite `false` withholds the URL, exactly as `ability` does:
      // `null` is "not read yet", and treating it as absent would blank every cell
      // of the first bag grid drawn in a session.
      if (items.has(itemId) === false) {
        return null;
      }
      return `${ITEM_DIR}/${item}${EXTENSION}`;
    },

    itemArtName: (itemId) => items.artName(itemId),

    preload: (cls) => art.preload(cls),

    preloadItems: () => items.preload(),
  };
}
