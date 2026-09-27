// Where the game's own art lives, in one place so no addon hardcodes a path.
//
// The same same-origin directories the game's HUD reads, with file names derived from ids.
//
// A skill icon is filed UNDER ITS CLASS, so the caller must name the class
// (`world.player.templateId` for a player). Do not bundle an ability-to-class table: it is
// content and would go stale looking correct. Abilities without painted art are drawn by a
// game canvas recipe that has no URL.
//
// Three served manifests make the answers exact: `kit/skill-art.ts` and `kit/item-art.ts`
// (optimistic until read, the image load deciding), and `kit/aura-art.ts` (null until read).

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
 * An id that could name a file, or null. Encoded, since a wire id carrying a slash would escape the
 * directory.
 */
function segment(id: unknown): string | null {
  if (typeof id !== 'string' || id.length === 0) {
    return null;
  }
  return encodeURIComponent(id);
}

/** The URL builders addons use rather than writing a path. Each answers null for an unusable id. */
export interface IconUrls {
  /**
   * A class ability's icon, or null. `cls` is the ability's class (`world.player.templateId`
   * for anything you cast); null without it, and null once the class manifest says no file.
   */
  ability: (abilityId: string, cls: string) => string | null;
  /** A mob or npc portrait, by the `templateId` on its entity. */
  mob: (templateId: string) => string | null;
  /**
   * An item's icon, or null once the manifest says no file. A Heroic weapon variant answers
   * with its base weapon's painting, as the game draws it.
   */
  item: (itemId: string) => string | null;
  /**
   * The name the item's ART was filed under, or null. Not the item's name: nothing keeps the
   * two in step. Null with no file, for a generated batch, and before the manifest is read.
   */
  itemArtName: (itemId: string) => string | null;
  /**
   * An aura's painted icon by aura id, or null. Covers auras no ability names; one carrying an
   * ability id is answered by `ability()`. Null until read: call `preloadAuras` for the first row.
   */
  aura: (auraId: string) => string | null;
  /**
   * Read a class's art manifest, so `ability` is exact from the first call. Optional; never
   * rejects.
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
      // Only a definite `false` withholds the URL; `null` is "not read yet".
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
      // Its own id, a Heroic variant's base, or null once read; optimistic before that.
      const fileId = segment(items.fileIdFor(itemId));
      if (fileId === null) {
        return null;
      }
      return `${ITEM_DIR}/${fileId}${EXTENSION}`;
    },

    // Already a whole URL: a borrowed painting lives in another family's directory.
    aura: (auraId) => auras.urlFor(auraId),

    itemArtName: (itemId) => items.artName(itemId),

    preload: (cls) => art.preload(cls),

    preloadItems: () => items.preload(),

    preloadAuras: () => auras.preload(),
  };
}
