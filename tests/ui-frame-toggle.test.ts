// @vitest-environment happy-dom

// `FrameOpts.toggleKey`: the keybind that shows and hides one frame.
//
// Driven through the REAL keys surface, so a rebind from the manager and a disable
// behave here as they do in a session. The lifecycle is the half worth the setup,
// which is why the count of live registrations is asserted and not just the toggle.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKeys } from '../loader/src/runtime/api/keys.ts';
import { DisposalBag } from '../loader/src/runtime/disposal.ts';
import { createKeyDispatcher, type KeyDispatcher } from '../loader/src/runtime/keys/dispatcher.ts';
import { createGameBindings } from '../loader/src/runtime/keys/game-bindings.ts';
import { createKeybindStore } from '../loader/src/runtime/keys/store.ts';
import { type AddonFrame, createAddonFrame } from '../loader/src/runtime/ui/kit/frame.ts';
import type { FrameOpts } from '../loader/src/runtime/ui/kit/frame-chrome.ts';
import { createFrameToggles } from '../loader/src/runtime/ui/kit/frame-toggle.ts';
import type { KeybindDecl } from '../loader/src/shared/schema.ts';
import { createFakeStorage } from './fakes/storage.ts';

const FQID = 'official/cooldown-bars';
const VIEW = { w: 1280, h: 800 };

const DECLS: KeybindDecl[] = [{ id: 'toggle', label: 'Show the bars', default: 'Alt+KeyC' }];

function press(target: EventTarget): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', altKey: true }));
}

function open() {
  const target = new EventTarget();
  const bag = new DisposalBag();
  const dispatcher = createKeyDispatcher({ target, doc: { activeElement: null } });
  const keys = createKeys({
    fqid: FQID,
    dispatcher,
    store: createKeybindStore({ fqid: FQID, decls: DECLS, hub: createFakeStorage() }),
    game: createGameBindings({ game: () => null, storage: () => null }),
    bag,
  });
  const warn = vi.fn();
  const toggles = createFrameToggles({ bind: keys.bind, warn });

  const root = document.createElement('div');
  root.id = 'woc-addons';
  document.body.appendChild(root);

  const build = (opts: FrameOpts): AddonFrame =>
    createAddonFrame({
      doc: document,
      root,
      fqid: FQID,
      chrome: 'frame',
      opts,
      store: null,
      toggles,
      viewport: () => VIEW,
      window: globalThis,
    });

  return { target, bag, dispatcher, warn, build };
}

/** Every live registration on the shared dispatcher, which is what must not accumulate. */
function registrations(dispatcher: KeyDispatcher): string[] {
  return Object.keys(dispatcher.bindings());
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('a declared toggleKey', () => {
  it('shows and hides the frame on the combo the manifest declared', () => {
    const { target, build } = open();
    const frame = build({ id: 'bars', toggleKey: 'toggle' });
    expect(frame.visible).toBe(true);

    press(target);
    expect(frame.visible).toBe(false);

    press(target);
    expect(frame.visible).toBe(true);
  });

  // The element, not only the accessor: a flag moved without the class reads as working.
  it('takes the frame off screen', () => {
    const { target, build } = open();
    const frame = build({ id: 'bars', toggleKey: 'toggle' });

    press(target);

    expect(frame.el.classList.contains('woc-hidden')).toBe(true);
  });

  it('binds nothing at all for a frame that did not ask for one', () => {
    const { target, dispatcher, build } = open();
    const frame = build({ id: 'bars' });

    press(target);

    expect(registrations(dispatcher)).toEqual([]);
    expect(frame.visible).toBe(true);
  });
});

describe('an undeclared toggleKey', () => {
  // A typo must cost the key, never the panel.
  it('warns, binds nothing, and still builds the frame', () => {
    const { target, dispatcher, warn, build } = open();

    const frame = build({ id: 'bars', toggleKey: 'togle' });

    expect(frame.el.isConnected).toBe(true);
    expect(registrations(dispatcher)).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain('togle');

    press(target);
    expect(frame.visible).toBe(true);
  });

  it('leaves the frame usable by hand', () => {
    const { build } = open();
    const frame = build({ id: 'bars', toggleKey: 'togle' });

    frame.toggle();

    expect(frame.visible).toBe(false);
  });
});

describe('the bind lifecycle', () => {
  it('releases the bind when the frame is destroyed', () => {
    const { target, dispatcher, build } = open();
    const frame = build({ id: 'bars', toggleKey: 'toggle' });
    expect(registrations(dispatcher)).toEqual([`${FQID}:toggle`]);

    frame.destroy();

    expect(registrations(dispatcher)).toEqual([]);
    // Nothing is left holding the key, so the game gets it back.
    expect(() => {
      press(target);
    }).not.toThrow();
  });

  // The order that breaks a bind per frame: the dispatcher refuses the second one.
  it('survives a rebuild that builds the replacement before destroying the old', () => {
    const { target, dispatcher, build } = open();
    const first = build({ id: 'bars', toggleKey: 'toggle' });

    const second = build({ id: 'bars', toggleKey: 'toggle' });
    first.destroy();

    expect(registrations(dispatcher)).toEqual([`${FQID}:toggle`]);
    press(target);
    expect(second.visible).toBe(false);
  });

  it('survives a rebuild that destroys the old frame first', () => {
    const { target, dispatcher, build } = open();
    const first = build({ id: 'bars', toggleKey: 'toggle' });

    first.destroy();
    const second = build({ id: 'bars', toggleKey: 'toggle' });

    expect(registrations(dispatcher)).toEqual([`${FQID}:toggle`]);
    press(target);
    expect(second.visible).toBe(false);
  });

  // A toggle landing on a destroyed frame persists a visibility for a panel that is gone.
  it('leaves the key acting on the surviving frame only', () => {
    const { target, build } = open();
    const first = build({ id: 'bars', toggleKey: 'toggle' });
    const second = build({ id: 'bars', toggleKey: 'toggle' });
    first.destroy();

    press(target);

    expect(second.visible).toBe(false);
    expect(first.visible).toBe(true);
  });

  // A claim outliving its frame is invisible while a later frame holds the key. It
  // shows only when the last frame goes and the registration does not.
  it('holds one claim per live frame, so a rebuilt frame still gives the key back', () => {
    const { dispatcher, build } = open();
    const first = build({ id: 'bars', toggleKey: 'toggle' });
    const second = build({ id: 'bars', toggleKey: 'toggle' });

    first.destroy();
    second.destroy();

    expect(registrations(dispatcher)).toEqual([]);
  });

  it('releases the bind when the addon is disabled', () => {
    const { target, bag, dispatcher, build } = open();
    const frame = build({ id: 'bars', toggleKey: 'toggle' });

    bag.dispose();

    expect(registrations(dispatcher)).toEqual([]);
    press(target);
    expect(frame.visible).toBe(true);
  });
});
