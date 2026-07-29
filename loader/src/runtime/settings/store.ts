// One addon's settings: the live values, the write path, and the change fan-out.
//
// Settings are exposed to addons SYNCHRONOUSLY as `woc.settings`, which is the
// whole reason this exists as a store rather than as reads through
// `woc.storage`. An addon reads `woc.settings.window` on its first line, so the
// values have to be in hand before its code runs; `hydrate()` is awaited by the
// lifecycle, and everything after that is in memory.
//
// A write applies locally before it goes to the host. The host echoes every
// write back as a storage change, so waiting for the echo would leave a window
// in which the manager has painted the new value and `woc.settings` still reads
// the old one.

import { diagError } from '../../shared/diag.ts';
import type { SettingDecl } from '../../shared/schema.ts';
import { configNamespace, SETTINGS_KEY } from '../../shared/storage-keys.ts';
import type { Teardown } from '../disposal.ts';
import type { StorageHub } from '../storage/hub.ts';
import {
  coerceSetting,
  findSetting,
  hydrateSettings,
  type SettingValue,
  type SettingValues,
} from './values.ts';

type SettingsChangeHandler = (values: SettingValues) => void;

interface SettingsStoreDeps {
  fqid: string;
  decls: readonly SettingDecl[];
  hub: StorageHub;
}

interface SettingsStore {
  /** Always usable, defaults before hydrate() has run. */
  values: () => SettingValues;
  /** Read the persisted record. Awaited once, before addon code runs. */
  hydrate: () => Promise<void>;
  /** Rejects if `id` is not declared or `value` is not of its declared type. */
  set: (id: string, value: SettingValue) => Promise<void>;
  onChange: (handler: SettingsChangeHandler) => Teardown;
  dispose: () => void;
}

/** A stored record, or an empty one if storage held something that is not an object. */
function asRecord(stored: unknown): Readonly<Record<string, unknown>> {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return {};
  }
  return stored as Record<string, unknown>;
}

/**
 * Fan one change out to every subscriber.
 *
 * Copied first and each call guarded, so a handler that subscribes, unsubscribes
 * or throws cannot cost the addons after it in the set their notification.
 */
function publishTo(
  handlers: ReadonlySet<SettingsChangeHandler>,
  values: SettingValues,
  fqid: string,
): void {
  for (const handler of [...handlers]) {
    try {
      handler(values);
    } catch (err) {
      diagError(`${fqid}: a settings change handler threw`, err);
    }
  }
}

/**
 * Read the persisted record once and apply it.
 *
 * A store with nothing declared has nothing to read, and reaching the bridge for
 * it would make every addon pay a round trip for an empty object. It also keeps
 * hydrate() working with no host connected. A read that fails leaves the
 * defaults in place rather than rejecting, since an addon cannot start without
 * settings and defaults are settings.
 */
async function hydrateFrom(
  deps: SettingsStoreDeps,
  ns: string,
  apply: (stored: unknown) => void,
): Promise<void> {
  if (deps.decls.length === 0) {
    return;
  }
  try {
    apply(await deps.hub.get(ns, SETTINGS_KEY));
  } catch (err) {
    diagError(`${deps.fqid}: could not read settings, using defaults`, err);
  }
}

/**
 * The value `set` will store, or a throw naming which rule the write broke.
 *
 * `set` is async, so both of these reach the addon as a rejection rather than as
 * a synchronous throw.
 */
function coerceWrite(deps: SettingsStoreDeps, id: string, value: SettingValue): SettingValue {
  const decl = findSetting(deps.decls, id);
  if (decl === null) {
    throw new Error(`${deps.fqid}: no setting declared with id '${id}'`);
  }
  const coerced = coerceSetting(decl, value);
  if (coerced === null) {
    throw new Error(`${deps.fqid}: '${id}' does not accept ${JSON.stringify(value)}`);
  }
  return coerced;
}

function createSettingsStore(deps: SettingsStoreDeps): SettingsStore {
  const ns = configNamespace(deps.fqid);
  const handlers = new Set<SettingsChangeHandler>();
  let values = hydrateSettings(deps.decls, {});

  const publish = (): void => {
    publishTo(handlers, values, deps.fqid);
  };

  const apply = (stored: unknown): void => {
    values = hydrateSettings(deps.decls, asRecord(stored));
    publish();
  };

  // Another tab's write, and the echo of this tab's own. Both land here, so a
  // subscriber sees one shape whichever it was.
  const stopWatching = deps.hub.onChange(ns, (key, value) => {
    if (key === SETTINGS_KEY) {
      apply(value);
    }
  });

  return {
    values: () => values,

    hydrate: () => hydrateFrom(deps, ns, apply),

    set: async (id, value) => {
      const coerced = coerceWrite(deps, id, value);

      const previous = values;
      values = { ...values, [id]: coerced };
      publish();

      try {
        await deps.hub.set(ns, SETTINGS_KEY, { ...values });
      } catch (err) {
        // Put the player's screen back to what is actually stored rather than
        // leaving a value that looks saved and is not.
        values = previous;
        publish();
        throw err;
      }
    },

    onChange: (handler) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },

    dispose: () => {
      stopWatching();
      handlers.clear();
    },
  };
}

export type { SettingsChangeHandler, SettingsStore, SettingsStoreDeps };
export { createSettingsStore };
