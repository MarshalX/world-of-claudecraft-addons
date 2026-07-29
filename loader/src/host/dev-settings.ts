// The two dev-mode switches, and reading them back safely.
//
// Persisted in the loader's own namespace, so they survive a page reload the way
// every other setting does: hot reload that had to be turned on again after each
// refresh would not be worth having.
//
// The read is defensive because this is a GM value a player can edit. Anything
// that is not a boolean reads as OFF rather than as on, which is the direction
// that cannot surprise: the switched-on state polls localhost on a timer and
// puts an unreviewed source in the marketplace list.

import type { StorageApi } from '../shared/protocol.ts';

const NS = 'loader';
const DEV_KEY = 'dev';

interface DevSettings {
  /** Whether the local dev server is merged into the marketplace list. */
  enabled: boolean;
  /** Whether the loader polls that server and reloads a source that changed. */
  hotReload: boolean;
}

const DEV_DEFAULT: DevSettings = { enabled: false, hotReload: false };

type DevStorage = Pick<StorageApi, 'get' | 'set'>;

/** Read one persisted flag without letting a corrupt value become `true`. */
function readFlag(source: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = source[key];
  if (typeof value !== 'boolean') {
    return fallback;
  }
  return value;
}

function parseDevSettings(raw: unknown): DevSettings {
  if (raw === null || typeof raw !== 'object') {
    return DEV_DEFAULT;
  }
  const record = raw as Record<string, unknown>;
  return {
    enabled: readFlag(record, 'enabled', DEV_DEFAULT.enabled),
    hotReload: readFlag(record, 'hotReload', DEV_DEFAULT.hotReload),
  };
}

async function readDevSettings(storage: DevStorage): Promise<DevSettings> {
  return parseDevSettings(await storage.get(NS, DEV_KEY));
}

/** Merge a change into what is stored, and return the result. */
async function writeDevSettings(
  storage: DevStorage,
  patch: Partial<DevSettings>,
): Promise<DevSettings> {
  const next = { ...(await readDevSettings(storage)), ...patch };
  await storage.set(NS, DEV_KEY, next);
  return next;
}

export type { DevSettings, DevStorage };
export { DEV_DEFAULT, DEV_KEY, parseDevSettings, readDevSettings, writeDevSettings };
