// The host <-> runtime bridge contract.
//
// The host exposes an implementation with Comlink.expose() on its end of the
// MessageChannel; the runtime holds it as Comlink.wrap<HostApi>(port). Every
// member is therefore async across the realm boundary.

import type * as Comlink from 'comlink';
import { isBuiltinMarketplace, type MarketplaceRef } from './marketplace.ts';
// Type-only: erased at build, so zod never reaches the runtime bundle.
import type { InstalledAddon, MarketplaceEntry } from './schema.ts';

/**
 * Re-exported rather than declared here, so the shape the registry validates on
 * read and the shape the bridge carries cannot drift apart.
 */
export type { InstalledAddon, MarketplaceEntry } from './schema.ts';

export interface MarketplaceState {
  ref: MarketplaceRef;
  /** True for a source that ships with the loader and has no remove control. */
  builtin: boolean;
  fetchedAt: number | null;
  /**
   * Index rows, which carry the addon's directory alongside its manifest.
   * Install needs the path, so the entry is kept whole rather than reduced.
   */
  addons: MarketplaceEntry[];
  error: string | null;
}

export type HostEvent =
  | { k: 'storage.changed'; ns: string; key: string; value: unknown }
  | { k: 'registry.changed' }
  | { k: 'market.changed'; id: string }
  | { k: 'market.progress'; id: string; state: 'fetching' | 'ok' | 'error'; error?: string }
  | { k: 'dev.changed' }
  /**
   * One addon's source changed at its origin and should be re-evaluated.
   *
   * Distinct from registry.changed because nothing about the installed set moved:
   * the same addon at the same version has a different body, which is what a save
   * against the dev server produces. Treating it as a registry change would
   * reload the list and leave the running closure as it was.
   */
  | { k: 'addon.reload'; fqid: string }
  /**
   * Open the manager.
   *
   * The only host-originated UI command. GM_registerMenuCommand exists solely in
   * the sandbox, and the manager lives solely in the page realm, so the
   * userscript popup entry has no other way to reach it. That entry is the one
   * route that still works when in-game injection fails, which is what keeps the
   * loader from becoming unreachable after a game update.
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
   * The addon's entry source, from the cache written at install.
   *
   * Cached rather than re-fetched so a marketplace that goes offline does not
   * take every installed addon with it, and so enabling an addon is not a
   * network operation. The dev source is the exception: see DevApi.
   */
  source: (fqid: string) => Promise<string>;
}

export interface MarketApi {
  list: () => Promise<MarketplaceState[]>;
  add: (url: string) => Promise<void>;
  /** Rejects any built-in id. */
  remove: (id: string) => Promise<void>;
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
 * The runtime's view of HostApi.
 *
 * Comlink's proxy resolves a whole property path at call time, so
 * `host.storage.get(...)` works, but Remote<HostApi> types a nested object
 * property as a promise of the object. Naming the facets as remotes describes
 * what the proxy actually does.
 */
export interface RemoteHostApi {
  registry: Comlink.Remote<RegistryApi>;
  market: Comlink.Remote<MarketApi>;
  dev: Comlink.Remote<DevApi>;
  storage: Comlink.Remote<StorageApi>;
  subscribe: (onEvent: (event: HostEvent) => void) => Promise<void>;
}

/**
 * Whether a marketplace may be removed.
 *
 * Called by MarketApi.remove inside the host, so hiding the control in the UI is
 * presentation only and not what enforces it. The local dev source is refused
 * for a different reason than the official one: it is never persisted, so there
 * is nothing to remove, and turning dev mode off is what takes it away.
 */
export function canRemoveMarketplace(id: string): boolean {
  return !isBuiltinMarketplace(id);
}
