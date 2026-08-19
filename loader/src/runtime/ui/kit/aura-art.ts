// Which auras the deployed game ships a painted icon FILE for.
//
// The third served art manifest, after `skill-art.ts` and `item-art.ts`, and the
// newest: game 0.39.0 added `/ui/auras/mapping.json` and the directory under it.
// Before that release an aura had no icon an addon could point at unless it
// happened to carry a real ability id, so everything a fight actually puts on a
// unit that is NOT one of your own spells (a mob's aura family, an encounter's
// mechanic, a battleground rune, a set bonus, resurrection sickness) drew a bare
// row with a name on it.
//
// TWO ways an entry resolves, and the second is why this module answers a URL
// where `item-art.ts` answers a file id. Most entries are `assets[]`, a file under
// `/ui/auras`. Five are `externalAssets[]`, auras the game deliberately draws from
// ANOTHER family's painting and which carry the finished `runtimeUrl` to it
// (`/ui/delve-affixes/`, `/ui/fiesta/powerups/`). Resolving those by composing a
// path under this directory would build a URL for a file that is not there.
//
// NOT OPTIMISTIC, which is the one place this departs from the two modules it is
// modelled on, and the ratio is the whole reason. `item-art.ts` hands back the id
// before its manifest lands because at game 0.39.0 all but a handful of the game's
// 823 items ship a file, so guessing yes is right nearly every time. This family is
// CLOSED and small, 134 ids against every aura the game can apply, and it covers
// the complement of what `icon.ability()` already answers: the game's own resolver
// (`auraImageUrl` in `src/ui/icons.ts`) checks this family first and then falls
// back to the ability art for an aura carrying an ability id. So most ids handed to
// this one are legitimately not in it, and being optimistic would mean a request
// per aura row that 404s more often than not, to end at the same blank slot. One
// read settles it instead, and `preload` is there for a caller that wants the
// first row exact.

/** What the manifest is known to contain, or that it could not be read. */
type KnownArt = ReadonlyMap<string, string> | 'unreadable';

interface AuraArt {
  /**
   * Read the manifest, resolving once the answer is known either way.
   *
   * Never rejects. A manifest that cannot be read is a permanent "unknown" rather
   * than an error an addon should handle: the game still draws the icon, and the
   * loader simply cannot say which URL it used.
   */
  preload: () => Promise<void>;
  /**
   * The URL of this aura's painted art, or null when there is none to point at.
   *
   * Null while the manifest has NOT been read, unlike the other two art modules.
   * The family is closed and covers only auras no ability id names, so answering
   * a composed URL before the read would 404 for most ids and land on the same
   * blank slot a null does, having spent a request to get there.
   */
  urlFor: (auraId: string) => string | null;
}

interface AuraArtDeps {
  fetchJson: (url: string) => Promise<unknown>;
}

const MANIFEST_URL = '/ui/auras/mapping.json';
const AURA_DIR = '/ui/auras';

/**
 * A manifest string that could name a file under this directory, or null.
 *
 * Encoded rather than trusted, for the reason `icons.ts` encodes an id: the value
 * arrives from a document on the game's origin, and one carrying a slash would
 * otherwise build a URL pointing somewhere else on it entirely.
 */
function fileSegment(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return encodeURIComponent(value);
}

/**
 * An `externalAssets` URL, accepted only as a same-origin absolute path.
 *
 * The game means these to reach another of its own art directories, so anything
 * that could leave the origin is dropped rather than served to an addon: a
 * protocol-relative `//host/x` and an absolute `https://host/x` both start a
 * different origin, and a relative path would resolve against whatever page the
 * loader happens to be on.
 */
function externalUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return null;
  }
  return value;
}

/**
 * A manifest field read as a list, empty for anything that is not one.
 *
 * `externalAssets` is absent on a manifest that borrows nothing, which is a shape
 * this must tolerate rather than reject: the five borrowed paintings are the
 * game's editorial choice and it is free to stop making it.
 */
function listOf(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value as readonly unknown[];
}

/**
 * Every aura id the manifest names, mapped to its URL, or null for a payload that
 * is not this manifest.
 *
 * Lenient about an entry it cannot read and strict about the shape, the same split
 * `skill-art.ts` makes: one malformed entry loses one icon, while rejecting the
 * whole manifest loses the certainty for every aura in the game. `family` is the
 * shape check, standing in for the `class` field the per-class skill manifests
 * carry: without it a payload that is not this manifest reads as one naming nothing.
 */
function urlsFrom(manifest: unknown): ReadonlyMap<string, string> | null {
  if (typeof manifest !== 'object' || manifest === null) {
    return null;
  }
  const record = manifest as { family?: unknown; assets?: unknown; externalAssets?: unknown };
  if (record.family !== 'auras' || !Array.isArray(record.assets)) {
    return null;
  }
  const urls = new Map<string, string>();
  for (const entry of record.assets as readonly unknown[]) {
    const row = entry as { auraId?: unknown; output?: unknown } | null;
    const id = fileSegment(row?.auraId);
    const file = fileSegment(row?.output);
    if (id !== null && file !== null) {
      urls.set(row?.auraId as string, `${AURA_DIR}/${file}`);
    }
  }
  for (const entry of listOf(record.externalAssets)) {
    const row = entry as { auraId?: unknown; runtimeUrl?: unknown } | null;
    const url = externalUrl(row?.runtimeUrl);
    if (typeof row?.auraId === 'string' && row.auraId.length > 0 && url !== null) {
      urls.set(row.auraId, url);
    }
  }
  return urls;
}

function createAuraArt(deps: AuraArtDeps): AuraArt {
  let known: KnownArt | undefined;
  /** One manifest and one URL, so a frameful of aura rows costs one request. */
  let reading: Promise<void> | undefined;

  const read = async (): Promise<void> => {
    try {
      known = urlsFrom(await deps.fetchJson(MANIFEST_URL)) ?? 'unreadable';
    } catch {
      // A game that serves no aura manifest is every version before 0.39.0, so
      // this is a reading rather than a fault. Recorded so it is not retried on
      // every row for the rest of the session.
      known = 'unreadable';
    }
  };

  const ensure = (): Promise<void> => {
    if (known !== undefined) {
      return Promise.resolve();
    }
    reading ??= read().finally(() => {
      reading = undefined;
    });
    return reading;
  };

  return {
    preload: ensure,

    urlFor: (auraId) => {
      if (typeof auraId !== 'string' || auraId.length === 0) {
        return null;
      }
      if (known === undefined) {
        // Start the read and answer "none" for this call. Nothing awaits it: the
        // point of the cache is that the row after this one is exact.
        ensure().catch(() => undefined);
        return null;
      }
      if (known === 'unreadable') {
        return null;
      }
      return known.get(auraId) ?? null;
    },
  };
}

export type { AuraArt, AuraArtDeps };
export { createAuraArt, MANIFEST_URL, urlsFrom };
