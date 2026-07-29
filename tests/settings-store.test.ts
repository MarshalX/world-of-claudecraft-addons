// One addon's settings store.
//
// The property that matters is that `values()` is correct SYNCHRONOUSLY at
// every point an addon can observe it: after hydrate, immediately after a write
// (before the host has acknowledged it), and after another tab's write arrives.
// An addon reads `woc.settings.window` on its first line and does arithmetic
// with it, so a window where it reads the old value is a window where the addon
// is wrong and nothing says so.

import { describe, expect, it, vi } from 'vitest';
import { createSettingsStore } from '../loader/src/runtime/settings/store.ts';
import type { SettingDecl } from '../loader/src/shared/schema.ts';
import { configNamespace, SETTINGS_KEY } from '../loader/src/shared/storage-keys.ts';
import { createFakeStorage, type FakeStorage } from './fakes/storage.ts';

const FQID = 'official/dps-meter';
const NS = configNamespace(FQID);

const DECLS: SettingDecl[] = [
  { id: 'window', type: 'number', label: 'Rolling window', default: 5, min: 1, max: 60 },
  { id: 'show-pet', type: 'boolean', label: 'Include pet damage', default: true },
];

function open(hub: FakeStorage = createFakeStorage(), decls = DECLS) {
  return { hub, store: createSettingsStore({ fqid: FQID, decls, hub }) };
}

describe('hydrating', () => {
  it('reads defaults before hydrate has run', () => {
    const { store } = open();

    expect(store.values()).toEqual({ window: 5, 'show-pet': true });
  });

  it('reads the persisted record', async () => {
    const hub = createFakeStorage();
    await hub.set(NS, SETTINGS_KEY, { window: 12, 'show-pet': false });
    const { store } = open(hub);

    await store.hydrate();

    expect(store.values()).toEqual({ window: 12, 'show-pet': false });
  });

  // An addon with nothing declared must not make every session pay a bridge
  // round trip for an empty object, and must still hydrate with no host at all.
  it('does not touch storage for an addon that declares nothing', async () => {
    const hub = createFakeStorage({ connected: false });
    const { store } = open(hub, []);

    await expect(store.hydrate()).resolves.toBeUndefined();
    expect(store.values()).toEqual({});
  });

  it('falls back to defaults when the read fails', async () => {
    const hub = createFakeStorage();
    hub.failNext('bridge closed');
    const { store } = open(hub);

    await store.hydrate();

    expect(store.values()).toEqual({ window: 5, 'show-pet': true });
  });

  it('falls back to defaults when storage holds something that is not a record', async () => {
    const hub = createFakeStorage();
    await hub.set(NS, SETTINGS_KEY, 'corrupted');
    const { store } = open(hub);

    await store.hydrate();

    expect(store.values()).toMatchObject({ window: 5 });
  });
});

describe('writing', () => {
  // Applied locally BEFORE the host acknowledges. The manager has already
  // painted the new value; waiting for the echo leaves a window in which
  // woc.settings still reads the old one.
  it('is readable synchronously, before the write resolves', () => {
    const { store } = open();

    const writing = store.set('window', 30);

    expect(store.values()).toMatchObject({ window: 30 });
    return writing;
  });

  it('persists to the addon config namespace', async () => {
    const { hub, store } = open();

    await store.set('window', 30);

    expect(hub.dump()[`${NS}/${SETTINGS_KEY}`]).toEqual({ window: 30, 'show-pet': true });
  });

  it('notifies subscribers', async () => {
    const { store } = open();
    const seen = vi.fn();
    store.onChange(seen);

    await store.set('show-pet', false);

    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ 'show-pet': false }));
  });

  it('clamps a value into its declared range rather than refusing it', async () => {
    const { store } = open();

    await store.set('window', 999);

    expect(store.values()).toMatchObject({ window: 60 });
  });

  it.each([
    ['an undeclared id', 'nope', 1, "no setting declared with id 'nope'"],
    ['the wrong type', 'window', 'twelve', 'does not accept'],
  ])('rejects %s', async (_case, id, value, message) => {
    const { store } = open();

    await expect(store.set(id, value as never)).rejects.toThrow(message);
  });

  // A value that looks saved and is not is worse than one that visibly failed.
  it('rolls back and re-notifies when the write fails', async () => {
    const { hub, store } = open();
    const seen = vi.fn();
    store.onChange(seen);
    hub.failNext('quota exceeded');

    await expect(store.set('window', 30)).rejects.toThrow('quota exceeded');

    expect(store.values()).toMatchObject({ window: 5 });
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ window: 5 }));
  });
});

describe('changes from elsewhere', () => {
  it("takes another tab's write", async () => {
    const { hub, store } = open();
    await store.hydrate();
    const seen = vi.fn();
    store.onChange(seen);

    hub.remote(NS, SETTINGS_KEY, { window: 42, 'show-pet': false });

    expect(store.values()).toEqual({ window: 42, 'show-pet': false });
    expect(seen).toHaveBeenCalledOnce();
  });

  it('ignores a write to another key in the same namespace', async () => {
    const { hub, store } = open();
    await store.hydrate();

    hub.remote(NS, 'keybinds', { toggle: 'Alt+KeyD' });

    expect(store.values()).toMatchObject({ window: 5 });
  });

  it('re-hydrates rather than trusting a partial record', () => {
    const { hub, store } = open();

    hub.remote(NS, SETTINGS_KEY, { window: 9 });

    expect(store.values()).toEqual({ window: 9, 'show-pet': true });
  });

  it('stops listening once disposed', async () => {
    const { hub, store } = open();
    await store.hydrate();

    store.dispose();
    hub.remote(NS, SETTINGS_KEY, { window: 42 });

    expect(store.values()).toMatchObject({ window: 5 });
  });

  it('keeps notifying the rest when one handler throws', () => {
    const { hub, store } = open();
    const after = vi.fn();
    store.onChange(() => {
      throw new Error('addon handler blew up');
    });
    store.onChange(after);

    hub.remote(NS, SETTINGS_KEY, { window: 7 });

    expect(after).toHaveBeenCalledOnce();
  });
});
