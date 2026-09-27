// The manager's per-addon config service. It writes through the same storage hub a running addon
// reads, so editing an enabled and a disabled addon is one code path.

import { describe, expect, it, vi } from 'vitest';
import { createGameBindings } from '../loader/src/runtime/keys/game-bindings.ts';
import { createSettingsStore } from '../loader/src/runtime/settings/store.ts';
import { createConfigService } from '../loader/src/runtime/ui/manager/config.ts';
import type { InstalledAddon } from '../loader/src/shared/protocol.ts';
import { configNamespace, SETTINGS_KEY } from '../loader/src/shared/storage-keys.ts';
import { liveGame } from './fakes/game-keybinds.ts';
import { createFakeStorage, type FakeStorage } from './fakes/storage.ts';

const FQID = 'official/combat-meter';

function addon(overrides: Partial<InstalledAddon['manifest']> = {}): InstalledAddon {
  return {
    fqid: FQID,
    marketplace: 'official',
    enabled: false,
    pin: null,
    manifest: {
      id: 'combat-meter',
      name: 'Combat Meter',
      version: '1.2.0',
      apiVersion: 1,
      author: 'MarshalX',
      description: 'Rolling damage per second.',
      entry: 'main.js',
      settings: [{ id: 'window', type: 'number', label: 'Window', default: 5, min: 1, max: 60 }],
      keybinds: [{ id: 'toggle', label: 'Toggle', default: 'Alt+KeyD' }],
      ...overrides,
    },
  };
}

function open(options?: { hub?: FakeStorage; game?: unknown; bindings?: Record<string, string> }) {
  const hub = options?.hub ?? createFakeStorage();
  const onChange = vi.fn();
  const service = createConfigService({
    hub,
    game: createGameBindings({ game: () => options?.game ?? null, storage: () => null }),
    addonBindings: () => options?.bindings ?? {},
    onChange,
  });
  return { hub, service, onChange };
}

describe('opening an addon', () => {
  it('builds hydrated stores from what is in storage', async () => {
    const hub = createFakeStorage();
    await hub.set(configNamespace(FQID), SETTINGS_KEY, { window: 30 });
    const { service } = open({ hub });

    const config = await service.open(addon());

    expect(config.settings.values()).toMatchObject({ window: 30 });
    expect(config.keybinds.combo('toggle')).toBe('Alt+KeyD');
  });

  it('caches, so reopening the same addon is the same stores', async () => {
    const { service } = open();

    const first = await service.open(addon());
    const second = await service.open(addon());

    expect(second).toBe(first);
  });

  // The player can click twice before the first round trip lands.
  it('hydrates at most once however fast it is opened', async () => {
    const { service } = open();

    const [first, second] = await Promise.all([service.open(addon()), service.open(addon())]);

    expect(second).toBe(first);
  });

  it('peeks without loading, so a reopen paints instantly', async () => {
    const { service } = open();

    expect(service.peek(addon())).toBeNull();
    await service.open(addon());

    expect(service.peek(addon())).not.toBeNull();
  });

  it('works for an addon that declares neither settings nor keybinds', async () => {
    const { service } = open();

    const config = await service.open(addon({ settings: undefined, keybinds: undefined }));

    expect(config.settings.values()).toEqual({});
    expect(config.keybinds.ids()).toEqual([]);
  });
});

