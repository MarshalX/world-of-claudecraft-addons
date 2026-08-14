// @vitest-environment happy-dom

// What a player is told when a frameless overlay refuses to move.
//
// Three things are worth pinning and none of them is the wording. That EVERY
// refused gesture is answered, because a player who tries again is asking again
// and a rule that goes quiet reads as a panel that has broken; that only one
// message is up at a time, since five copies of one sentence are not five
// answers; and that it names the combo the player is actually on, which is why
// the combo is read at the moment it is needed rather than when it was wired.

import { describe, expect, it, vi } from 'vitest';
import { BY_MENU, createArrangeHint } from '../loader/src/runtime/ui/kit/arrange-hint.ts';
import type { Toaster } from '../loader/src/runtime/ui/kit/toast.ts';

interface FakeToaster {
  said: string[];
  /** How many of the raised messages were taken down again. */
  dismissed: () => number;
  toaster: Toaster;
}

function toaster(): FakeToaster {
  const said: string[] = [];
  let dropped = 0;
  return {
    said,
    dismissed: () => dropped,
    toaster: {
      show: (text: string) => {
        said.push(text);
        return () => {
          dropped += 1;
        };
      },
      dispose: () => undefined,
    },
  };
}

describe('the arrange hint', () => {
  // Every attempt, because every attempt is the player asking the same question
  // again, usually minutes later on another panel and having forgotten the answer.
  it('answers every refused gesture rather than only the first', () => {
    const { said, toaster: fake } = toaster();
    const hint = createArrangeHint({ toaster: fake });

    hint.note();
    hint.note();
    hint.note();

    expect(said).toHaveLength(3);
  });

  // The toaster stacks up to five and holds each for four seconds, so without this
  // a player wiggling a locked overlay builds a column of one repeated sentence.
  it('takes the previous message down as it raises the next', () => {
    const fake = toaster();
    const hint = createArrangeHint({ toaster: fake.toaster });

    hint.note();
    hint.note();
    hint.note();

    expect(fake.dismissed()).toBe(2);
  });

  // Before the loader's own binds exist there is no combo to name, and there may
  // never be one: the bind registers separately from the UI. A message naming a
  // button that cannot move beats one naming a key that might not be bound.
  it('names the menu route while no combo has been wired', () => {
    const { said, toaster: fake } = toaster();

    createArrangeHint({ toaster: fake }).note();

    expect(said[0]).toBe(BY_MENU);
  });

  it('names the combo the player is on, in the label the manager uses', () => {
    const { said, toaster: fake } = toaster();
    const hint = createArrangeHint({ toaster: fake });
    hint.setCombo(() => 'Alt+KeyU');

    hint.note();

    expect(said[0]).toContain('Alt+U');
  });

  // Read when it is needed rather than when it was wired, because a player may
  // rebind the key at any point and a captured combo would then be wrong.
  it('reads the combo at the moment it says it', () => {
    const { said, toaster: fake } = toaster();
    const hint = createArrangeHint({ toaster: fake });
    const read = vi.fn(() => 'Alt+KeyJ');
    hint.setCombo(read);

    hint.note();

    expect(read).toHaveBeenCalled();
    expect(said[0]).toContain('Alt+J');
  });

  // A store answers null for an id it does not carry, which is what a failed
  // hydration looks like. The message still has to work.
  it('falls back to the menu route when the store answers nothing', () => {
    const { said, toaster: fake } = toaster();
    const hint = createArrangeHint({ toaster: fake });
    hint.setCombo(() => null);

    hint.note();

    expect(said[0]).toBe(BY_MENU);
  });
});
