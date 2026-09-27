// @vitest-environment happy-dom

// What a player is told when a frameless overlay refuses to move.

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
  // A hint that goes quiet after the first reads as a panel that has broken.
  it('answers every refused gesture rather than only the first', () => {
    const { said, toaster: fake } = toaster();
    const hint = createArrangeHint({ toaster: fake });

    hint.note();
    hint.note();
    hint.note();

    expect(said).toHaveLength(3);
  });

  // The toaster stacks five, so repeated tries would build a column of one sentence.
  it('takes the previous message down as it raises the next', () => {
    const fake = toaster();
    const hint = createArrangeHint({ toaster: fake.toaster });

    hint.note();
    hint.note();
    hint.note();

    expect(fake.dismissed()).toBe(2);
  });

  // The bind registers separately from the UI and may never exist, so the menu is named.
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

  // The player may rebind at any point, so a captured combo goes stale.
  it('reads the combo at the moment it says it', () => {
    const { said, toaster: fake } = toaster();
    const hint = createArrangeHint({ toaster: fake });
    const read = vi.fn(() => 'Alt+KeyJ');
    hint.setCombo(read);

    hint.note();

    expect(read).toHaveBeenCalled();
    expect(said[0]).toContain('Alt+J');
  });

  // A store answers null for an id it does not carry, as after a failed hydration.
  it('falls back to the menu route when the store answers nothing', () => {
    const { said, toaster: fake } = toaster();
    const hint = createArrangeHint({ toaster: fake });
    hint.setCombo(() => null);

    hint.note();

    expect(said[0]).toBe(BY_MENU);
  });
});