// A store refuses writes to ids its declarations do not name, while the form renders from the
// fresh manifest. A cache keyed on the fqid alone would back a new control with a stale store.
describe('an addon whose manifest changed', () => {
  const withLayout: InstalledAddon['manifest']['settings'] = [
    { id: 'window', type: 'number', label: 'Window', default: 5, min: 1, max: 60 },
    { id: 'layout', type: 'select', label: 'Layout', default: 'bars', options: ['bars', 'tiles'] },
  ];

  it('accepts a setting the update added', async () => {
    const { service } = open();
    await service.open(addon());

    const config = await service.open(addon({ settings: withLayout }));

    await expect(config.settings.set('layout', 'tiles')).resolves.toBeUndefined();
    expect(config.settings.values()).toMatchObject({ layout: 'tiles' });
  });

  it('offers a keybind the update added', async () => {
    const { service } = open();
    await service.open(addon());

    const config = await service.open(
      addon({
        keybinds: [
          { id: 'toggle', label: 'Toggle', default: 'Alt+KeyD' },
          { id: 'reset', label: 'Reset', default: 'Alt+KeyR' },
        ],
      }),
    );

    expect(config.keybinds.ids()).toEqual(['toggle', 'reset']);
  });

  // Otherwise a long-open manager keeps a storage subscription per version of every addon shown.
  it('releases the stores it replaced', async () => {
    const { hub, service } = open();
    const stale = await service.open(addon());

    await service.open(addon({ settings: withLayout }));
    hub.remote(configNamespace(FQID), SETTINGS_KEY, { window: 42 });

    expect(stale.settings.values()).toMatchObject({ window: 5 });
  });

  it('keeps the pair when nothing about the declarations moved', async () => {
    const { service } = open();

    const first = await service.open(addon());
    const second = await service.open(addon({ version: '9.9.9', description: 'reworded' }));

    expect(second).toBe(first);
  });

  // An update can land inside a hydrate; the newer load owns the cache.
  it('does not let a load overtaken mid-hydrate write itself back', async () => {
    const { service } = open();

    const stale = service.open(addon());
    const fresh = service.open(addon({ settings: withLayout }));
    await Promise.all([stale, fresh]);

    const reopened = await service.open(addon({ settings: withLayout }));
    expect(reopened).toBe(await fresh);
    await expect(reopened.settings.set('layout', 'tiles')).resolves.toBeUndefined();
  });
});

describe('repainting', () => {
  it('reports a write made through the manager', async () => {
    const { service, onChange } = open();
    const config = await service.open(addon());
    onChange.mockClear();

    await config.settings.set('window', 12);

    expect(onChange).toHaveBeenCalled();
  });

  // The panes are pure renders, so a change from another tab has to drive the
  // repaint rather than the pane polling for one.
  it("reports another tab's write", async () => {
    const { hub, service, onChange } = open();
    await service.open(addon());
    onChange.mockClear();

    hub.remote(configNamespace(FQID), SETTINGS_KEY, { window: 42 });

    expect(onChange).toHaveBeenCalled();
  });
});

describe('reaching a running addon', () => {
  // The addon's store and the manager's are two objects over one hub.
  it('moves a value into a store an addon already holds', async () => {
    const hub = createFakeStorage();
    const running = createSettingsStore({
      fqid: FQID,
      decls: addon().manifest.settings ?? [],
      hub,
    });
    await running.hydrate();
    const { service } = open({ hub });

    const config = await service.open(addon());
    await config.settings.set('window', 30);

    expect(running.values()).toMatchObject({ window: 30 });
  });
});

describe('conflicts', () => {
  // The shared class fake, so `this` is lost here exactly as it would be live.
  const game = liveGame({ held: [['KeyW', 'moveForward']] });

  it('reports the game half with its source', () => {
    const { service } = open({ game });

    expect(service.conflicts('Alt+KeyW')).toMatchObject({
      actions: ['moveForward'],
      source: 'live',
    });
  });

  it('reports live addon bindings', () => {
    const { service } = open({ game, bindings: { 'other/addon:show': 'Ctrl+KeyM' } });

    expect(service.conflicts('Ctrl+KeyM').addons).toEqual(['other/addon:show']);
  });

  it('reports a free combo as free on both halves', () => {
    const { service } = open({ game });

    expect(service.conflicts('Alt+KeyJ')).toMatchObject({ actions: [], addons: [] });
  });
});

describe('dispose', () => {
  it('releases the storage subscriptions of every cached store', async () => {
    const { hub, service } = open();
    const config = await service.open(addon());

    service.dispose();
    hub.remote(configNamespace(FQID), SETTINGS_KEY, { window: 42 });

    expect(config.settings.values()).toMatchObject({ window: 5 });
    expect(service.peek(addon())).toBeNull();
  });
});
