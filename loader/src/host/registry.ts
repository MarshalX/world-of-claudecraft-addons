// Installed addon set and enable state, persisted in GM storage.
//
// The state half is real. The members that need a marketplace fetch (install,
// update, source) are not built yet and reject rather than answering, so a
// caller cannot mistake "not built" for "nothing to do".

import { diagError } from '../shared/diag.ts';
import type { InstalledAddon, RegistryApi, StorageApi } from '../shared/protocol.ts';
import { InstalledAddon as InstalledAddonSchema, validate } from '../shared/schema.ts';

/** The loader's own storage namespace, alongside the per-addon `addon:<fqid>` ones. */
const REGISTRY_NS = 'loader';
const INSTALLED_KEY = 'installed';

/**
 * Rejects rather than throwing.
 *
 * Every member here is typed as returning a promise, and a synchronous throw
 * from one is a different failure for a direct caller than for a bridged one:
 * Comlink turns a throw into a rejection, so the bridge hides the difference and
 * the manager, which holds the registry directly when it can, does not.
 */
function pending(member: string): Promise<never> {
  return Promise.reject(new Error(`not implemented: ${member}`));
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

export type RegistryStorage = Pick<StorageApi, 'get' | 'set'>;

export interface RegistryDeps {
  storage: RegistryStorage;
  /** Called after a write that changed something, so the manager can refresh. */
  onChanged: () => void;
}

export function createRegistry(deps: RegistryDeps): RegistryApi {
  const { storage } = deps;

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
      await storage.set(REGISTRY_NS, INSTALLED_KEY, rows);
      deps.onChanged();
    },

    install: () => pending('registry.install'),
    uninstall: () => pending('registry.uninstall'),
    update: () => pending('registry.update'),
    source: () => pending('registry.source'),
  };
}
