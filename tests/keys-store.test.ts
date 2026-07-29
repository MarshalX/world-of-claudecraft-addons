// One addon's keybind overrides.
//
// The store's job is to answer "what combo is this id on right now", where the
// answer is the player's override if there is one and the manifest's default
// otherwise, and to announce every change so a live binding can move. The case
// most easily got wrong is the REMOVAL of an override in another tab: the
// binding has to go back to the manifest default, which a naive diff of two
// records reports as nothing having changed.

import { describe, expect, it, vi } from 'vitest';
import { createKeybindStore } from '../loader/src/runtime/keys/store.ts';
import type { KeybindDecl } from '../loader/src/shared/schema.ts';
import { configNamespace, KEYBINDS_KEY } from '../loader/src/shared/storage-keys.ts';
import { createFakeStorage, type FakeStorage } from './fakes/storage.ts';

const FQID = 'official/dps-meter';
const NS = configNamespace(FQID);

const DECLS: KeybindDecl[] = [
  { id: 'toggle', label: 'Toggle DPS window', default: 'Alt+KeyD' },
  { id: 'reset', label: 'Reset meter', default: 'Alt+Shift+KeyD' },
];

function open(hub: FakeStorage = createFakeStorage(), decls = DECLS) {
  return { hub, store: createKeybindStore({ fqid: FQID, decls, hub }) };
}

describe('reading a combo', () => {
  it('answers the manifest default before anything is overridden', () => {
    const { store } = open();

    expect(store.combo('toggle')).toBe('Alt+KeyD');
    expect(store.isOverridden('toggle')).toBe(false);
  });

  it('answers null for an id the manifest does not declare', () => {
    expect(open().store.combo('nope')).toBeNull();
  });

  it('lists the declared ids in manifest order', () => {
    expect(open().store.ids()).toEqual(['toggle', 'reset']);
  });

  it('answers the override once one is stored', async () => {
    const hub = createFakeStorage();
    await hub.set(NS, KEYBINDS_KEY, { toggle: 'Ctrl+KeyM' });
    const { store } = open(hub);

    await store.hydrate();

    expect(store.combo('toggle')).toBe('Ctrl+KeyM');
    expect(store.isOverridden('toggle')).toBe(true);
    expect(store.combo('reset')).toBe('Alt+Shift+KeyD');
  });

  // Storage is the player's to edit, and an older loader may have written
  // differently, so every stored row is parsed rather than trusted.
  it.each([
    ['an undeclared id', { unknown: 'Alt+KeyQ' }],
    ['a non-string combo', { toggle: 42 }],
    ['an unparseable combo', { toggle: 'Hyper+KeyD' }],
    ['a record that is not one', 'corrupted'],
  ])('ignores %s', async (_case, stored) => {
    const hub = createFakeStorage();
    await hub.set(NS, KEYBINDS_KEY, stored);
    const { store } = open(hub);

    await store.hydrate();

    expect(store.combo('toggle')).toBe('Alt+KeyD');
    expect(store.combo('unknown')).toBeNull();
  });

  it('normalizes a stored combo written in another modifier order', async () => {
    const hub = createFakeStorage();
    await hub.set(NS, KEYBINDS_KEY, { reset: 'Shift+Alt+KeyD' });
    const { store } = open(hub);

    await store.hydrate();

    expect(store.combo('reset')).toBe('Alt+Shift+KeyD');
  });
});

describe('rebinding', () => {
  it('persists and announces the new combo', async () => {
    const { hub, store } = open();
    const seen = vi.fn();
    store.onChange(seen);

    await store.set('toggle', 'Ctrl+KeyM');

    expect(store.combo('toggle')).toBe('Ctrl+KeyM');
    expect(hub.dump()[`${NS}/${KEYBINDS_KEY}`]).toEqual({ toggle: 'Ctrl+KeyM' });
    expect(seen).toHaveBeenCalledWith('toggle', 'Ctrl+KeyM');
  });

  it('stores the canonical form of a combo given in another order', async () => {
    const { hub, store } = open();

    await store.set('toggle', 'Shift+Ctrl+KeyM');

    expect(hub.dump()[`${NS}/${KEYBINDS_KEY}`]).toEqual({ toggle: 'Ctrl+Shift+KeyM' });
  });

  it.each([
    ['an undeclared id', 'nope', 'Alt+KeyQ', "no keybind declared with id 'nope'"],
    ['an unparseable combo', 'toggle', 'Hyper+KeyD', 'is not a valid combo'],
  ])('rejects %s', async (_case, id, combo, message) => {
    await expect(open().store.set(id, combo)).rejects.toThrow(message);
  });

  it('rolls back when the write fails', async () => {
    const { hub, store } = open();
    hub.failNext('bridge closed');

    await expect(store.set('toggle', 'Ctrl+KeyM')).rejects.toThrow('bridge closed');

    expect(store.combo('toggle')).toBe('Alt+KeyD');
  });
});

describe('resetting', () => {
  it('drops the override and announces the manifest default', async () => {
    const { hub, store } = open();
    await store.set('toggle', 'Ctrl+KeyM');
    const seen = vi.fn();
    store.onChange(seen);

    await store.reset('toggle');

    expect(store.combo('toggle')).toBe('Alt+KeyD');
    expect(store.isOverridden('toggle')).toBe(false);
    expect(hub.dump()[`${NS}/${KEYBINDS_KEY}`]).toEqual({});
    expect(seen).toHaveBeenCalledWith('toggle', 'Alt+KeyD');
  });

  it('rejects an undeclared id', async () => {
    await expect(open().store.reset('nope')).rejects.toThrow('no keybind declared');
  });
});

describe('changes from another tab', () => {
  it('takes a new override and announces it', () => {
    const { hub, store } = open();
    const seen = vi.fn();
    store.onChange(seen);

    hub.remote(NS, KEYBINDS_KEY, { toggle: 'Ctrl+KeyM' });

    expect(store.combo('toggle')).toBe('Ctrl+KeyM');
    expect(seen).toHaveBeenCalledWith('toggle', 'Ctrl+KeyM');
  });

  // The case a record diff gets wrong. An override REMOVED elsewhere has to move
  // the live binding back to the manifest default, and nothing in the new record
  // mentions the id at all.
  it('announces the manifest default when an override is removed elsewhere', () => {
    const { hub, store } = open();
    hub.remote(NS, KEYBINDS_KEY, { toggle: 'Ctrl+KeyM' });
    const seen = vi.fn();
    store.onChange(seen);

    hub.remote(NS, KEYBINDS_KEY, {});

    expect(store.combo('toggle')).toBe('Alt+KeyD');
    expect(seen).toHaveBeenCalledWith('toggle', 'Alt+KeyD');
  });

  it('ignores a write to the settings key in the same namespace', () => {
    const { hub, store } = open();

    hub.remote(NS, 'values', { window: 5 });

    expect(store.combo('toggle')).toBe('Alt+KeyD');
  });

  it('stops listening once disposed', () => {
    const { hub, store } = open();

    store.dispose();
    hub.remote(NS, KEYBINDS_KEY, { toggle: 'Ctrl+KeyM' });

    expect(store.combo('toggle')).toBe('Alt+KeyD');
  });
});
