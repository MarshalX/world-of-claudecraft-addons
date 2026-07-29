// @vitest-environment happy-dom

// The woc.keys surface.
//
// The behaviour that justifies the whole design is that an addon binds by
// DECLARED ID and never by combo, so a rebind made in the manager moves the live
// registration underneath a running addon with nothing for the addon to do. The
// other half is disposal: every bind has to be released when the addon is
// disabled, or a disabled addon keeps eating key presses.

import { describe, expect, it, vi } from 'vitest';
import { createKeys } from '../loader/src/runtime/api/keys.ts';
import { DisposalBag } from '../loader/src/runtime/disposal.ts';
import { createKeyDispatcher } from '../loader/src/runtime/keys/dispatcher.ts';
import { createGameBindings } from '../loader/src/runtime/keys/game-bindings.ts';
import { createKeybindStore } from '../loader/src/runtime/keys/store.ts';
import type { KeybindDecl } from '../loader/src/shared/schema.ts';
import { liveGame } from './fakes/game-keybinds.ts';
import { createFakeStorage } from './fakes/storage.ts';

const FQID = 'official/dps-meter';

const DECLS: KeybindDecl[] = [
  { id: 'toggle', label: 'Toggle DPS window', default: 'Alt+KeyD' },
  { id: 'reset', label: 'Reset meter', default: 'Alt+Shift+KeyD' },
];

function press(target: EventTarget, code: string, mods: { alt?: boolean; ctrl?: boolean } = {}) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      code,
      altKey: mods.alt ?? false,
      ctrlKey: mods.ctrl ?? false,
    }),
  );
}

function open(game: unknown = null) {
  const target = new EventTarget();
  const hub = createFakeStorage();
  const bag = new DisposalBag();
  const dispatcher = createKeyDispatcher({ target, doc: { activeElement: null } });
  const store = createKeybindStore({ fqid: FQID, decls: DECLS, hub });
  const keys = createKeys({
    fqid: FQID,
    dispatcher,
    store,
    game: createGameBindings({ game: () => game, storage: () => null }),
    bag,
  });
  return { target, hub, bag, dispatcher, store, keys };
}

describe('binding', () => {
  it('binds the combo the manifest declared', () => {
    const { target, keys } = open();
    const handler = vi.fn();

    keys.bind('toggle', handler);
    press(target, 'KeyD', { alt: true });

    expect(handler).toHaveBeenCalledOnce();
  });

  // This is what lets the manager render an addon's full keybind editor for an
  // addon it has never run.
  it('throws for an id the manifest does not declare', () => {
    const { keys } = open();

    expect(() => keys.bind('undeclared', vi.fn())).toThrow('manifest');
  });

  it('reports the combo in force', () => {
    const { keys } = open();

    expect(keys.combo('toggle')).toBe('Alt+KeyD');
    expect(keys.combo('undeclared')).toBeNull();
  });

  it('namespaces the registration by fqid, so two addons can share a bind id', () => {
    const { dispatcher, keys } = open();

    keys.bind('toggle', vi.fn());

    expect(Object.keys(dispatcher.bindings())).toEqual([`${FQID}:toggle`]);
  });
});

describe('rebinding underneath a running addon', () => {
  // The point of binding by id. The addon's handler is untouched.
  it('moves the live registration when the store changes', async () => {
    const { target, keys, store } = open();
    const handler = vi.fn();
    keys.bind('toggle', handler);

    await store.set('toggle', 'Ctrl+KeyM');
    press(target, 'KeyD', { alt: true });
    press(target, 'KeyM', { ctrl: true });

    expect(handler).toHaveBeenCalledOnce();
  });

  it('rebinds through the api as well as through the store', async () => {
    const { target, keys } = open();
    const handler = vi.fn();
    keys.bind('toggle', handler);

    await keys.set('toggle', 'Ctrl+KeyM');
    press(target, 'KeyM', { ctrl: true });

    expect(handler).toHaveBeenCalledOnce();
  });

  // The store announces every declared id on a change, so an id this addon
  // never bound must not be handed to the dispatcher as a rebind.
  it('ignores a change for an id this addon has not bound', async () => {
    const { keys, store } = open();
    keys.bind('toggle', vi.fn());

    await expect(store.set('reset', 'Ctrl+KeyR')).resolves.toBeUndefined();
  });

  it('stops rebinding an id after it has been unbound', async () => {
    const { keys, store } = open();
    const off = keys.bind('toggle', vi.fn());

    off();

    await expect(store.set('toggle', 'Ctrl+KeyM')).resolves.toBeUndefined();
  });
});

describe('disposal', () => {
  it('releases every bind when the addon is disabled', () => {
    const { target, bag, keys } = open();
    const handler = vi.fn();
    keys.bind('toggle', handler);

    bag.dispose();
    press(target, 'KeyD', { alt: true });

    expect(handler).not.toHaveBeenCalled();
  });

  it('lets an explicit unbind also drop the bag entry', () => {
    const { bag, keys } = open();

    const off = keys.bind('toggle', vi.fn());
    const withBind = bag.size;
    off();

    expect(bag.size).toBeLessThan(withBind);
  });

  it('releases a pending capture prompt', async () => {
    const { bag, keys } = open();

    const capture = keys.capture();
    bag.dispose();

    expect(await capture).toBeNull();
  });
});

describe('conflicts', () => {
  // The shared class fake, so `this` is lost here exactly as it would be live.
  const game = liveGame({ held: [['KeyW', 'moveForward']] });

  it('reports a game action and says the reading was live', () => {
    const { keys } = open(game);

    expect(keys.conflicts('Alt+KeyW')).toEqual({
      game: ['moveForward'],
      addons: [],
      source: 'live',
    });
  });

  it('reports another live addon binding', () => {
    const { dispatcher, keys } = open(game);
    dispatcher.register('other/addon:show', 'Ctrl+KeyM', vi.fn());

    expect(keys.conflicts('Ctrl+KeyM').addons).toEqual(['other/addon:show']);
  });

  it('reports a free combo as free', () => {
    const { keys } = open(game);

    expect(keys.conflicts('Alt+KeyJ')).toEqual({ game: [], addons: [], source: 'live' });
  });

  // A 'stored' or 'none' reading with no conflicts does not mean the key is
  // free, so the source travels with the answer rather than being dropped.
  it('says when it had no source to read', () => {
    const { keys } = open();

    expect(keys.conflicts('Alt+KeyW').source).toBe('none');
  });
});
