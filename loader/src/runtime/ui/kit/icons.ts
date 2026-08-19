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
// `kit/aura-art.ts` is the third, new with game 0.39.0, and it is the one that
// answers a whole URL rather than a file name: five of its entries are auras the
// game draws from another family's painting and the manifest carries the finished
// path to each. It is also the one that is NOT optimistic before its manifest
// lands, because the family is closed and small and most ids asked about are
// legitimately not in it.
//
// `kit/item-art.ts` does the same job for `item()`, off a second served manifest,
// and it also resolves the one item the manifest deliberately does not list: a
// generated Heroic weapon copy, which reuses its base weapon's painting rather
// than shipping a file. That manifest also carries the name each art file was
// filed under, which `itemArtName()` serves as exactly that and never as the item's
// name: nothing in the game keeps the two in step.

import type { AuraArt } from './aura-art.ts';
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
   * the image load decides.
   *
   * A generated Heroic copy of a weapon ships no file of its own and is answered
   * with its base weapon's painting, which is what the game draws for it too.
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
   * An aura's painted icon, or null when there is none to point at.
   *
   * The id is the aura's own, which is what `world` puts on an aura record. This
   * family is the auras NO ability names: a mob's, an encounter's, a battleground
   * rune's, a set bonus's. An aura applied by an ability you can name carries that
   * ability's id and is answered by `ability()` instead, which is the same order
   * the game's own resolver checks in.
   *
   * Null until the manifest has been read, unlike `ability` and `item`. The family
   * is closed and covers the complement of what `ability` already answers, so
   * guessing a URL here would 404 for most ids and reach the same blank slot. Call
   * `preloadAuras` when the first row drawn needs to be exact.
   */
  aura: (auraId: string) => string | null;
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
  /** The same for auras, which need it more: `aura` answers null until this lands. */
  preloadAuras: () => Promise<void>;
}

/** The URL builders, over a source of truth about which ids have a file. */
export function createIconUrls(art: SkillArt, items: ItemArt, auras: AuraArt): IconUrls {
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
      if (segment(itemId) === null) {
        return null;
      }
      // The file serving this item, which is its own id, a Heroic variant's base,
      // or null once the manifest has been read and says neither. Optimistic
      // before that read, exactly as `ability` is: treating "not known yet" as
      // absent would blank every cell of the first bag grid drawn in a session.
      const fileId = segment(items.fileIdFor(itemId));
      if (fileId === null) {
        return null;
      }
      return `${ITEM_DIR}/${fileId}${EXTENSION}`;
    },

    // Already a whole URL by the time it gets here: the manifest resolves an aura
    // that borrows another family's painting to that family's own path, so there
    // is no directory for this one to compose.
    aura: (auraId) => auras.urlFor(auraId),

    itemArtName: (itemId) => items.artName(itemId),

    preload: (cls) => art.preload(cls),

    preloadItems: () => items.preload(),

    preloadAuras: () => auras.preload(),
  };
}
