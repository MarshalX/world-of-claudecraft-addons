// What the player has already bound in the game.
//
// Read so the manager can warn before an addon takes a key the game is using.
// One-way: the loader reads the game's bindings and never writes them.
//
// Two sources, and the difference matters more than it looks. The LIVE profile
// on `__game.input.keybinds` is the game's own matcher, so it answers exactly
// what the game would do, and it includes every DEFAULT binding. The STORED
// blob in localStorage holds only what the player explicitly saved, so a player
// who never opened Key Bindings has an empty one: conflict detection against
// storage alone would report WASD as free on almost every account. Storage is
// the fallback, not the source.
//
// The game distinguishes held actions (movement, polled per frame against the
// physical code with modifiers ignored) from edge actions (ability slots and
// window toggles, matched on the whole chord). The live profile has a matcher
// for each; the stored blob does not say which kind a row is, so the fallback
// over-reports rather than under-reports. See shared/combo.ts.

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
 * The game's live keybind profile, or null.
 *
 * Reached through `input`, which is a member the probe already tracks. The
 * profile itself is a TypeScript-private field and a plain property at runtime;
 * both matchers are public API on the class. Feature-detected rather than
 * assumed, so a game refactor costs the live path and falls back to storage
 * instead of throwing at an addon.
 *
 * BOUND TO THE INSTANCE, which is the whole reason this returns wrappers rather
 * than the two functions. They are class METHODS whose bodies read `this.map`,
 * so calling one off any other object throws on an undefined `this`. A live
 * session found that: the manager reads conflicts during render, so the throw
 * unmounted the settings pane and left a blank window.
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

/**
 * Ask the game's matchers, or null if they could not be asked.
 *
 * Guarded because these are methods on an undeclared debug hook with no
 * compatibility promise. A game refactor can leave something callable in place
 * that throws when called, and the caller is a render: losing the live reading
 * costs one warning line, where a throw costs the player the whole pane.
 */
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
          // Slotted so a primary and a secondary on the same action are both
          // kept, since findConflicts is keyed by the record's own key.
          out[`${action}#${slot}`] = combo;
        }
      });
    }
  }
}

/**
 * Every stored keybind blob, flattened to action ids and combos.
 *
 * Both slots of every action, and every scope key rather than the active one:
 * the fallback runs precisely when the live profile is unreachable, which is
 * also when there is no reliable way to tell which character is loaded. A
 * binding from another character is a false positive on a warning that never
 * blocks, where missing the active character's would be a silent loss.
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

      // Resolved per call rather than captured: the loader boots at
      // document-start and the game does not exist for many seconds, so a
      // reference taken once would be null for the whole session.
      const live = liveKeybinds(deps.game());
      if (live !== null) {
        // Null means the profile was there and could not answer, which falls
        // through to storage rather than reporting an empty live reading: an
        // empty one would say the key is free when it was never checked.
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
