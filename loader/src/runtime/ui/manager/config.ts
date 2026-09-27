// What the manager needs to edit one addon's settings and keybinds.
//
// The manager uses the same stores an addon's `woc.settings` and `woc.keys` use, over the same
// storage hub, so a rebind here reaches a running addon through the store's change event.
//
// Stores are cached per fqid AND per declarations. A store hydrates from its declarations and
// refuses a write to anything they do not name, while the form renders from the manifest read
// fresh, so a pair cached across an addon update refuses the update's new fields. Validity is
// checked on every open rather than invalidated from a registry event, which could be missed.

import type { InstalledAddon } from '../../../shared/protocol.ts';
import type { GameBindingReading, GameBindings } from '../../keys/game-bindings.ts';
import { createKeybindStore, type KeybindStore } from '../../keys/store.ts';
import { createSettingsStore, type SettingsStore } from '../../settings/store.ts';
import type { StorageHub } from '../../storage/hub.ts';

/** A combo's conflicts: the game's side, the loader's side, and how good the read was. */
interface ConflictReading extends GameBindingReading {
  /** Other live addon bindings, as '<fqid>:<bindId>'. */
  addons: string[];
}

interface AddonConfig {
  settings: SettingsStore;
  keybinds: KeybindStore;
}

/** A cached pair, with the declarations it was built from so staleness is visible. */
interface CachedConfig {
  config: AddonConfig;
  declared: string;
}

/** A hydrate in flight, carrying what it is being built FOR. */
interface LoadingConfig {
  declared: string;
  promise: Promise<AddonConfig>;
}

type Cache = Map<string, CachedConfig>;

interface ConfigServiceDeps {
  hub: StorageHub;
  game: GameBindings;
  /** Every live addon binding, so the editor can warn about addon collisions. */
  addonBindings: () => Readonly<Record<string, string>>;
  onChange: () => void;
}

interface ConfigService {
  /** Build or return the cached stores, hydrated. */
  open: (addon: InstalledAddon) => Promise<AddonConfig>;
  /** The cached stores without loading. Takes the ROW, since stale declarations are a miss. */
  peek: (addon: InstalledAddon) => AddonConfig | null;
  conflicts: (combo: string) => ConflictReading;
  dispose: () => void;
}

/**
 * Everything a store is built from, as one comparable string. Serialised so ANY change is caught
 * without a field-by-field comparison to keep in step with the schema. Safe as text because the
 * row is schema output: key order is the schema's and no value is undefined, NaN or a function.
 */
function declarationsOf(addon: InstalledAddon): string {
  return JSON.stringify([addon.manifest.settings ?? [], addon.manifest.keybinds ?? []]);
}

/** The two stores one addon is configured through, unhydrated. */
function buildConfig(deps: ConfigServiceDeps, addon: InstalledAddon): AddonConfig {
  const config: AddonConfig = {
    settings: createSettingsStore({
      fqid: addon.fqid,
      decls: addon.manifest.settings ?? [],
      hub: deps.hub,
    }),
    keybinds: createKeybindStore({
      fqid: addon.fqid,
      decls: addon.manifest.keybinds ?? [],
      hub: deps.hub,
    }),
  };
  // The panes are pure renders, so a change from another tab has to trigger the repaint.
  config.settings.onChange(deps.onChange);
  config.keybinds.onChange(deps.onChange);
  return config;
}

/**
 * The cached pair if it still describes this row. A stale one is disposed now, or a manager open
 * across several updates accumulates a storage subscription per version of every addon.
 */
function usableConfig(cache: Cache, fqid: string, declared: string): AddonConfig | null {
  const cached = cache.get(fqid);
  if (cached === undefined) {
    return null;
  }
  if (cached.declared === declared) {
    return cached.config;
  }
  cached.config.settings.dispose();
  cached.config.keybinds.dispose();
  cache.delete(fqid);
  return null;
}

function createConfigService(deps: ConfigServiceDeps): ConfigService {
  const cache: Cache = new Map();
  /** Hydration is in flight at most once per addon, however fast the player clicks. */
  const loading = new Map<string, LoadingConfig>();

  /**
   * Build and hydrate a pair, and cache it unless it was superseded. An update can land during the
   * bridge round trip, and then the load for the NEW row owns the cache.
   */
  const load = (addon: InstalledAddon, declared: string): Promise<AddonConfig> => {
    const config = buildConfig(deps, addon);
    const promise = Promise.all([config.settings.hydrate(), config.keybinds.hydrate()]).then(() => {
      if (loading.get(addon.fqid)?.promise === promise) {
        cache.set(addon.fqid, { config, declared });
        loading.delete(addon.fqid);
        return config;
      }
      // Handed back all the same, to a render that has already been superseded.
      config.settings.dispose();
      config.keybinds.dispose();
      return config;
    });
    loading.set(addon.fqid, { declared, promise });
    return promise;
  };

  return {
    open: (addon) => {
      const declared = declarationsOf(addon);
      const cached = usableConfig(cache, addon.fqid, declared);
      if (cached !== null) {
        return Promise.resolve(cached);
      }
      const inFlight = loading.get(addon.fqid);
      if (inFlight?.declared === declared) {
        return inFlight.promise;
      }
      return load(addon, declared);
    },

    peek: (addon) => usableConfig(cache, addon.fqid, declarationsOf(addon)),

    conflicts: (combo) => {
      const fromGame = deps.game.conflicts(combo);
      const addons = Object.entries(deps.addonBindings())
        .filter(([, bound]) => bound === combo)
        .map(([key]) => key);
      return { ...fromGame, addons };
    },

    dispose: () => {
      for (const { config } of cache.values()) {
        config.settings.dispose();
        config.keybinds.dispose();
      }
      cache.clear();
      loading.clear();
    },
  };
}

export type { AddonConfig, ConfigService, ConfigServiceDeps, ConflictReading };
export { createConfigService };
