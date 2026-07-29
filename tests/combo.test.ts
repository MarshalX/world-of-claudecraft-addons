import { describe, expect, it } from 'vitest';

import {
  describeCombo,
  findConflicts,
  isBindable,
  isModifierCode,
  makeCombo,
  normalizeCombo,
  parseCombo,
} from '../loader/src/shared/combo.ts';

const parts = (over: Partial<ReturnType<typeof parseCombo> & object> = {}) => ({
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  code: 'KeyD',
  ...over,
});

describe('makeCombo', () => {
  // The order is byte-identical to the game's own makeCombo, which is what lets
  // conflict detection compare strings.
  it('emits modifiers in the fixed Ctrl, Alt, Shift, Meta order', () => {
    expect(makeCombo(parts({ meta: true, shift: true, alt: true, ctrl: true }))).toBe(
      'Ctrl+Alt+Shift+Meta+KeyD',
    );
  });

  it('emits a bare code with no modifiers', () => {
    expect(makeCombo(parts())).toBe('KeyD');
  });
});

describe('parseCombo', () => {
  it('round-trips the canonical form', () => {
    expect(parseCombo('Ctrl+Alt+KeyD')).toEqual(parts({ ctrl: true, alt: true }));
  });

  it('normalizes modifier order', () => {
    expect(normalizeCombo('Meta+Shift+Alt+Ctrl+KeyD')).toBe('Ctrl+Alt+Shift+Meta+KeyD');
  });

  it.each([
    ['', 'empty'],
    ['Ctrl+', 'no code'],
    ['Ctrl', 'bare modifier name'],
    ['Hyper+KeyD', 'unknown modifier'],
    ['Ctrl+Ctrl+KeyD', 'duplicate modifier'],
    ['ShiftLeft', 'physical modifier key as code'],
  ])('rejects %j (%s)', (input) => {
    expect(parseCombo(input)).toBeNull();
    expect(normalizeCombo(input)).toBeNull();
  });
});

describe('isModifierCode', () => {
  it.each(['ControlLeft', 'AltRight', 'ShiftLeft', 'MetaRight'])('%s is a modifier', (code) => {
    expect(isModifierCode(code)).toBe(true);
  });

  it.each(['KeyD', 'Digit1', 'Escape'])('%s is not a modifier', (code) => {
    expect(isModifierCode(code)).toBe(false);
  });
});

describe('isBindable', () => {
  // The game refuses to bind Escape; shadowing it would break menu close.
  it('refuses Escape', () => {
    expect(isBindable('Escape')).toBe(false);
    expect(isBindable('Ctrl+Escape')).toBe(false);
  });

  it('accepts an ordinary chord', () => {
    expect(isBindable('Alt+KeyD')).toBe(true);
  });

  it('refuses a malformed combo', () => {
    expect(isBindable('Hyper+KeyD')).toBe(false);
  });
});

describe('describeCombo', () => {
  it.each([
    ['Alt+KeyD', 'Alt+D'],
    ['Ctrl+Digit1', 'Ctrl+1'],
    ['ArrowUp', 'Up'],
    ['Numpad5', 'Num 5'],
  ])('renders %s as %s', (input, expected) => {
    expect(describeCombo(input)).toBe(expected);
  });

  it('passes a malformed combo through unchanged', () => {
    expect(describeCombo('Hyper+KeyD')).toBe('Hyper+KeyD');
  });
});

describe('findConflicts', () => {
  const game = { moveForward: 'KeyW', openBags: 'KeyB', screenshot: 'Ctrl+Alt+KeyD' };
  const addons = { 'official/combat-meter:toggle': 'Alt+KeyD' };

  it('finds a game binding on the same combo', () => {
    expect(findConflicts('KeyB', game, addons)).toEqual({ game: ['openBags'], addons: [] });
  });

  it('finds an addon binding on the same combo', () => {
    const r = findConflicts('Alt+KeyD', game, addons);
    expect(r.addons).toEqual(['official/combat-meter:toggle']);
    expect(r.game).toEqual([]);
  });

  it('matches regardless of the modifier order written in storage', () => {
    const r = findConflicts('Alt+Ctrl+KeyD', game, addons);
    expect(r.game).toEqual(['screenshot']);
  });

  it('reports a clean combo as unconflicted', () => {
    expect(findConflicts('Alt+KeyJ', game, addons)).toEqual({ game: [], addons: [] });
  });

  // Re-binding a key to the action that already owns it is not a conflict.
  it('ignores the binding being edited', () => {
    const r = findConflicts('Alt+KeyD', game, addons, 'official/combat-meter:toggle');
    expect(r.addons).toEqual([]);
  });

  it('returns nothing for a malformed combo', () => {
    expect(findConflicts('Hyper+KeyD', game, addons)).toEqual({ game: [], addons: [] });
  });
});

// The game has two kinds of action and the stored string does not say which one
// a row belongs to. A HELD action (movement) is polled per frame against the
// physical code with modifiers ignored, so a game binding of 'KeyW' still walks
// the player forward while Alt is down. An EDGE action matches the whole chord.
//
// This matters because the loader's dispatcher calls stopImmediatePropagation on
// a match, which stops the keydown that populates the game's held-key set: an
// addon on 'Alt+KeyW' does not merely collide with forward movement, it silently
// takes it away. Reporting the collision is the only warning a player gets.
describe('findConflicts against held game bindings', () => {
  const game = { moveForward: 'KeyW', screenshot: 'Ctrl+Alt+KeyD' };

  it('reports a bare game binding as conflicting with a modified combo', () => {
    expect(findConflicts('Alt+KeyW', game, {}).game).toEqual(['moveForward']);
  });

  it('still reports the exact match', () => {
    expect(findConflicts('KeyW', game, {}).game).toEqual(['moveForward']);
  });

  // The rule is one-way. A binding stored WITH modifiers is an edge action,
  // which the game matches on the full chord, so a bare press is not a conflict.
  it('does not report a modified game binding against a bare combo', () => {
    expect(findConflicts('KeyD', game, {}).game).toEqual([]);
  });

  it('does not report a modified game binding against a different chord', () => {
    expect(findConflicts('Alt+KeyD', game, {}).game).toEqual([]);
  });

  // Addon bindings have no such ambiguity: the loader's own dispatcher matches
  // the whole chord, so the bare-code rule must not leak into that half.
  it('leaves the addon half on exact matching', () => {
    const addons = { 'official/a:toggle': 'KeyW' };

    expect(findConflicts('Alt+KeyW', {}, addons).addons).toEqual([]);
    expect(findConflicts('KeyW', {}, addons).addons).toEqual(['official/a:toggle']);
  });
});
