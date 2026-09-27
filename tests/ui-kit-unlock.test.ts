// @vitest-environment happy-dom

// The arrange mode: one class on the root that all its CSS keys off, and a state
// machine that keeps its two switches in agreement.

import { describe, expect, it } from 'vitest';
import { createUnlockMode, UNLOCKED_CLASS } from '../loader/src/runtime/ui/kit/unlock.ts';

function root(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'woc-addons';
  document.body.appendChild(el);
  return el;
}

describe('the unlock mode', () => {
  it('starts off', () => {
    const el = root();
    const mode = createUnlockMode(el);

    expect(mode.unlocked).toBe(false);
    expect(el.classList.contains(UNLOCKED_CLASS)).toBe(false);
  });

  it('marks the root', () => {
    const el = root();
    const mode = createUnlockMode(el);

    mode.toggle();

    expect(mode.unlocked).toBe(true);
    expect(el.classList.contains(UNLOCKED_CLASS)).toBe(true);
  });

  // The manager's checkbox and the keybind are two switches on one mode.
  it('tells a subscriber when it was flipped from somewhere else', () => {
    const mode = createUnlockMode(root());
    const seen: boolean[] = [];
    mode.onChange((on) => seen.push(on));

    mode.toggle();
    mode.set(false);

    expect(seen).toEqual([true, false]);
  });

  it('says nothing when set to what it already is', () => {
    const mode = createUnlockMode(root());
    const seen: boolean[] = [];
    mode.onChange((on) => seen.push(on));

    mode.set(false);
    mode.set(true);
    mode.set(true);

    expect(seen).toEqual([true]);
  });

  it('drops the subscriber it was told to drop', () => {
    const mode = createUnlockMode(root());
    const seen: boolean[] = [];
    const off = mode.onChange((on) => seen.push(on));

    off();
    mode.toggle();

    expect(seen).toEqual([]);
  });

  // A leftover class would outline every frame with nothing to turn it off.
  it('takes the class back off the root when disposed', () => {
    const el = root();
    const mode = createUnlockMode(el);
    mode.toggle();

    mode.dispose();

    expect(el.classList.contains(UNLOCKED_CLASS)).toBe(false);
  });
});
