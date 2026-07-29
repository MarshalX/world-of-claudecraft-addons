// What the manager needs to edit one addon's settings and keybinds.
//
// The manager reads and writes the same stores an addon's own `woc.settings`
// and `woc.keys` read and write, over the same storage hub. That is the whole
// design: a rebind made here reaches a running addon through the store's change
// event rather than through anything the manager knows about, so editing an
// addon that is enabled and one that is disabled are the same code path.
//
// Stores are cached per fqid and never disposed while the manager lives. They
// hold a storage subscription each and nothing else, and an addon whose row the
// player has opened once is one they are likely to open again.

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
  /** The cached stores if this addon has been opened, without loading. */
  peek: (fqid: string) => AddonConfig | null;
  conflicts: (combo: string) => ConflictReading;
  dispose: () => void;
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

function createConfigService(deps: ConfigServiceDeps): ConfigService {
  const cache = new Map<string, AddonConfig>();
  /** Hydration is in flight at most once per addon, however fast the player clicks. */
  const loading = new Map<string, Promise<AddonConfig>>();

  return {
    open: (addon) => {
      const cached = cache.get(addon.fqid);
      if (cached !== undefined) {
        return Promise.resolve(cached);
      }
      const inFlight = loading.get(addon.fqid);
      if (inFlight !== undefined) {
        return inFlight;
      }

      const config = buildConfig(deps, addon);
      const hydrating = Promise.all([config.settings.hydrate(), config.keybinds.hydrate()]).then(
        () => {
          cache.set(addon.fqid, config);
          loading.delete(addon.fqid);
          return config;
        },
      );
      loading.set(addon.fqid, hydrating);
      return hydrating;
    },

    peek: (fqid) => cache.get(fqid) ?? null,

    conflicts: (combo) => {
      const fromGame = deps.game.conflicts(combo);
      const addons = Object.entries(deps.addonBindings())
        .filter(([, bound]) => bound === combo)
        .map(([key]) => key);
      return { ...fromGame, addons };
    },

    dispose: () => {
      for (const config of cache.values()) {
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
