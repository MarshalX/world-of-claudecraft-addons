// @vitest-environment happy-dom

// The arrange-your-UI mode.
//
// One class on the root, which is the whole mechanism: the outlines, the minimum
// size that makes an empty overlay grabbable, and the labels are all CSS keyed
// off it. So what is worth testing is the state machine around it, and in
// particular that a subscriber hears about a change made from somewhere else,
// because the mode has two switches and they must not disagree.

import { describe, expect, it } from 'vitest';
import { createUnlockMode, UNLOCKED_CLASS } from '../loader/src/runtime/ui/kit/unlock.ts';

function root(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'woc-addons';
  document.body.appendChild(el);
  return el;
}

describe('the unlock mode', () => {
  it('starts off, because it is a setup mode rather than a way to play', () => {
    const el = root();
    const mode = createUnlockMode(el);

    expect(mode.unlocked).toBe(false);
    expect(el.classList.contains(UNLOCKED_CLASS)).toBe(false);
  });

  it('marks the root, which is what every rule keys off', () => {
    const el = root();
    const mode = createUnlockMode(el);

    mode.toggle();

    expect(mode.unlocked).toBe(true);
    expect(el.classList.contains(UNLOCKED_CLASS)).toBe(true);
  });

  // The manager's checkbox and the loader's keybind are two switches on one
  // mode. Without this the checkbox would show the opposite of the screen after
  // the key was pressed with the window open.
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

  // Disposal has to leave the page as it found it: a root still carrying the
  // class would outline every frame with nothing left to turn it off.
  it('takes the class back off the root when disposed', () => {
    const el = root();
    const mode = createUnlockMode(el);
    mode.toggle();

    mode.dispose();

    expect(el.classList.contains(UNLOCKED_CLASS)).toBe(false);
  });
});
