// @vitest-environment happy-dom

// The `woc` object an addon is handed.
//
// Assembly, so what is asserted is the wiring rather than any one surface: every
// domain is present, identity and game facts are readable, settings are hydrated
// BEFORE the addon's first line, and one disposal releases everything at once.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAddonApi } from '../loader/src/runtime/api/index.ts';
import { DisposalBag } from '../loader/src/runtime/disposal.ts';
import { API_VERSION } from '../loader/src/shared/api-version.ts';
import type { AddonManifest } from '../loader/src/shared/schema.ts';
import { configNamespace, SETTINGS_KEY } from '../loader/src/shared/storage-keys.ts';
import { createSharedServices } from './fakes/shared-services.ts';
import { createFakeStorage, type FakeStorage } from './fakes/storage.ts';

const FQID = 'official/combat-meter';

const MANIFEST: AddonManifest = {
  id: 'combat-meter',
  name: 'Combat Meter',
  version: '1.2.0',
  apiVersion: 1,
  author: 'MarshalX',
  description: 'Rolling damage per second.',
  entry: 'main.js',
  settings: [{ id: 'window', type: 'number', label: 'Window', default: 5, min: 1, max: 60 }],
  keybinds: [{ id: 'toggle', label: 'Toggle', default: 'Alt+KeyD' }],
};

const teardown: Array<() => void> = [];

afterEach(() => {
  for (const stop of teardown.splice(0)) {
    stop();
  }
  document.body.innerHTML = '';
});

function open(hub: FakeStorage = createFakeStorage(), manifest = MANIFEST) {
  const bag = new DisposalBag();
  const harness = createSharedServices(document, hub);
  teardown.push(harness.dispose);
  const api = createAddonApi(harness.shared, {
    manifest,
    fqid: FQID,
    marketplace: 'official',
    bag,
  });
  return { bag, hub, api };
}

describe('what an addon is handed', () => {
  it('has every documented domain', () => {
    const { api } = open();

    for (const domain of ['net', 'world', 'ui', 'sound', 'keys', 'storage'] as const) {
      expect(api.woc[domain]).toBeTypeOf('object');
    }
  });

  it('has the documented top-level members', () => {
    const { api } = open();

    for (const member of [
      'log',
      'warn',
      'error',
      'now',
      'setTimeout',
      'setInterval',
      'requestAnimationFrame',
      'onDispose',
      'onSettingsChange',
    ] as const) {
      expect(api.woc[member]).toBeTypeOf('function');
    }
  });

  it('reports its own identity, frozen so an addon cannot restyle it', () => {
    const { api } = open();

    expect(api.woc.addon).toEqual({
      id: 'combat-meter',
      fqid: FQID,
      name: 'Combat Meter',
      version: '1.2.0',
      marketplace: 'official',
    });
    expect(Object.isFrozen(api.woc.addon)).toBe(true);
  });

  it('reports the loader API version it implements', () => {
    expect(open().api.woc.api).toBe(API_VERSION);
  });

  it('reports where it is running', () => {
    expect(open().api.woc.game).toEqual({
      host: 'https://pbe.worldofclaudecraft.com',
      channel: 'pbe',
      version: '0.31.0',
      build: '202607290011',
    });
  });

  it('answers a monotonic clock rather than the wall clock', () => {
    expect(open().api.woc.now()).toBe(1234);
  });
});

describe('settings', () => {
  // The whole reason settings are a store rather than reads through
  // woc.storage: an addon does arithmetic with woc.settings.window on its first
  // line, so the value has to be there before its code runs.
  it('are hydrated before the addon would run', async () => {
    const hub = createFakeStorage();
    await hub.set(configNamespace(FQID), SETTINGS_KEY, { window: 30 });
    const { api } = open(hub);

    expect(api.woc.settings).toMatchObject({ window: 5 });
    await api.hydrate();

    expect(api.woc.settings).toMatchObject({ window: 30 });
  });

  it('are readable synchronously and stay live', async () => {
    const { api } = open();
    await api.hydrate();

    await api.settings.set('window', 12);

    expect(api.woc.settings).toMatchObject({ window: 12 });
  });

  it('notify an addon that subscribed', async () => {
    const { api } = open();
    const seen = vi.fn();
    api.woc.onSettingsChange(seen);

    await api.settings.set('window', 12);

    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ window: 12 }));
  });

  it('hydrates an addon that declares nothing at all', async () => {
    const { settings: _settings, keybinds: _keybinds, ...bare } = MANIFEST;
    const { api } = open(createFakeStorage(), bare);

    await expect(api.hydrate()).resolves.toBeUndefined();
    expect(api.woc.settings).toEqual({});
  });
});

describe('the world before world entry', () => {
  // The facade is built at boot, so every read answers null rather than
  // throwing at an addon holding woc.world from its first line.
  it('answers null rather than throwing', () => {
    const { api } = open();

    expect(api.woc.world.player).toBeNull();
    expect(api.woc.world.entities.size).toBe(0);
  });
});

describe('disposal', () => {
  it('releases every surface at once', () => {
    const { bag, api } = open();
    api.woc.ui.frame({ id: 'meter' });
    api.woc.keys.bind('toggle', vi.fn());
    api.woc.setInterval(vi.fn(), 100);
    const onDispose = vi.fn();
    api.woc.onDispose(onDispose);

    bag.dispose();

    expect(document.querySelectorAll('.woc-addon-frame')).toHaveLength(0);
    expect(onDispose).toHaveBeenCalledOnce();
    expect(bag.isDisposed).toBe(true);
  });

  it('stops settings changes reaching a disabled addon', () => {
    const { bag, api, hub } = open();
    const seen = vi.fn();
    api.woc.onSettingsChange(seen);

    bag.dispose();
    hub.remote(configNamespace(FQID), SETTINGS_KEY, { window: 42 });

    expect(seen).not.toHaveBeenCalled();
  });
});

describe('logging', () => {
  it("writes into the addon's own tail with a wall-clock stamp", () => {
    const hub = createFakeStorage();
    const harness = createSharedServices(document, hub);
    teardown.push(harness.dispose);
    const services = harness.shared;
    const bag = new DisposalBag();
    const api = createAddonApi(services, {
      manifest: MANIFEST,
      fqid: FQID,
      marketplace: 'official',
      bag,
    });

    api.woc.warn('could not read the roster');

    expect(services.logs.tail(FQID)).toEqual([
      { seq: 1, level: 'warn', at: 1_700_000_000_000, text: 'could not read the roster' },
    ]);
  });
});
