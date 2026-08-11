// Which items the deployed game ships a painted icon FILE for, and what the art
// was filed under.
//
// The same argument as `skill-art.ts` one content table over, with a bigger gap to
// describe. `icon.item()` used to hand back a URL for any id at all, which made a
// blank slot mean either "the game has no file for this" or "the loader built the
// wrong id", and a 404 cannot tell those apart. The manifest the game serves at
// `/ui/items/mapping.json` settles it before a request is made.
//
// The gap this describes has been most of the game's items and is currently
// almost nothing: at game 0.36.0 every item in the table ships a file except the
// sixteen HEROIC WEAPON VARIANTS below, and `ITEM_ART_PENDING` (the game's own
// ledger of art it has not commissioned) is empty. Read that as dated rather than
// as settled: the ledger refills whenever content lands ahead of its art, so
// `has()` still has a real false to answer and an addon still has to handle one.
//
// WEAPONS used to be the permanent half of that gap, filed under a MODEL name
// through a table the game does not serve. Game 0.36.0 gave every authored weapon
// bespoke painted art under its own item id and put it in this manifest, so the
// hole is closed except where the game closed it a second way: a generated Heroic
// copy ships NO file and reuses its base weapon's painting, exactly as it inherits
// the base held model. `fileIdFor` is that resolution, and it is a mirror of the
// game's own rather than a guess. Three things make it safe. The variant id is a
// pure prefix, `heroic_${baseId}`, frozen as such by the game's `heroicVariantId`;
// every one of the 64 variants in the table satisfies it, with no exceptions; and
// the resolved base is checked against the manifest like any other id, so a URL
// still means a file exists. Measured at 0.36.0: 16 weapons need it, 16 resolve,
// and none resolves to something that is not its own base. The one id starting
// with `heroic_` that is not a variant, `heroic_mark`, ships its own file and is
// answered before the fallback is reached.
//
// The manifest also carries a NAME per curated entry, and it is the ART SOURCE
// name rather than the item's. Nothing in the game keeps the two in step: measured
// against game 0.33.0, 281 of 303 agree and 21 do not, because a content rename
// rewrites the item table and leaves the art provenance alone. It is served here as
// what it is, labelled, and it is deliberately not generated into the published
// types: a name that looks authoritative and is wrong 7 percent of the time is
// worse than no name.
//
// The read stays SYNCHRONOUS for the reason `skill-art.ts` is: `icon.item()` is
// called while building a cell, and an addon drawing a bag grid cannot await per
// cell. So the manifest is fetched in the background on first use and the answer is
// optimistic until it lands. One manifest and one URL, so the in-flight read is one
// promise rather than a map of them: a 72 cell grid costs one request.

/** What the manifest is known to contain, or that it could not be read. */
interface ItemManifest {
  ids: ReadonlySet<string>;
  /** Curated entries only. A generated batch ships a file and carries no name. */
  names: ReadonlyMap<string, string>;
}

type KnownArt = ItemManifest | 'unreadable';

interface ItemArt {
  /**
   * Read the manifest, resolving once the answer is known either way.
   *
   * Never rejects. A manifest that cannot be read is a permanent "unknown", not an
   * error an addon should handle: the game still draws the icon, and the loader
   * simply cannot say in advance whether a URL will resolve.
   */
  preload: () => Promise<void>;
  /**
   * The manifest id whose FILE serves this item, or null when none does.
   *
   * The item's own id where the manifest lists it, its base weapon's id where it
   * is a Heroic variant reusing that painting, and null once the manifest has
   * been read and neither is listed.
   *
   * Answers the id itself while the manifest has NOT been read, which is the
   * optimism the whole module is built on rather than a claim: turning "not known
   * yet" into "no icon" would blank every cell of the first grid an addon draws,
   * and a URL that 404s costs an icon slot the kit already hides.
   */
  fileIdFor: (itemId: string) => string | null;
  /**
   * The name the item's ART was filed under, or null.
   *
   * Null for an id with no file, for an id that came from a generated batch (those
   * carry no name at all), and while the manifest has not been read.
   *
   * Resolved through `fileIdFor`, so a Heroic variant answers its base's name.
   * That is the accurate reading rather than a convenience: this names the FILE,
   * and the file is the base's painting. It also cannot disagree with the item's
   * own name any more than the base's does, since a Heroic copy is displayed
   * under the base item's name.
   */
  artName: (itemId: string) => string | null;
}

interface ItemArtDeps {
  fetchJson: (url: string) => Promise<unknown>;
}

/** The served square, which is what says a payload is this manifest and not another. */
const ICON_SIZE = 128;

const MANIFEST_URL = '/ui/items/mapping.json';

/**
 * What a generated Heroic copy's id is its base's id plus.
 *
 * The game's `heroicVariantId` calls it "a stable, pure prefix" and every one of
 * the 64 variants in the table satisfies `id === 'heroic_' + heroicOf`.
 */
const HEROIC_PREFIX = 'heroic_';

