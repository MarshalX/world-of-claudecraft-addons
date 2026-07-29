// Installed addon set, enable state, and the cached entry source.
//
// Install is the only thing that fetches code. What is persisted afterwards is
// the manifest, the enable flag, and the source body, so enabling an addon is a
// storage read rather than a network call and a marketplace that goes offline
// does not take every addon installed from it down with it.
//
// The local dev source is the deliberate exception, and only for the body: it is
// re-fetched on every read so that reopening the game picks up whatever is on
// disk now. That is the entire point of pointing the loader at a dev server, and
// it is bounded to `localhost` by shared/marketplace.ts.

import { diagError } from '../shared/diag.ts';
import { fileUrl, LOCAL_ID, type MarketplaceRef, splitFqid } from '../shared/marketplace.ts';
import type { InstalledAddon, RegistryApi, StorageApi } from '../shared/protocol.ts';
import { InstalledAddon as InstalledAddonSchema, validate } from '../shared/schema.ts';
import type { Fetcher } from './fetcher.ts';
import type { MarketService } from './marketplace.ts';
import { computeUpdates } from './updates.ts';

/** The loader's own storage namespace, alongside the per-addon `addon:<fqid>` ones. */
const REGISTRY_NS = 'loader';
const INSTALLED_KEY = 'installed';

/** One addon's cached entry body. Kept off the installed list, which stays small. */
function sourceKey(fqid: string): string {
  return `source:${fqid}`;
}

/**
 * Read the persisted set, dropping any record that no longer parses.
 *
 * Dropping rather than throwing keeps one corrupt record from hiding every other
 * installed addon, and the diagnostic is what makes the loss visible. The next
 * write persists the surviving list, so a dropped record is gone at that point
 * rather than merely hidden.
 */
async function readInstalled(storage: RegistryStorage): Promise<InstalledAddon[]> {
  const raw = await storage.get(REGISTRY_NS, INSTALLED_KEY);
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    diagError('the installed-addon registry is not an array, reading it as empty', raw);
    return [];
  }

  const kept: InstalledAddon[] = [];
  for (const record of raw) {
    const parsed = validate(InstalledAddonSchema, record);
    if (parsed.ok) {
      kept.push(parsed.value);
    } else {
      diagError('dropping an unreadable installed-addon record', parsed.issues);
    }
  }
  return kept;
}

/** Where one addon's entry file lives in its marketplace. */
function entryUrl(market: MarketplaceRef, path: string, entry: string): string {
  return fileUrl(market, `${path}/${entry}`);
}

type RegistryStorage = Pick<StorageApi, 'get' | 'set' | 'delete'>;

/** One addon's registry row and the body that goes with it. */
interface Acquired {
  row: InstalledAddon;
  source: string;
}

interface RegistryDeps {
  storage: RegistryStorage;
  /**
   * `entry` says where an addon's files are; `api.list` is what update rows are
   * compared against, and it answers from the indexes as they were last read
   * rather than fetching.
   */
  market: Pick<MarketService, 'entry' | 'api'>;
  fetcher: Pick<Fetcher, 'get' | 'forget'>;
  /** Called after a write that changed something, so the manager can refresh. */
  onChanged: () => void;
}

/** Fetch one addon's manifest and body from its marketplace, or throw. */
async function acquire(deps: RegistryDeps, fqid: string): Promise<Acquired> {
  const found = await deps.market.entry(fqid);
  if (found === null) {
    throw new Error(`${fqid} is not offered by any marketplace in the list`);
  }
  const { market: source, row } = found;
  const url = entryUrl(source, row.path, row.entry);
  const { body } = await deps.fetcher.get(url);
  if (body.trim().length === 0) {
    throw new Error(`${url} is empty, so there is nothing to install`);
  }

  // `path` is the index's own field and is not part of a manifest, so it is
  // dropped rather than persisted: it is re-read from the index on update, and a
  // stale copy of it would send the next fetch to the wrong directory.
  const { path: _path, ...manifest } = row;
  return {
    row: { fqid, marketplace: source.id, manifest, enabled: true, pin: null },
    source: body,
  };
}

/** The URL an addon's body comes from, or null if no source offers it. */
async function originOf(deps: RegistryDeps, fqid: string): Promise<string | null> {
  const found = await deps.market.entry(fqid);
  if (found === null) {
    return null;
  }
  return entryUrl(found.market, found.row.path, found.row.entry);
}

/**
 * Re-read a dev-server addon, falling back to the cached body.
 *
 * The dev source is the deliberate exception to reading from the cache:
 * reopening the game has to pick up whatever is on disk now, which is the entire
 * point of pointing the loader at a dev server. A server that is not running
 * must leave the last body it served working rather than disabling the addon,
 * so a failure here is a diagnostic and not a rejection.
 */
async function refetchLocal(deps: RegistryDeps, fqid: string): Promise<string | null> {
  try {
    const url = await originOf(deps, fqid);
    if (url === null) {
      return null;
    }
    const { body } = await deps.fetcher.get(url);
    await deps.storage.set(REGISTRY_NS, sourceKey(fqid), body);
    return body;
  } catch (err) {
    diagError(`could not re-read ${fqid} from the dev server, using the cached body`, err);
    return null;
  }
}

type Write = (rows: readonly InstalledAddon[]) => Promise<void>;

