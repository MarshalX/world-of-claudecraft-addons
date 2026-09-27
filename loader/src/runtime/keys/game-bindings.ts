// What the player has bound in the game, read (never written) so the manager can warn of a clash.
//
// The LIVE profile on `__game.input.keybinds` is the source: it includes every default. The
// localStorage blob holds only what the player saved, so alone it reports WASD as free; it is the
// fallback. It also cannot tell held actions (bare code, modifiers ignored) from edge actions
// (whole chord), so the fallback over-reports. See shared/combo.ts.

import { type ComboParts, findConflicts, makeCombo, parseCombo } from '../../shared/combo.ts';
import { diagError } from '../../shared/diag.ts';
import { isRecord } from '../net/frames.ts';

/** The game's own localStorage prefix. A bare key, then one per character scope. */
const STORE_PREFIX = 'woc_keybinds';

type BindingSource = 'live' | 'stored' | 'none';

interface GameBindingReading {
  /** Game action ids that would also fire on the combo. */
  actions: string[];
  source: BindingSource;
}

interface LiveKeybinds {
  heldActionForCode: (code: string) => string | null;
  edgeActionForCombo: (combo: string) => string | null;
}

interface GameBindingDeps {
  /** The live `__game`, or null before world entry. */
  game: () => unknown;
  /** localStorage, or null where it is unreadable. */
  storage: () => Pick<Storage, 'getItem' | 'key' | 'length'> | null;
}

interface GameBindings {
  conflicts: (combo: string) => GameBindingReading;
}

function callable(value: unknown): value is (arg: string) => string | null {
  return typeof value === 'function';
}

/**
 * The game's live keybind profile, feature-detected so a refactor falls back to storage.
 *
 * BOUND TO THE INSTANCE: the matchers are class methods reading `this.map`, and the manager calls
 * them during render, so an unbound call blanks the settings pane.
 */
function liveKeybinds(game: unknown): LiveKeybinds | null {
  if (!isRecord(game)) {
    return null;
  }
  const { input } = game;
  if (!isRecord(input)) {
    return null;
  }
  const { keybinds } = input;
  if (!isRecord(keybinds)) {
    return null;
  }
  const { heldActionForCode, edgeActionForCombo } = keybinds;
  if (!(callable(heldActionForCode) && callable(edgeActionForCombo))) {
    return null;
  }
  return {
    heldActionForCode: (code) => heldActionForCode.call(keybinds, code),
    edgeActionForCombo: (combo) => edgeActionForCombo.call(keybinds, combo),
  };
}

/** Guarded: the hook has no compatibility promise and the caller is a render. */
function askLive(live: LiveKeybinds, parts: ComboParts): string[] | null {
  try {
    const matched = [live.heldActionForCode(parts.code), live.edgeActionForCombo(makeCombo(parts))];
    return matched.filter((action): action is string => action !== null && action.length > 0);
  } catch (err) {
    diagError('the game keybind profile threw, falling back to stored bindings', err);
    return null;
  }
}

/** The game's own keybind keys in storage, in whatever order it wrote them. */
function bindingKeys(storage: Pick<Storage, 'key' | 'length'>): string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(STORE_PREFIX) === true) {
      keys.push(key);
    }
  }
  return keys;
}

/** One stored blob, or null when it is absent, unparseable, or not an object. */
function parseBlob(raw: string | null): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? 'null');
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  return parsed;
}

function collectBlob(blob: Record<string, unknown>, out: Record<string, string>): void {
  for (const [action, slots] of Object.entries(blob)) {
    if (Array.isArray(slots)) {
      slots.forEach((combo, slot) => {
        if (typeof combo === 'string' && combo.length > 0) {
          // Slotted so a primary and a secondary on one action are both kept.
          out[`${action}#${slot}`] = combo;
        }
      });
    }
  }
}

/**
 * Every scope key, not only the active one: the fallback runs when the loaded character cannot be
 * told, and a false positive on a non-blocking warning beats a silent miss.
 */
function storedBindings(
  storage: Pick<Storage, 'getItem' | 'key' | 'length'>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of bindingKeys(storage)) {
    const blob = parseBlob(storage.getItem(key));
    if (blob !== null) {
      collectBlob(blob, out);
    }
  }
  return out;
}

/** Strip the slot suffix storedBindings added, and drop duplicates. */
function actionNames(keys: readonly string[]): string[] {
  return [...new Set(keys.map((key) => key.split('#')[0] as string))];
}

function createGameBindings(deps: GameBindingDeps): GameBindings {
  return {
    conflicts: (combo) => {
      const parts = parseCombo(combo);
      if (parts === null) {
        return { actions: [], source: 'none' };
      }

      // Resolved per call: captured at document-start it would be null forever.
      const live = liveKeybinds(deps.game());
      if (live !== null) {
        // Null means it could not answer; an empty live reading would claim the key is free.
        const matched = askLive(live, parts);
        if (matched !== null) {
          return { actions: [...new Set(matched)], source: 'live' };
        }
      }

      const storage = deps.storage();
      if (storage === null) {
        return { actions: [], source: 'none' };
      }
      const report = findConflicts(combo, storedBindings(storage), {});
      return { actions: actionNames(report.game), source: 'stored' };
    },
  };
}

export type { BindingSource, GameBindingDeps, GameBindingReading, GameBindings };
export { createGameBindings, STORE_PREFIX };