/** The ids a `generatedBatches` array names. Batches carry ids and no names. */
function readBatches(batches: readonly unknown[], ids: Set<string>): void {
  for (const batch of batches) {
    const listed = (batch as { itemIds?: unknown } | null)?.itemIds;
    if (Array.isArray(listed)) {
      for (const id of listed as readonly unknown[]) {
        if (typeof id === 'string' && id.length > 0) {
          ids.add(id);
        }
      }
    }
  }
}

/** The ids and names an `entries` array carries. An entry with no name still has a file. */
function readEntries(
  entries: readonly unknown[],
  ids: Set<string>,
  names: Map<string, string>,
): void {
  for (const entry of entries) {
    const record = entry as { itemId?: unknown; name?: unknown } | null;
    if (typeof record?.itemId === 'string' && record.itemId.length > 0) {
      ids.add(record.itemId);
      if (typeof record.name === 'string' && record.name.length > 0) {
        names.set(record.itemId, record.name);
      }
    }
  }
}

/**
 * The manifest's two lists, or null for a payload that is not one.
 *
 * `iconSize` is the shape check. Unlike the skill manifests there is no per-class
 * `class` field to catch a path that resolved to the wrong file, so this stands in
 * for it: it is 128 on every channel, and a payload that is not this manifest fails
 * on it and on the empty union both.
 *
 * Deliberately lenient about an entry it cannot read while being strict about the
 * shape: one malformed entry loses one icon, whereas rejecting the whole manifest
 * loses the certainty for every item in the game.
 */
function manifestFrom(payload: unknown): ItemManifest | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const record = payload as { iconSize?: unknown; entries?: unknown; generatedBatches?: unknown };
  if (record.iconSize !== ICON_SIZE) {
    return null;
  }
  const ids = new Set<string>();
  const names = new Map<string, string>();
  if (Array.isArray(record.entries)) {
    readEntries(record.entries as readonly unknown[], ids, names);
  }
  if (Array.isArray(record.generatedBatches)) {
    readBatches(record.generatedBatches as readonly unknown[], ids);
  }
  if (ids.size === 0) {
    return null;
  }
  return { ids, names };
}

/**
 * The listed id whose file serves this item, once the manifest is known.
 *
 * Pure, and outside the factory because it closes over nothing: the answer is a
 * function of the manifest and the id, which is what makes it the same reading
 * for `fileIdFor` and for `artName`.
 *
 * The base arm is tried only when the item's OWN id is absent, so an id that
 * merely starts with `heroic_` and ships its own painting never reaches it.
 */
function listedFor(known: ItemManifest, itemId: string): string | null {
  if (known.ids.has(itemId)) {
    return itemId;
  }
  if (!itemId.startsWith(HEROIC_PREFIX)) {
    return null;
  }
  const base = itemId.slice(HEROIC_PREFIX.length);
  if (!known.ids.has(base)) {
    return null;
  }
  return base;
}

/**
 * The one read, and what it is holding.
 *
 * Apart from the answers because it is a different concern: this is the caching
 * and the "at most one request in flight" rule, and `createItemArt` below is the
 * two questions asked of what it holds.
 */
function manifestReader(deps: ItemArtDeps): {
  ensure: () => Promise<void>;
  manifest: () => ItemManifest | null;
} {
  /** Undefined until the one read has finished, either way. */
  const state: { known: KnownArt | undefined; reading: Promise<void> | undefined } = {
    known: undefined,
    reading: undefined,
  };

  const read = async (): Promise<void> => {
    try {
      state.known = manifestFrom(await deps.fetchJson(MANIFEST_URL)) ?? 'unreadable';
    } catch {
      // A game that does not serve this manifest is a reading rather than a fault:
      // every item stays optimistic, which is what the loader did before it existed.
      // Recorded so it is not retried on every cell for the rest of the session.
      state.known = 'unreadable';
    }
  };

  const ensure = (): Promise<void> => {
    if (state.known !== undefined) {
      return Promise.resolve();
    }
    const running =
      state.reading ??
      read().finally(() => {
        state.reading = undefined;
      });
    state.reading = running;
    return running;
  };

  return {
    ensure,

    /** The manifest if it has been read and could be, and null in both other cases. */
    manifest: () => {
      if (state.known === undefined) {
        // Start the read, and answer "not known" for this call. Nothing awaits it:
        // the point of the cache is that the cell after this one is exact.
        ensure().catch(() => undefined);
        return null;
      }
      if (state.known === 'unreadable') {
        return null;
      }
      return state.known;
    },
  };
}

function createItemArt(deps: ItemArtDeps): ItemArt {
  const { ensure, manifest } = manifestReader(deps);

  return {
    preload: ensure,

    fileIdFor: (itemId) => {
      const known = manifest();
      if (known === null) {
        return itemId;
      }
      return listedFor(known, itemId);
    },

    artName: (itemId) => {
      const known = manifest();
      if (known === null) {
        return null;
      }
      const listed = listedFor(known, itemId);
      if (listed === null) {
        return null;
      }
      return known.names.get(listed) ?? null;
    },
  };
}

export type { ItemArt, ItemArtDeps };
export { createItemArt, MANIFEST_URL, manifestFrom };
