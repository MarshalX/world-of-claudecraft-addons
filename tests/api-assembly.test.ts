// @vitest-environment happy-dom

// The `woc` object an addon is handed.
//
// Assembly, so what is asserted is the wiring rather than any one surface: every
// domain is present, identity and game facts are readable, settings are hydrated
// BEFORE the addon's first line, and one disposal releases everything at once.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAddonApi, type SharedServices } from '../loader/src/runtime/api/index.ts';
import { DisposalBag } from '../loader/src/runtime/disposal.ts';
import { createKeyDispatcher } from '../loader/src/runtime/keys/dispatcher.ts';
import { createGameBindings } from '../loader/src/runtime/keys/game-bindings.ts';
import { createLogBuffer } from '../loader/src/runtime/log/buffer.ts';
import { createNetHub } from '../loader/src/runtime/net/hub.ts';
import { createSoundEngine } from '../loader/src/runtime/sound/engine.ts';
import { createGameInjector } from '../loader/src/runtime/ui/kit/injections.ts';
import { createToaster } from '../loader/src/runtime/ui/kit/toast.ts';
import { createTooltips } from '../loader/src/runtime/ui/kit/tooltip.ts';
import { createWorldHub } from '../loader/src/runtime/world/hub.ts';
import { type AddonManifest, API_VERSION } from '../loader/src/shared/schema.ts';
import { configNamespace, SETTINGS_KEY } from '../loader/src/shared/storage-keys.ts';
import { createFakeStorage, type FakeStorage } from './fakes/storage.ts';

const FQID = 'official/dps-meter';

const MANIFEST: AddonManifest = {
  id: 'dps-meter',
  name: 'DPS Meter',
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

function shared(hub: FakeStorage): SharedServices {
  const root = document.createElement('div');
  root.id = 'woc-addons';
  document.body.appendChild(root);

  const injector = createGameInjector({ doc: document });
  teardown.push(injector.dispose);

  return {
    doc: document,
    window: globalThis as unknown as SharedServices['window'],
    net: createNetHub({ now: () => 0, install: () => () => undefined }),
    world: createWorldHub({
      // Never resolves: the addon must be usable before world entry.
      game: new Promise(() => undefined),
      schedule: () => 0,
      cancel: () => undefined,
    }),
    storage: hub,
    sound: createSoundEngine({
      sink: {
        running: () => true,
        resume: async () => undefined,
        decode: async () => ({}),
        start: () => undefined,
        close: () => undefined,
      },
      fetchJson: () => Promise.resolve({ format: 'woc-sfx-runtime-pack', version: 1, clips: {} }),
      fetchBytes: async () => new ArrayBuffer(8),
      volume: () => 1,
      now: () => 0,
      pick: () => 0,
    }),
    dispatcher: createKeyDispatcher({ target: new EventTarget(), doc: document }),
    gameBindings: createGameBindings({ game: () => null, storage: () => null }),
    logs: createLogBuffer(),
    kit: {
      root,
      injector,
      toaster: createToaster({
        doc: document,
        root,
        setTimer: () => 0,
        clearTimer: () => undefined,
      }),
      tooltips: createTooltips({ doc: document, root, viewport: () => ({ w: 800, h: 600 }) }),
    },
    channel: 'pbe',
    host: 'https://pbe.worldofclaudecraft.com',
    gameVersion: () => ({ version: '0.31.0', build: '202607290011' }),
    character: () => 'Claudemoon/Marshal',
    now: () => 1234,
    wallClock: () => 1_700_000_000_000,
    viewport: () => ({ w: 800, h: 600 }),
    pick: () => 0,
  };
}

function open(hub: FakeStorage = createFakeStorage(), manifest = MANIFEST) {
  const bag = new DisposalBag();
  const api = createAddonApi(shared(hub), {
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
      id: 'dps-meter',
      fqid: FQID,
      name: 'DPS Meter',
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
    const services = shared(hub);
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
