// @vitest-environment happy-dom

// The loader's one keydown listener: which press fires a handler, and what
// still reaches the game.
//
// The load-bearing claim is negative: an UNCLAIMED key reaches the game
// untouched. The dispatcher runs in the capture phase, ahead of the game's own
// bubble-phase handler, so calling stopImmediatePropagation too eagerly would
// quietly degrade the controls of a game the player is still playing, and
// nothing would report it. Every test that asserts propagation is asserting
// that.
//
// The registry the manager drives on top of this listener, rebinding, conflict
// listing, and reading the player's next press, is covered in
// keys-dispatcher-rebinding.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKeyDispatcher, isEditing } from '../loader/src/runtime/keys/dispatcher.ts';

const KEY = 'official/combat-meter:toggle';

interface Press {
  code: string;
  alt?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
  repeat?: boolean;
}

function press(target: EventTarget, key: Press): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    code: key.code,
    altKey: key.alt ?? false,
    ctrlKey: key.ctrl ?? false,
    shiftKey: key.shift ?? false,
    metaKey: key.meta ?? false,
    repeat: key.repeat ?? false,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

/**
 * A listener standing in for the game's own, registered in the BUBBLE phase on
 * the same target. Whether this runs is the whole question.
 */
function gameListener(target: EventTarget) {
  const heard = vi.fn();
  target.addEventListener('keydown', heard);
  return heard;
}

const teardown: Array<() => void> = [];

afterEach(() => {
  for (const stop of teardown.splice(0)) {
    stop();
  }
  document.body.innerHTML = '';
});

function open(doc: Pick<Document, 'activeElement'> = document) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const dispatcher = createKeyDispatcher({ target, doc });
  teardown.push(dispatcher.dispose);
  return { target, dispatcher };
}

