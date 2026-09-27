// @vitest-environment happy-dom

// The rebinding flow behind the manager's key bindings pane: moving a live binding, listing
// bindings for conflicts, refusing a duplicate, and capturing the player's next press. The listener
// itself is covered in keys-dispatcher.test.ts.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKeyDispatcher } from '../loader/src/runtime/keys/dispatcher.ts';

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

/** Stands in for the game's own listener, in the BUBBLE phase on the same target. */
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

describe('rebinding', () => {
  it('moves a live binding to the new combo', () => {
    const { target, dispatcher } = open();
    const handler = vi.fn();
    dispatcher.register(KEY, 'Alt+KeyD', handler);

    dispatcher.rebind(KEY, 'Ctrl+KeyM');
    press(target, { code: 'KeyD', alt: true });
    press(target, { code: 'KeyM', ctrl: true });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('reports every live binding for conflict detection', () => {
    const { dispatcher } = open();
    dispatcher.register('a:x', 'Alt+KeyD', vi.fn());
    dispatcher.register('b:y', 'Shift+Ctrl+KeyM', vi.fn());

    expect(dispatcher.bindings()).toEqual({
      'a:x': 'Alt+KeyD',
      'b:y': 'Ctrl+Shift+KeyM',
    });
  });

  it.each([
    ['an unparseable combo', 'Hyper+KeyD'],
    ['Escape, which would shadow the game menu', 'Escape'],
  ])('refuses to register %s', (_case, combo) => {
    const { dispatcher } = open();

    expect(() => dispatcher.register(KEY, combo, vi.fn())).toThrow('not a bindable combo');
  });

  it('refuses to register the same key twice', () => {
    const { dispatcher } = open();
    dispatcher.register(KEY, 'Alt+KeyD', vi.fn());

    expect(() => dispatcher.register(KEY, 'Ctrl+KeyM', vi.fn())).toThrow('already bound');
  });

  it('refuses to rebind something that is not bound', () => {
    expect(() => open().dispatcher.rebind(KEY, 'Ctrl+KeyM')).toThrow('is not bound');
  });
});

describe('capture', () => {
  it('reports the next press as a canonical combo', async () => {
    const { target, dispatcher } = open();

    const capture = dispatcher.capture();
    press(target, { code: 'KeyM', ctrl: true, shift: true });

    expect(await capture.done).toBe('Ctrl+Shift+KeyM');
  });

  // The manager's combo field has focus while capture waits.
  it('claims the press even while an input has focus', async () => {
    const el = document.createElement('input');
    const { target, dispatcher } = open({ activeElement: el });

    const capture = dispatcher.capture();
    press(target, { code: 'KeyD', alt: true });

    expect(await capture.done).toBe('Alt+KeyD');
  });

  it('swallows the captured press so the game does not act on it', () => {
    const { target, dispatcher } = open();
    const game = gameListener(target);

    dispatcher.capture();
    const event = press(target, { code: 'KeyD', alt: true });

    expect(game).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores a bare modifier and waits for a real key', async () => {
    const { target, dispatcher } = open();

    const capture = dispatcher.capture();
    press(target, { code: 'ShiftLeft', shift: true });
    press(target, { code: 'KeyD', alt: true });

    expect(await capture.done).toBe('Alt+KeyD');
  });

  it('claims only one press', () => {
    const { target, dispatcher } = open();
    const game = gameListener(target);

    dispatcher.capture();
    press(target, { code: 'KeyD', alt: true });
    press(target, { code: 'KeyF' });

    expect(game).toHaveBeenCalledOnce();
  });

  it('resolves null when cancelled', async () => {
    const capture = open().dispatcher.capture();

    capture.cancel();

    expect(await capture.done).toBeNull();
  });

  it('releases a superseded capture rather than leaving it pending', async () => {
    const { dispatcher } = open();

    const first = dispatcher.capture();
    dispatcher.capture();

    expect(await first.done).toBeNull();
  });

  it('does not let a stale cancel kill the live capture', async () => {
    const { target, dispatcher } = open();
    const first = dispatcher.capture();
    const second = dispatcher.capture();

    first.cancel();
    press(target, { code: 'KeyD', alt: true });

    expect(await second.done).toBe('Alt+KeyD');
  });

  it('releases a pending capture on dispose', async () => {
    const { dispatcher } = open();

    const capture = dispatcher.capture();
    dispatcher.dispose();

    expect(await capture.done).toBeNull();
  });
});