/**
 * Fetch and persist an addon that is not installed yet, ready to run.
 *
 * It lands ENABLED. The design's original lifecycle had install fetch only the
 * manifest and enable go and get the code, which made "installed but off" a
 * state that meant something: nothing had been downloaded. This implementation
 * caches the body at install so that enabling is never a network call, so by the
 * time the row exists the code is already on disk and the separation protects
 * nothing. What it cost was real: the player accepts a confirmation that says to
 * install only what they would trust as a browser extension, and then nothing
 * runs.
 *
 * Nothing unsafe follows from starting it. The supervisor records a throw as
 * `failed` and badges it, and an addon declaring an apiVersion or gameVersion
 * this loader cannot honour is marked `incompatible` and never evaluated.
 */
async function install(deps: RegistryDeps, write: Write, fqid: string): Promise<void> {
  const rows = await readInstalled(deps.storage);
  if (rows.some((candidate) => candidate.fqid === fqid)) {
    throw new Error(`${fqid} is already installed`);
  }
  const { row, source } = await acquire(deps, fqid);
  // The body first: a record with no cached source would show in the list as
  // installed and fail on every enable.
  await deps.storage.set(REGISTRY_NS, sourceKey(fqid), source);
  await write([...rows, row]);
}

/**
 * Drop the record and its cached body, keeping the addon's own data.
 *
 * Uninstalling to fix something and reinstalling is the common case, and it
 * should not silently cost the player their settings and window positions.
 */
async function uninstall(deps: RegistryDeps, write: Write, fqid: string): Promise<void> {
  const rows = await readInstalled(deps.storage);
  const kept = rows.filter((candidate) => candidate.fqid !== fqid);
  if (kept.length === rows.length) {
    throw new Error(`${fqid} is not installed`);
  }
  await deps.storage.delete(REGISTRY_NS, sourceKey(fqid));
  const url = await originOf(deps, fqid);
  if (url !== null) {
    // Otherwise a reinstall would issue a conditional request, get a 304, and be
    // served the body from before the uninstall.
    await deps.fetcher.forget(url);
  }
  await write(kept);
}

/**
 * Hold an addon at a version, or release it back to tracking its marketplace.
 *
 * Nothing is fetched. A marketplace serves one version per ref, so there is no
 * older body to go back to and a pin cannot mean "install that instead"; what it
 * means is that this addon stops being offered an update. Validation runs
 * through the registry's own schema rather than a second copy of the version
 * pattern, so a pin can only ever be a shape the record itself would accept.
 */
async function setPin(
  deps: RegistryDeps,
  write: Write,
  fqid: string,
  version: string | null,
): Promise<void> {
  const rows = await readInstalled(deps.storage);
  const at = rows.findIndex((candidate) => candidate.fqid === fqid);
  const current = rows[at];
  if (current === undefined) {
    throw new Error(`cannot pin an addon that is not installed: ${fqid}`);
  }
  if (current.pin === version) {
    return;
  }

  const next = { ...current, pin: version };
  const parsed = validate(InstalledAddonSchema, next);
  if (!parsed.ok) {
    const reasons = parsed.issues.map((issue) => issue.message).join('; ');
    throw new Error(`cannot pin ${fqid}: ${reasons}`);
  }
  rows[at] = parsed.value;
  await write(rows);
}

/** Replace the manifest and body, keeping the enable flag and the pin. */
async function update(deps: RegistryDeps, write: Write, fqid: string): Promise<void> {
  const rows = await readInstalled(deps.storage);
  const at = rows.findIndex((candidate) => candidate.fqid === fqid);
  const current = rows[at];
  if (current === undefined) {
    throw new Error(`${fqid} is not installed`);
  }
  const { row, source } = await acquire(deps, fqid);
  await deps.storage.set(REGISTRY_NS, sourceKey(fqid), source);
  // Only what the marketplace owns is replaced.
  rows[at] = { ...row, enabled: current.enabled, pin: current.pin };
  await write(rows);
}

function createRegistry(deps: RegistryDeps): RegistryApi {
  const { storage } = deps;

  const write: Write = async (rows) => {
    await storage.set(REGISTRY_NS, INSTALLED_KEY, rows);
    deps.onChanged();
  };

  return {
    list: () => readInstalled(storage),

    setEnabled: async (fqid, on) => {
      const rows = await readInstalled(storage);
      const row = rows.find((candidate) => candidate.fqid === fqid);
      if (row === undefined) {
        throw new Error(`cannot set the enable state of an addon that is not installed: ${fqid}`);
      }
      // A no-op write still wakes every other tab through the value-change
      // listener, so the already-in-that-state case returns before touching
      // storage.
      if (row.enabled === on) {
        return;
      }
      row.enabled = on;
      await write(rows);
    },

    install: (fqid) => install(deps, write, fqid),
    uninstall: (fqid) => uninstall(deps, write, fqid),
    update: (fqid) => update(deps, write, fqid),
    setPin: (fqid, version) => setPin(deps, write, fqid, version),

    updates: async () => {
      const [installed, markets] = await Promise.all([
        readInstalled(storage),
        deps.market.api.list(),
      ]);
      return computeUpdates(installed, markets);
    },

    source: async (fqid) => {
      if (splitFqid(fqid)?.marketplace === LOCAL_ID) {
        const fresh = await refetchLocal(deps, fqid);
        if (fresh !== null) {
          return fresh;
        }
      }
      const cached = await storage.get(REGISTRY_NS, sourceKey(fqid));
      if (typeof cached === 'string' && cached.length > 0) {
        return cached;
      }
      throw new Error(`no cached source for ${fqid}: reinstall or update it`);
    },
  };
}

export type { RegistryDeps, RegistryStorage };
export { createRegistry, INSTALLED_KEY, REGISTRY_NS, sourceKey };
