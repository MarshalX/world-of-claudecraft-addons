// Which abilities the deployed game ships a painted icon FILE for.
//
// The game draws an icon for every ability, but only some are files: the rest are
// composited on a canvas by a module an addon cannot reach and has no URL at all. So
// `icon.ability()` can be right about a subset and is silent about the remainder, and
// before this existed the only way to tell those apart was to load the image and
// watch it fail. A blank icon slot meant either "the game has no file for this" or
// "the loader built the wrong id", which is an ambiguity that cost a long session
// chasing a bug in the second category while looking at rows from the first.
//
// The manifest the game serves at `/ui/skills/<class>/mapping.json` settles it, and
// reading it from the game rather than bundling a copy is the same call the sound
// pack makes: it is content, it changes on a game release, and a copy would go stale
// while looking authoritative.
//
// The read stays SYNCHRONOUS, which is the constraint everything here is shaped
// around: `icon.ability()` is called while building a row, and an addon drawing a
// frameful of bars cannot await per row. So a class is fetched in the background on
// first use and the answer is optimistic until it lands: unknown means "hand back the
// URL and let the image decide", which is exactly the behaviour that came before, so
// the first row of a session is never worse off than it was. Every row after it is
// exact. `preload` is for an addon that wants the first one exact too.

/** What one class's manifest is known to contain, or that it could not be read. */
type ClassArt = ReadonlySet<string> | 'unreadable';

interface SkillArt {
  /**
   * Read a class's manifest, resolving once the answer is known either way.
   *
   * Never rejects. A manifest that cannot be read is a permanent "unknown", not an
   * error an addon should handle: the game still draws the icon, and the loader
   * simply cannot say in advance whether a URL will resolve.
   */
  preload: (cls: string) => Promise<void>;
  /**
   * Whether this class ships a file for this ability.
   *
   * Null while the manifest for that class has not been read, which is a third
   * answer rather than a false: the caller must not turn "not known yet" into "no
   * icon", or every first row would lose an icon it was entitled to.
   */
  has: (cls: string, id: string) => boolean | null;
}

interface SkillArtDeps {
  fetchJson: (url: string) => Promise<unknown>;
}

function manifestUrl(cls: string): string {
  return `/ui/skills/${encodeURIComponent(cls)}/mapping.json`;
}

/**
 * The ability ids a manifest names, or null for a payload that is not one.
 *
 * Deliberately lenient about entries it cannot read while being strict about the
 * shape: one malformed entry loses one icon, whereas rejecting the whole manifest
 * loses the certainty for every ability in the class.
 */
function idsFrom(manifest: unknown, cls: string): ReadonlySet<string> | null {
  if (typeof manifest !== 'object' || manifest === null) {
    return null;
  }
  const record = manifest as { class?: unknown; abilities?: unknown };
  if (record.class !== cls || !Array.isArray(record.abilities)) {
    return null;
  }
  const ids = new Set<string>();
  for (const entry of record.abilities as readonly unknown[]) {
    const id = (entry as { abilityId?: unknown } | null)?.abilityId;
    if (typeof id === 'string' && id.length > 0) {
      ids.add(id);
    }
  }
  return ids;
}

function createSkillArt(deps: SkillArtDeps): SkillArt {
  const known = new Map<string, ClassArt>();
  /** In-flight reads, so a frameful of rows costs one request rather than one each. */
  const reading = new Map<string, Promise<void>>();

  const read = async (cls: string): Promise<void> => {
    try {
      known.set(cls, idsFrom(await deps.fetchJson(manifestUrl(cls)), cls) ?? 'unreadable');
    } catch {
      // A class with no manifest is the ordinary case for a class the game does not
      // have, so this is a reading rather than a fault. Recorded so it is not retried
      // on every row for the rest of the session.
      known.set(cls, 'unreadable');
    }
  };

  const ensure = (cls: string): Promise<void> => {
    if (known.has(cls)) {
      return Promise.resolve();
    }
    const running = reading.get(cls) ?? read(cls).finally(() => reading.delete(cls));
    reading.set(cls, running);
    return running;
  };

  return {
    preload: ensure,

    has: (cls, id) => {
      const art = known.get(cls);
      if (art === undefined) {
        // Start the read, and answer "not known" for this call. Nothing awaits it:
        // the point of the cache is that the row after this one is exact.
        ensure(cls).catch(() => undefined);
        return null;
      }
      if (art === 'unreadable') {
        return null;
      }
      return art.has(id);
    },
  };
}

export type { SkillArt, SkillArtDeps };
export { createSkillArt, idsFrom, manifestUrl };
