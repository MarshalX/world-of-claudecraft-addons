// One addon's keybinds: the declared defaults, the player's overrides, and the
// change fan-out that moves a live binding when the manager rebinds it.
//
// Overrides go to GM storage and NEVER into the game's own keybind blob. The
// loader reads the game's bindings to warn about conflicts and writes nothing
// back, so uninstalling every addon leaves the player's game controls exactly as
// they were.
//
// Like settings, this is shared across hosts: a key bound once works the same on
// live, pbe, and pbe2.

import { normalizeCombo } from '../../shared/combo.ts';
import { diagError } from '../../shared/diag.ts';
import type { KeybindDecl } from '../../shared/schema.ts';
import { configNamespace, KEYBINDS_KEY } from '../../shared/storage-keys.ts';
import type { Teardown } from '../disposal.ts';
import type { StorageHub } from '../storage/hub.ts';

type KeybindChangeHandler = (id: string, combo: string) => void;

interface KeybindStoreDeps {
  fqid: string;
  decls: readonly KeybindDecl[];
  hub: StorageHub;
}

interface KeybindStore {
  /** The declared ids, in manifest order. */
  ids: () => string[];
  /** The override if there is one, otherwise the manifest default. */
  combo: (id: string) => string | null;
  /** Whether this id currently differs from its manifest default. */
  isOverridden: (id: string) => boolean;
  hydrate: () => Promise<void>;
  /** Rejects for an undeclared id or a combo the loader will not take. */
  set: (id: string, combo: string) => Promise<void>;
  /** Drop the override, returning to the manifest default. */
  reset: (id: string) => Promise<void>;
  onChange: (handler: KeybindChangeHandler) => Teardown;
  dispose: () => void;
}

/** Keep only rows naming a declared id and holding a combo we can parse. */
function readOverrides(stored: unknown, declared: ReadonlySet<string>): Record<string, string> {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [id, value] of Object.entries(stored as Record<string, unknown>)) {
    if (declared.has(id) && typeof value === 'string') {
      const normalized = normalizeCombo(value);
      if (normalized !== null) {
        out[id] = normalized;
      }
    }
  }
  return out;
}

/** Fan one binding out, with a handler that throws isolated from the rest. */
function notify(
  handlers: ReadonlySet<KeybindChangeHandler>,
  fqid: string,
  id: string,
  combo: string,
): void {
  for (const handler of [...handlers]) {
    try {
      handler(id, combo);
    } catch (err) {
      diagError(`${fqid}: a keybind change handler threw`, err);
    }
  }
}

/** The declared record for an id, or a rejection naming the addon and the id. */
function requireDeclared(
  declared: ReadonlyMap<string, KeybindDecl>,
  fqid: string,
  id: string,
): void {
  if (!declared.has(id)) {
    throw new Error(`${fqid}: no keybind declared with id '${id}'`);
  }
}

function requireCombo(fqid: string, combo: string): string {
  const normalized = normalizeCombo(combo);
  if (normalized === null) {
    throw new Error(`${fqid}: '${combo}' is not a valid combo`);
  }
  return normalized;
}

/**
 * The override record and the only place it is read from or written to storage.
 *
 * Held apart from the store because the rollback and the "keep the declared
 * defaults when storage fails" rule are about persistence rather than about
 * keybinds, which leaves the store itself to validation and fan-out.
 */
interface OverridesCell {
  read: () => Record<string, string>;
  /** Take a record storage reported, without writing it back. */
  adopt: (stored: unknown) => void;
  /** Write through, restoring the previous record if storage refuses. */
  write: (next: Record<string, string>) => Promise<void>;
  hydrate: () => Promise<void>;
}

function createOverridesCell(
  deps: KeybindStoreDeps,
  ns: string,
  declaredIds: ReadonlySet<string>,
): OverridesCell {
  let overrides: Record<string, string> = {};

  return {
    read: () => overrides,

    adopt: (stored) => {
      overrides = readOverrides(stored, declaredIds);
    },

    write: async (next) => {
      const previous = overrides;
      overrides = next;
      try {
        await deps.hub.set(ns, KEYBINDS_KEY, { ...next });
      } catch (err) {
        overrides = previous;
        throw err;
      }
    },

    hydrate: async () => {
      if (deps.decls.length === 0) {
        return;
      }
      try {
        overrides = readOverrides(await deps.hub.get(ns, KEYBINDS_KEY), declaredIds);
      } catch (err) {
        diagError(`${deps.fqid}: could not read keybinds, using the declared defaults`, err);
      }
    },
  };
}

/**
 * Follow the record another tab may have changed.
 *
 * `republish` covers every declared id rather than only the changed ones: an
 * override that was REMOVED elsewhere has to move its binding back to the
 * manifest default, and a diff of the two records would have to spot that
 * deletion as carefully as it spots a change.
 */
function watchOverrides(
  hub: StorageHub,
  ns: string,
  cell: OverridesCell,
  republish: () => void,
): Teardown {
  return hub.onChange(ns, (key, value) => {
    if (key === KEYBINDS_KEY) {
      cell.adopt(value);
      republish();
    }
  });
}

function createKeybindStore(deps: KeybindStoreDeps): KeybindStore {
  const ns = configNamespace(deps.fqid);
  const declared = new Map(deps.decls.map((decl) => [decl.id, decl]));
  const declaredIds = new Set(declared.keys());
  const handlers = new Set<KeybindChangeHandler>();
  const cell = createOverridesCell(deps, ns, declaredIds);

  const comboFor = (id: string): string | null =>
    cell.read()[id] ?? declared.get(id)?.default ?? null;

  const publish = (ids: readonly string[]): void => {
    for (const id of ids) {
      const combo = comboFor(id);
      if (combo !== null) {
        notify(handlers, deps.fqid, id, combo);
      }
    }
  };

  const stopWatching = watchOverrides(deps.hub, ns, cell, () => {
    publish([...declaredIds]);
  });

  return {
    ids: () => deps.decls.map((decl) => decl.id),

    combo: comboFor,

    isOverridden: (id) => Object.hasOwn(cell.read(), id),

    hydrate: cell.hydrate,

    set: async (id, combo) => {
      requireDeclared(declared, deps.fqid, id);
      const normalized = requireCombo(deps.fqid, combo);
      await cell.write({ ...cell.read(), [id]: normalized });
      publish([id]);
    },

    reset: async (id) => {
      requireDeclared(declared, deps.fqid, id);
      const next = { ...cell.read() };
      delete next[id];
      await cell.write(next);
      publish([id]);
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

export type { KeybindChangeHandler, KeybindStore, KeybindStoreDeps };
export { createKeybindStore };
