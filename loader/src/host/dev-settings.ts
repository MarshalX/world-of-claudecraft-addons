// The two dev-mode switches, persisted so they survive a reload.
//
// Anything stored that is not a boolean reads as OFF: on means polling localhost and listing
// an unreviewed source.

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
