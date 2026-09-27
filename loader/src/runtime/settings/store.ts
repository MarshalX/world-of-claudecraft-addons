// One addon's settings, exposed SYNCHRONOUSLY as `woc.settings`, so `hydrate()` is awaited before
// the addon's code runs. A write applies locally before the host echoes it, or the manager would
// paint the new value while `woc.settings` still read the old one.

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

/** Copied and guarded, so one handler cannot cost the rest their notification. */
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
 * Skipped with nothing declared, saving a bridge round trip. A failed read keeps the defaults
 * rather than rejecting, since an addon cannot start without settings.
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

/** The value `set` stores, or a throw (a rejection, since `set` is async) naming the rule. */
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

  // Another tab's write and this tab's echo both land here.
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
        // Revert to what is stored rather than show a value that looks saved.
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
