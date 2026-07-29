// Keybind combo parsing, formatting, and conflict detection.
//
// The canonical form matches the game's own: modifiers in the fixed order Ctrl,
// Alt, Shift, Meta, then the KeyboardEvent `code`. Keeping that byte-identical
// is what lets conflict detection compare strings against the player's own
// bindings in localStorage.

/** The modifier TOKEN names used in a combo string, distinct from the physical codes. */
const MODIFIER_TOKENS = new Set(['Ctrl', 'Alt', 'Shift', 'Meta']);

/** Prefixes stripped from a KeyboardEvent code to make it readable. */
const CODE_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^Key/, ''],
  [/^Digit/, ''],
  [/^Numpad/, 'Num '],
  [/^Arrow/, ''],
];

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'ShiftLeft',
  'ShiftRight',
  'MetaLeft',
  'MetaRight',
]);

/** Escape is reserved: binding it would shadow the game's menu close. */
export const UNBINDABLE_CODES = new Set(['Escape']);

export interface ComboParts {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  code: string;
}

export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code);
}

/** Build the canonical combo string. */
export function makeCombo(parts: ComboParts): string {
  const out: string[] = [];
  if (parts.ctrl) {
    out.push('Ctrl');
  }
  if (parts.alt) {
    out.push('Alt');
  }
  if (parts.shift) {
    out.push('Shift');
  }
  if (parts.meta) {
    out.push('Meta');
  }
  out.push(parts.code);
  return out.join('+');
}

/** Parse a canonical combo string, or null if it is not one. */
export function parseCombo(combo: string): ComboParts | null {
  if (combo.length === 0) {
    return null;
  }
  const tokens = combo.split('+');
  const code = tokens.pop();
  if (code === undefined || code.length === 0) {
    return null;
  }
  // Reject a physical modifier key as the code ('ShiftLeft') and a trailing
  // modifier token with no key after it ('Ctrl+Alt'). Neither can ever fire.
  if (isModifierCode(code) || MODIFIER_TOKENS.has(code)) {
    return null;
  }
  // A repeated modifier means the string was not built by makeCombo.
  if (new Set(tokens).size !== tokens.length) {
    return null;
  }
  if (!tokens.every((token) => MODIFIER_TOKENS.has(token))) {
    return null;
  }

  return {
    ctrl: tokens.includes('Ctrl'),
    alt: tokens.includes('Alt'),
    shift: tokens.includes('Shift'),
    meta: tokens.includes('Meta'),
    code,
  };
}

/** Reorder a combo's modifiers into canonical form, or null if it is malformed. */
export function normalizeCombo(combo: string): string | null {
  const parts = parseCombo(combo);
  if (parts === null) {
    return null;
  }
  return makeCombo(parts);
}

export function isBindable(combo: string): boolean {
  const parts = parseCombo(combo);
  return parts !== null && !UNBINDABLE_CODES.has(parts.code);
}

/** A human-readable label for the manager UI, e.g. 'Alt+D' for 'Alt+KeyD'. */
export function describeCombo(combo: string): string {
  const parts = parseCombo(combo);
  if (parts === null) {
    return combo;
  }
  let key = parts.code;
  for (const [pattern, replacement] of CODE_LABELS) {
    key = key.replace(pattern, replacement);
  }
  return makeCombo({ ...parts, code: key });
}

export interface ConflictReport {
  game: string[];
  addons: string[];
}

/**
 * Find everything already bound to `combo`.
 *
 * `gameBindings` maps the game's action ids to combos, read from
 * localStorage['woc_keybinds:<scope>'] and never written back. `addonBindings`
 * maps '<fqid>:<bindId>' to combo. Comparison is on normalized form, so storage
 * written in a different modifier order still matches.
 */
export function findConflicts(
  combo: string,
  gameBindings: Readonly<Record<string, string>>,
  addonBindings: Readonly<Record<string, string>>,
  ignoreAddonKey?: string,
): ConflictReport {
  const target = normalizeCombo(combo);
  if (target === null) {
    return { game: [], addons: [] };
  }

  const game: string[] = [];
  for (const [action, bound] of Object.entries(gameBindings)) {
    if (normalizeCombo(bound) === target) {
      game.push(action);
    }
  }

  const addons: string[] = [];
  for (const [key, bound] of Object.entries(addonBindings)) {
    if (key !== ignoreAddonKey && normalizeCombo(bound) === target) {
      addons.push(key);
    }
  }

  return { game, addons };
}