describe('dispatching', () => {
  it('fires a handler on its combo', () => {
    const { target, dispatcher } = open();
    const handler = vi.fn();
    dispatcher.register(KEY, 'Alt+KeyD', handler);

    press(target, { code: 'KeyD', alt: true });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not fire on the same key without the modifier', () => {
    const { target, dispatcher } = open();
    const handler = vi.fn();
    dispatcher.register(KEY, 'Alt+KeyD', handler);

    press(target, { code: 'KeyD' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not fire on the modifier with a different key', () => {
    const { target, dispatcher } = open();
    const handler = vi.fn();
    dispatcher.register(KEY, 'Alt+KeyD', handler);

    press(target, { code: 'KeyF', alt: true });

    expect(handler).not.toHaveBeenCalled();
  });

  it('matches a combo registered in a non-canonical modifier order', () => {
    const { target, dispatcher } = open();
    const handler = vi.fn();
    dispatcher.register(KEY, 'Shift+Ctrl+KeyM', handler);

    press(target, { code: 'KeyM', ctrl: true, shift: true });

    expect(handler).toHaveBeenCalledOnce();
  });

  // A conflict warns rather than blocks, so two binds on one combo both fire.
  it('fires every binding on the same combo', () => {
    const { target, dispatcher } = open();
    const first = vi.fn();
    const second = vi.fn();
    dispatcher.register('a:x', 'Alt+KeyD', first);
    dispatcher.register('b:y', 'Alt+KeyD', second);

    press(target, { code: 'KeyD', alt: true });

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it('keeps going after one handler throws', () => {
    const { target, dispatcher } = open();
    const after = vi.fn();
    dispatcher.register('a:x', 'Alt+KeyD', () => {
      throw new Error('addon handler blew up');
    });
    dispatcher.register('b:y', 'Alt+KeyD', after);

    expect(() => {
      press(target, { code: 'KeyD', alt: true });
    }).not.toThrow();
    expect(after).toHaveBeenCalledOnce();
  });

  // Addon binds are edge actions: a command, not a held movement key.
  it('ignores auto-repeat', () => {
    const { target, dispatcher } = open();
    const handler = vi.fn();
    dispatcher.register(KEY, 'Alt+KeyD', handler);

    press(target, { code: 'KeyD', alt: true, repeat: true });

    expect(handler).not.toHaveBeenCalled();
  });

  it('ignores a bare modifier press', () => {
    const { target, dispatcher } = open();
    const handler = vi.fn();
    dispatcher.register(KEY, 'Alt+KeyD', handler);

    press(target, { code: 'AltLeft', alt: true });

    expect(handler).not.toHaveBeenCalled();
  });
});

describe('what reaches the game', () => {
  it('lets an unclaimed key through untouched', () => {
    const { target, dispatcher } = open();
    const game = gameListener(target);
    dispatcher.register(KEY, 'Alt+KeyD', vi.fn());

    const event = press(target, { code: 'KeyW' });

    expect(game).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
  });

  it('lets a bare modifier through', () => {
    const { target, dispatcher } = open();
    const game = gameListener(target);
    dispatcher.register(KEY, 'Alt+KeyD', vi.fn());

    press(target, { code: 'ShiftLeft', shift: true });

    expect(game).toHaveBeenCalledOnce();
  });

  it('lets an auto-repeat through, so held movement keys keep working', () => {
    const { target, dispatcher } = open();
    const game = gameListener(target);
    dispatcher.register(KEY, 'Alt+KeyD', vi.fn());

    press(target, { code: 'KeyD', alt: true, repeat: true });

    expect(game).toHaveBeenCalledOnce();
  });

  // Claimed means claimed: the game must not also act, and neither must the
  // browser, since a player who bound Ctrl+KeyS meant the addon, not a save.
  it('stops a claimed key reaching the game', () => {
    const { target, dispatcher } = open();
    const game = gameListener(target);
    dispatcher.register(KEY, 'Alt+KeyD', vi.fn());

    const event = press(target, { code: 'KeyD', alt: true });

    expect(game).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('stops firing and stops claiming once unregistered', () => {
    const { target, dispatcher } = open();
    const game = gameListener(target);
    const handler = vi.fn();
    const off = dispatcher.register(KEY, 'Alt+KeyD', handler);

    off();
    press(target, { code: 'KeyD', alt: true });

    expect(handler).not.toHaveBeenCalled();
    expect(game).toHaveBeenCalledOnce();
  });

  it('stops claiming once disposed', () => {
    const { target, dispatcher } = open();
    const game = gameListener(target);
    dispatcher.register(KEY, 'Alt+KeyD', vi.fn());

    dispatcher.dispose();
    press(target, { code: 'KeyD', alt: true });

    expect(game).toHaveBeenCalledOnce();
  });
});

describe('the editable-element guard', () => {
  it.each([['input'], ['textarea'], ['select']])('declines while focus is in a %s', (tag) => {
    const el = document.createElement(tag);
    const { target, dispatcher } = open({ activeElement: el });
    const handler = vi.fn();
    dispatcher.register(KEY, 'Alt+KeyD', handler);

    press(target, { code: 'KeyD', alt: true });

    expect(handler).not.toHaveBeenCalled();
  });

  it('declines while focus is in a contenteditable region', () => {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'true');
    document.body.appendChild(el);
    const { target, dispatcher } = open({ activeElement: el });
    const handler = vi.fn();
    dispatcher.register(KEY, 'Alt+KeyD', handler);

    press(target, { code: 'KeyD', alt: true });

    expect(handler).not.toHaveBeenCalled();
  });

  it('lets the key reach the game while the player is typing', () => {
    const el = document.createElement('input');
    const { target, dispatcher } = open({ activeElement: el });
    const game = gameListener(target);
    dispatcher.register(KEY, 'Alt+KeyD', vi.fn());

    press(target, { code: 'KeyD', alt: true });

    expect(game).toHaveBeenCalledOnce();
  });

  it('fires normally when nothing editable has focus', () => {
    const { target, dispatcher } = open({ activeElement: document.body });
    const handler = vi.fn();
    dispatcher.register(KEY, 'Alt+KeyD', handler);

    press(target, { code: 'KeyD', alt: true });

    expect(handler).toHaveBeenCalledOnce();
  });
});

describe('isEditing', () => {
  it('is false with no focus at all', () => {
    expect(isEditing({ activeElement: null })).toBe(false);
  });

  // The caret sits in the container of a contenteditable region, so a node
  // nested inside one has to be found by walking up.
  it('is true for a node inside a contenteditable region', () => {
    const region = document.createElement('div');
    region.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span');
    region.appendChild(inner);
    document.body.appendChild(region);

    expect(isEditing({ activeElement: inner })).toBe(true);
  });
});
