// The host <-> runtime bridge contract, exposed over Comlink, so every member is async.

import type * as Comlink from 'comlink';
import { isBuiltinMarketplace, type MarketplaceRef } from './marketplace.ts';
// Type-only: erased at build, so zod never reaches the runtime bundle.
import type { InstalledAddon, MarketplaceEntry } from './schema.ts';

/** Re-exported so the shape the registry validates and the shape the bridge carries are one. */
export type { InstalledAddon, MarketplaceEntry } from './schema.ts';

export interface MarketplaceState {
  ref: MarketplaceRef;
  /** True for a source that ships with the loader and has no remove control. */
  builtin: boolean;
  fetchedAt: number | null;
  /** Whole index rows, since install needs the directory path as well as the manifest. */
  addons: MarketplaceEntry[];
  /**
   * The rows came from enumerating the repository, not from marketplace.json. That costs one
   * request per addon against the rate limit, so the manager shows it.
   */
  degraded: boolean;
  error: string | null;
}

/** One installed addon that its marketplace now offers a newer version of. */
export interface UpdateRow {
  fqid: string;
  name: string;
  /** The marketplace id, for the source badge. */
  marketplace: string;
  installed: string;
  available: string;
  /** The version the player pinned to, or null when the addon tracks the index. */
  pin: string | null;
}

export type HostEvent =
  | { k: 'storage.changed'; ns: string; key: string; value: unknown }
  | { k: 'registry.changed' }
  | { k: 'market.changed'; id: string }
  | { k: 'market.progress'; id: string; state: 'fetching' | 'ok' | 'error'; error?: string }
  | { k: 'dev.changed' }
  /**
   * One addon's body changed at its origin (a dev-server save) and must be re-evaluated. A
   * registry.changed would reload the list and leave the running closure as it was.
   */
  | { k: 'addon.reload'; fqid: string }
  /**
   * Open the manager, from the userscript menu command in the sandbox. That route survives a game
   * update that breaks the in-game injection points.
   */
  | { k: 'ui.open' };

export interface RegistryApi {
  list: () => Promise<InstalledAddon[]>;
  setEnabled: (fqid: string, on: boolean) => Promise<void>;
  /** Fetch the manifest and entry source from the marketplace, then persist both. */
  install: (fqid: string) => Promise<void>;
  uninstall: (fqid: string) => Promise<void>;
  update: (fqid: string) => Promise<void>;
  /**
   * Hold an addon at a version, or null to track its marketplace again. Fetches nothing: a
   * marketplace serves one version per ref, so a pin only stops the update being offered.
   */
  setPin: (fqid: string, version: string | null) => Promise<void>;
  /**
   * Everything installed that its marketplace now offers a newer version of, from the indexes as
   * last read, with no fetch. Nothing auto-updates; this is what the Updates pane draws.
   */
  updates: () => Promise<UpdateRow[]>;
  /**
   * The addon's entry source, from the install cache, so an offline marketplace takes no addon
   * down with it. The dev source is re-read instead: see DevApi.
   */
  source: (fqid: string) => Promise<string>;
  /**
   * One declared data file's raw text, cached at install alongside `entry`. Text, parsed in the
   * page realm: the host has no use for the shape. The dev source re-reads on every call.
   */
  data: (fqid: string, name: string) => Promise<string>;
}

export interface MarketApi {
  list: () => Promise<MarketplaceState[]>;
  /**
   * Read any source this session has not read yet, and nothing else. The manager awaits it before
   * listing, or Browse is empty and the update check compares against no rows. The once-per-session
   * rule lives here so no caller can turn it into a fetch per open; a failed source counts as read.
   */
  ensure: () => Promise<void>;
  /**
   * Accept a source, optionally pinned to `ref`. Omitted or empty means the ref the URL carried,
   * or HEAD if it carried none.
   */
  add: (url: string, ref?: string) => Promise<void>;
  /** Rejects any built-in id. */
  remove: (id: string) => Promise<void>;
  /**
   * Repoint a user-added source at another branch, tag, or commit. Rejects a built-in id, whose
   * ref comes from the loader build.
   */
  setRef: (id: string, ref: string) => Promise<void>;
  refresh: (id?: string) => Promise<void>;
}

export interface DevState {
  /** Whether the local dev server is merged into the marketplace list. */
  enabled: boolean;
  /** Whether the loader polls that server and reloads a source that changed. */
  hotReload: boolean;
  origin: string;
  /** Wall-clock ms of the last poll, or null if none has run. */
  polledAt: number | null;
  error: string | null;
}

export interface DevApi {
  state: () => Promise<DevState>;
  setEnabled: (on: boolean) => Promise<void>;
  setHotReload: (on: boolean) => Promise<void>;
}

export interface StorageApi {
  get: (ns: string, key: string) => Promise<unknown>;
  set: (ns: string, key: string, value: unknown) => Promise<void>;
  delete: (ns: string, key: string) => Promise<void>;
  keys: (ns: string) => Promise<string[]>;
}

export interface HostApi {
  registry: RegistryApi;
  market: MarketApi;
  dev: DevApi;
  storage: StorageApi;
  /** The callback must be wrapped in Comlink.proxy() by the caller. */
  subscribe: (onEvent: (event: HostEvent) => void) => Promise<void>;
}

/**
 * The runtime's view of HostApi. Remote<HostApi> types a nested facet as a promise, but Comlink
 * resolves the whole path at call time, so each facet is named as a remote.
 */
export interface RemoteHostApi {
  registry: Comlink.Remote<RegistryApi>;
  market: Comlink.Remote<MarketApi>;
  dev: Comlink.Remote<DevApi>;
  storage: Comlink.Remote<StorageApi>;
  subscribe: (onEvent: (event: HostEvent) => void) => Promise<void>;
}

/**
 * Whether a marketplace may be removed. Enforced in the host, not the UI. The local dev source is
 * refused because it is never persisted; turning dev mode off removes it.
 */
export function canRemoveMarketplace(id: string): boolean {
  return !isBuiltinMarketplace(id);
}
