// Keybind combo parsing, formatting, and conflict detection. The canonical form must stay
// byte-identical to the game's (Ctrl, Alt, Shift, Meta, then the `code`) so conflict detection
// can compare strings against the player's stored bindings.

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

/**
 * Whether a stored game binding would also fire on `target`.
 *
 * An EDGE action matches the whole chord; a HELD action (movement) matches the bare code with
 * modifiers ignored, and the stored string does not say which it is. So this matches on either
 * rule and over-reports on purpose: a false positive is an ignorable warning, a false negative
 * an addon eating a movement key. Only the fallback when the game's live matcher is unreachable.
 */
function bindingMatches(target: ComboParts, stored: string): boolean {
  const parts = parseCombo(stored);
  if (parts === null) {
    return false;
  }
  if (makeCombo(parts) === makeCombo(target)) {
    return true;
  }
  const bare = !(parts.ctrl || parts.alt || parts.shift || parts.meta);
  return bare && parts.code === target.code;
}

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
 * Find everything already bound to `combo`. `gameBindings` maps game action ids to combos and is
 * never written back; `addonBindings` maps '<fqid>:<bindId>' to combos and compares exactly,
 * since the loader's dispatcher matches the whole chord.
 */
export function findConflicts(
  combo: string,
  gameBindings: Readonly<Record<string, string>>,
  addonBindings: Readonly<Record<string, string>>,
  ignoreAddonKey?: string,
): ConflictReport {
  const parts = parseCombo(combo);
  if (parts === null) {
    return { game: [], addons: [] };
  }
  const target = makeCombo(parts);

  const game: string[] = [];
  for (const [action, bound] of Object.entries(gameBindings)) {
    if (bindingMatches(parts, bound)) {
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
