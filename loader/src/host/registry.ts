// Installed addon set, enable state, and what each addon has cached.
//
// Install is the only thing that fetches code. What is persisted afterwards is
// the manifest, the enable flag, the source body and every declared data file,
// so enabling an addon is a storage read rather than a network call and a
// marketplace that goes offline does not take every addon installed from it down
// with it.
//
// The fetching itself is addon-fetch.ts. What is here is the bookkeeping over
// the installed set: which rows exist, which are on, and which cached records
// each write has to keep in step with them.

import { diagError } from '../shared/diag.ts';
import { LOCAL_ID, splitFqid } from '../shared/marketplace.ts';
import type { InstalledAddon, RegistryApi } from '../shared/protocol.ts';
import { InstalledAddon as InstalledAddonSchema, validate } from '../shared/schema.ts';
import { readAddonData, writeAddonData } from './addon-data.ts';
import {
  acquire,
  type RegistryDeps,
  type RegistryStorage,
  refetchLocal,
  refetchLocalData,
  urlsOf,
} from './addon-fetch.ts';
import { dataKey, INSTALLED_KEY, REGISTRY_NS, sourceKey } from './registry-keys.ts';
import { computeUpdates } from './updates.ts';

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

type Write = (rows: readonly InstalledAddon[]) => Promise<void>;

/**
 * Fetch and persist an addon that is not installed yet, ready to run.
 *
 * It lands ENABLED. The lifecycle this replaced had install fetch only the
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
  const acquired = await acquire(deps, fqid);
  // The body first: a record with no cached source would show in the list as
  // installed and fail on every enable. The data files with it, for the same
  // reason: an addon whose first line calls woc.data must not race an install.
  await deps.storage.set(REGISTRY_NS, sourceKey(fqid), acquired.source);
  await writeAddonData(deps.storage, fqid, acquired.data);
  await write([...rows, acquired.row]);
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
  await deps.storage.delete(REGISTRY_NS, dataKey(fqid));
  // Otherwise a reinstall would issue a conditional request, get a 304, and be
  // served the copy from before the uninstall. Every file the addon brought, not
  // only its body: a data file has exactly the same cache entry.
  await Promise.all((await urlsOf(deps, fqid)).map((url) => deps.fetcher.forget(url)));
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
  const acquired = await acquire(deps, fqid);
  await deps.storage.set(REGISTRY_NS, sourceKey(fqid), acquired.source);
  await writeAddonData(deps.storage, fqid, acquired.data);
  // Only what the marketplace owns is replaced.
  rows[at] = { ...acquired.row, enabled: current.enabled, pin: current.pin };
  await write(rows);
}

/** Whether this addon came from the dev server, which is read differently. */
function isLocal(fqid: string): boolean {
  return splitFqid(fqid)?.marketplace === LOCAL_ID;
}

/** The addon's body: the dev server first when it is one, then the cache. */
async function readSource(deps: RegistryDeps, fqid: string): Promise<string> {
  if (isLocal(fqid)) {
    const fresh = await refetchLocal(deps, fqid);
    if (fresh !== null) {
      return fresh;
    }
  }
  const cached = await deps.storage.get(REGISTRY_NS, sourceKey(fqid));
  if (typeof cached === 'string' && cached.length > 0) {
    return cached;
  }
  throw new Error(`no cached source for ${fqid}: reinstall or update it`);
}

/**
 * One declared data file, the same way and in the same order the body is read.
 *
 * The refusal names the fix rather than the fault: a missing record means the
 * addon was installed by a loader that had never heard of `data`, which is the
 * player's to resolve by updating and not their addon author's.
 */
async function readData(deps: RegistryDeps, fqid: string, name: string): Promise<string> {
  if (isLocal(fqid)) {
    const fresh = await refetchLocalData(deps, fqid, name);
    if (fresh !== null) {
      return fresh;
    }
  }
  const cached = await readAddonData(deps.storage, fqid);
  const text = cached[name];
  if (typeof text === 'string') {
    return text;
  }
  throw new Error(
    `no cached data file "${name}" for ${fqid}. It is declared in the manifest but was ` +
      'never fetched, which means the addon was installed by an older loader: update it.',
  );
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

    source: (fqid) => readSource(deps, fqid),
    data: (fqid, name) => readData(deps, fqid, name),
  };
}

export { createRegistry };
