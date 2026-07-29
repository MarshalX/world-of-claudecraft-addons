// @vitest-environment happy-dom

// Toasts and modals: the two announcement surfaces the kit shares across every
// addon rather than letting one own. Tooltips are the third and live in
// ui-kit-tooltip.test.ts.
//
// The common thread is that each keeps ONE element for the whole loader and
// moves or refills it. The alternative, one node per toast, means a hundred
// hidden divs for a hundred rows in an addon's list. Both also have to settle:
// a toast releases its timer and a modal resolves its promise however it went
// away, including when the addon was disabled out from under it.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BUTTONS, openAlert } from '../loader/src/runtime/ui/kit/alert.ts';
import { createToaster, MAX_VISIBLE, STACK_ID } from '../loader/src/runtime/ui/kit/toast.ts';

function root(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'woc-addons';
  document.body.appendChild(el);
  return el;
}

function toaster() {
  const timers = new Map<number, () => void>();
  let nextId = 1;
  const instance = createToaster({
    doc: document,
    root: root(),
    setTimer: (handler) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, handler);
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
    },
  });
  return {
    toaster: instance,
    expire: () => {
      for (const handler of [...timers.values()]) {
        handler();
      }
    },
    pending: () => timers.size,
  };
}

function toasts(): string[] {
  return [...document.querySelectorAll('.woc-toast')].map((el) => el.textContent ?? '');
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('toasts', () => {
  it('shows the text and nothing but the text', () => {
    const { toaster: t } = toaster();

    t.show('<b>Pull in 5</b>');

    expect(toasts()).toEqual(['<b>Pull in 5</b>']);
    expect(document.querySelector('.woc-toast b')).toBeNull();
  });

  it('shares one stack across every toast', () => {
    const { toaster: t } = toaster();

    t.show('one');
    t.show('two');

    expect(document.querySelectorAll(`#${STACK_ID}`)).toHaveLength(1);
    expect(toasts()).toEqual(['one', 'two']);
  });

  it('announces politely rather than by stealing focus', () => {
    const { toaster: t } = toaster();

    t.show('one');

    expect(document.getElementById(STACK_ID)?.getAttribute('aria-live')).toBe('polite');
  });

  it('carries the kind as a class', () => {
    const { toaster: t } = toaster();

    t.show('careful', { kind: 'warn' });

    expect(document.querySelector('.woc-toast-warn')).not.toBeNull();
  });

  it('goes away when its timer expires', () => {
    const { toaster: t, expire } = toaster();
    t.show('one');

    expire();

    expect(toasts()).toEqual([]);
  });

  it('goes away when dismissed, and clears its timer', () => {
    const { toaster: t, pending } = toaster();

    t.show('one')();

    expect(toasts()).toEqual([]);
    expect(pending()).toBe(0);
  });

  it('stays up with no timer when the timeout is zero', () => {
    const { toaster: t, expire, pending } = toaster();

    t.show('sticky', { timeout: 0 });
    expire();

    expect(pending()).toBe(0);
    expect(toasts()).toEqual(['sticky']);
  });

  // The oldest goes rather than the newest being refused: the newest message is
  // the one the player is most likely to be waiting for.
  it('drops the oldest once the column is full', () => {
    const { toaster: t } = toaster();

    for (let index = 0; index < MAX_VISIBLE + 2; index += 1) {
      t.show(`toast ${index}`, { timeout: 0 });
    }

    expect(toasts()).toHaveLength(MAX_VISIBLE);
    expect(toasts()[0]).toBe('toast 2');
  });

  it('takes the stack away on dispose', () => {
    const { toaster: t } = toaster();
    t.show('one', { timeout: 0 });

    t.dispose();

    expect(document.getElementById(STACK_ID)).toBeNull();
  });
});

describe('modals', () => {
  function open(opts: Parameters<typeof openAlert>[1]) {
    return openAlert({ doc: document, root: root() }, opts);
  }

  it('resolves with the id of the button pressed', async () => {
    const modal = open({
      message: 'Reset the meter?',
      buttons: [
        { id: 'cancel', label: 'Cancel', cancel: true },
        { id: 'reset', label: 'Reset', primary: true },
      ],
    });

    document.querySelectorAll<HTMLButtonElement>('.woc-modal-buttons button')[1]?.click();

    expect(await modal.answer).toBe('reset');
  });

  it('offers a dismissing OK when the addon gave no buttons', async () => {
    const modal = open({ message: 'Done.' });

    expect(document.querySelectorAll('.woc-modal-buttons button')).toHaveLength(
      DEFAULT_BUTTONS.length,
    );
    document.querySelector<HTMLButtonElement>('.woc-btn-primary')?.click();
    expect(await modal.answer).toBe('ok');
  });

  it('resolves the cancel id on Escape, and stops the game seeing the key', async () => {
    const heard = vi.fn();
    document.addEventListener('keydown', heard);
    const modal = open({
      message: 'Reset?',
      buttons: [
        { id: 'no', label: 'Cancel', cancel: true },
        { id: 'yes', label: 'Reset' },
      ],
    });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(await modal.answer).toBe('no');
    expect(heard).not.toHaveBeenCalled();
  });

  it('resolves null on Escape when there is no cancel button', async () => {
    const modal = open({ message: 'Note', buttons: [{ id: 'yes', label: 'Yes' }] });

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(await modal.answer).toBeNull();
  });

  it('dismisses on a backdrop click but not on a click inside the panel', async () => {
    const modal = open({ message: 'Note', buttons: [{ id: 'no', label: 'No', cancel: true }] });

    document.querySelector('.woc-modal')?.dispatchEvent(new Event('click', { bubbles: true }));
    expect(document.querySelector('.woc-modal')).not.toBeNull();

    document.querySelector('.woc-modal-backdrop')?.dispatchEvent(new Event('click'));
    expect(await modal.answer).toBe('no');
  });

  // The addon's await is usually mid-way through something it has to finish or
  // abandon cleanly, so being disabled must release it rather than hang it.
  it('resolves when closed because the addon was disabled', async () => {
    const modal = open({ message: 'Note', buttons: [{ id: 'no', label: 'No', cancel: true }] });

    modal.close();

    expect(await modal.answer).toBe('no');
    expect(document.querySelector('.woc-modal-backdrop')).toBeNull();
  });

  it('settles once, whatever answers first', async () => {
    const modal = open({ message: 'Note', buttons: [{ id: 'yes', label: 'Yes' }] });

    document.querySelector<HTMLButtonElement>('.woc-modal-buttons button')?.click();
    modal.close();

    expect(await modal.answer).toBe('yes');
  });

  it('stops listening for Escape once it has closed', async () => {
    const heard = vi.fn();
    const modal = open({ message: 'Note', buttons: [{ id: 'no', label: 'No', cancel: true }] });
    modal.close();
    await modal.answer;

    document.addEventListener('keydown', heard);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(heard).toHaveBeenCalledOnce();
  });
});
