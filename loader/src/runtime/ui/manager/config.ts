// What the manager needs to edit one addon's settings and keybinds.
//
// The manager reads and writes the same stores an addon's own `woc.settings`
// and `woc.keys` read and write, over the same storage hub. That is the whole
// design: a rebind made here reaches a running addon through the store's change
// event rather than through anything the manager knows about, so editing an
// addon that is enabled and one that is disabled are the same code path.
//
// Stores are cached per fqid for as long as the DECLARATIONS behind them hold.
// They hold a storage subscription each and nothing else, and an addon whose row
// the player has opened once is one they are likely to open again.
//
// Keyed on the fqid alone, that cache was wrong, and it was reported from a live
// session as a settings pane that refused its own field. A store is a function of
// its declarations: it hydrates from them, it rejects a write to anything they do
// not name, and the form beside it renders from `addon.manifest` READ FRESH. So an
// addon updated while the manager was open put a new control on screen backed by a
// store that had never heard of it, and picking a value answered "no setting
// declared with id 'layout'". Uninstalling and reinstalling did not help, because
// what was stale was in this map rather than in storage.
//
// The rule is therefore that a cached pair is valid only while its declarations
// are the ones the row now carries, and it is checked on every open rather than
// invalidated from a registry event: this service sees the row anyway, so a
// comparison here cannot be missed the way a subscription can.

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
  /**
   * The cached stores if this row has been opened, without loading.
   *
   * Takes the ROW rather than an fqid, because "has been opened" is not the
   * question: a pair built from declarations this row no longer carries is not a
   * cache hit, and painting a page with one would show the update's own controls
   * backed by stores that refuse them.
   */
  peek: (addon: InstalledAddon) => AddonConfig | null;
  conflicts: (combo: string) => ConflictReading;
  dispose: () => void;
}

/**
 * Everything about a row that a store is built from, as one comparable string.
 *
 * Serialised rather than compared field by field, because what has to be caught is
 * ANY change to either list: a setting added, a default moved, a select's options
 * narrowed, a keybind renamed. A hand-written comparison would have to be extended
 * every time the manifest schema grows a field, and the failure of forgetting is
 * silent, which is exactly the failure this function exists to end.
 *
 * Safe to compare as text because both sides are the same schema's output: the row
 * is validated by `shared/schema.ts` before it is stored, so key order comes from
 * the schema rather than from whoever wrote the JSON, and no value in a manifest can
 * be undefined, NaN, or a function.
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
  // The panes are pure renders, so a change arriving from another tab has to
  // be what triggers the repaint rather than the pane polling for one.
  config.settings.onChange(deps.onChange);
  config.keybinds.onChange(deps.onChange);
  return config;
}

/**
 * The cached pair if it still describes this row, dropping it if it does not.
 *
 * Disposed on the way out rather than left for the service's own disposal: the pair
 * holds a storage subscription each, and a manager kept open across several updates
 * would otherwise accumulate one set per version of every addon, each still
 * repainting the pane from a change the player can no longer act on.
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
   * Build and hydrate a pair, and cache it unless it was superseded on the way.
   *
   * Hydration is a bridge round trip, so an update can land inside it. The pair
   * being built is then already stale before anyone has been handed it, and the
   * load that started for the NEW row owns the cache: writing this one in would
   * put the older declarations back, which is the bug this whole file is about.
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
