// The manager's per-addon config service.
//
// The design claim it exists to prove: the manager writes to the SAME stores a
// running addon reads, over the same storage hub, so editing an addon that is
// enabled and one that is disabled are one code path. Nothing here knows
// whether the addon is running, and that is the point.

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

// What the cache must NOT do, reported from a live session.
//
// A store is a function of its declarations: it hydrates from them and refuses a
// write to anything they do not name. The form beside it renders from the row's
// manifest read fresh. So a cache keyed on the fqid alone put a new control on
// screen backed by a store that had never heard of it, and choosing a value
// answered "no setting declared with id 'layout'". Reinstalling did not clear it,
// because what was stale was the map rather than storage.
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

  // The rebuild has to release the old pair, or a manager left open across a few
  // updates keeps a storage subscription per version of every addon it has shown.
  it('releases the stores it replaced', async () => {
    const { hub, service } = open();
    const stale = await service.open(addon());

    await service.open(addon({ settings: withLayout }));
    hub.remote(configNamespace(FQID), SETTINGS_KEY, { window: 42 });

    expect(stale.settings.values()).toMatchObject({ window: 5 });
  });

  // The cache still has to be a cache: a row that did not change must not pay for
  // a round trip, which is what made this worth keeping rather than dropping.
  it('keeps the pair when nothing about the declarations moved', async () => {
    const { service } = open();

    const first = await service.open(addon());
    const second = await service.open(addon({ version: '9.9.9', description: 'reworded' }));

    expect(second).toBe(first);
  });

  // Hydration is a bridge round trip, so an update can land inside one. The load
  // that started for the new row owns the cache: the older one resolving late must
  // not put its declarations back.
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
  // The whole design in one assertion: a store the addon built and a store the
  // manager built are two objects over one hub, and a write to either reaches
  // the other.
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
