// The host <-> runtime bridge contract.
//
// The host exposes an implementation with Comlink.expose() on its end of the
// MessageChannel; the runtime holds it as Comlink.wrap<HostApi>(port). Every
// member is therefore async across the realm boundary.

import type { MarketplaceRef } from './marketplace.ts';
// Type-only: erased at build, so zod never reaches the runtime bundle.
import type { AddonManifest } from './schema.ts';

export const OFFICIAL_ID = 'official';

export interface InstalledAddon {
  fqid: string;
  marketplace: string;
  manifest: AddonManifest;
  enabled: boolean;
  /** Pinned version, or null to track the marketplace index. */
  pin: string | null;
}

export interface MarketplaceState {
  ref: MarketplaceRef;
  /** True for the built-in entry, which renders first and without a remove control. */
  builtin: boolean;
  fetchedAt: number | null;
  addons: AddonManifest[];
  error: string | null;
}

export type HostEvent =
  | { k: 'storage.changed'; ns: string; key: string; value: unknown }
  | { k: 'registry.changed' }
  | { k: 'market.changed'; id: string }
  | { k: 'market.progress'; id: string; state: 'fetching' | 'ok' | 'error'; error?: string };

export interface RegistryApi {
  list: () => Promise<InstalledAddon[]>;
  setEnabled: (fqid: string, on: boolean) => Promise<void>;
  install: (fqid: string) => Promise<void>;
  uninstall: (fqid: string) => Promise<void>;
  update: (fqid: string) => Promise<void>;
  /** The addon's entry source. Fetched on install and on explicit update only. */
  source: (fqid: string) => Promise<string>;
}

export interface MarketApi {
  list: () => Promise<MarketplaceState[]>;
  add: (url: string) => Promise<void>;
  /** Rejects OFFICIAL_ID. */
  remove: (id: string) => Promise<void>;
  refresh: (id?: string) => Promise<void>;
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
  storage: StorageApi;
  /** The callback must be wrapped in Comlink.proxy() by the caller. */
  subscribe: (onEvent: (event: HostEvent) => void) => Promise<void>;
}

/**
 * Whether a marketplace may be removed.
 *
 * Called by MarketApi.remove inside the host, so hiding the control in the UI is
 * presentation only and not what enforces it.
 */
export function canRemoveMarketplace(id: string): boolean {
  return id !== OFFICIAL_ID;
}
