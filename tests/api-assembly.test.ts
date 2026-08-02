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
  return { bag, hub, api, frames: harness.frames };
}

describe('what an addon is handed', () => {
  it('has every documented domain', () => {
    const { api } = open();

    for (const domain of ['net', 'world', 'ui', 'sound', 'keys', 'storage'] as const) {
      expect(api.woc[domain]).toBeTypeOf('object');
    }
    // A surface added to bind.ts but not to the Pick would be absent here and
    // present in the published types, which is the drift nothing else catches.
    expect(api.woc.data).toBeTypeOf('function');
  });

  it('has the documented top-level members', () => {
    const { api } = open();

    for (const member of [
      'log',
      'warn',
      'error',
      'now',
      'wallClock',
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

  // Two clocks, and the obvious slip is binding the monotonic one to both. The
  // fake supplies distinct readings so this is a value comparison rather than a
  // shape check.
  it('answers the wall clock separately from the monotonic one', () => {
    const { api } = open();

    expect(api.woc.wallClock()).toBe(1_700_000_000_000);
    expect(api.woc.wallClock()).not.toBe(api.woc.now());
  });
});

describe('woc.data', () => {
  const WithData: AddonManifest = { ...MANIFEST, data: ['items.json'] };

  it('parses what the host cached for this addon', async () => {
    const harness = createSharedServices(document, createFakeStorage());
    teardown.push(harness.dispose);
    harness.addonData(FQID, 'items.json', '{"sword":"Sword"}');
    const api = createAddonApi(harness.shared, {
      manifest: WithData,
      fqid: FQID,
      marketplace: 'official',
      bag: new DisposalBag(),
    });

    await expect(api.woc.data('items.json')).resolves.toEqual({ sword: 'Sword' });
  });

  // The membership check is against THIS addon's manifest, so an addon that
  // declared nothing cannot read a file another addon shipped.
  it('refuses a name this addon did not declare', async () => {
    const { api } = open();

    await expect(api.woc.data('items.json')).rejects.toThrow(/is not declared/);
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

// `woc.onFrame`, the shared animation tick.
//
// What is worth pinning here is the BAG, not the loop (tests/frame-loop.test.ts
// owns that): disable is hot with no page reload, so a handler the addon never
// unsubscribed has to stop when its addon does, and an explicit unsubscribe has to
// drop the bag's hold as well, which is the half that is easy to lose when a
// member is added by copying its neighbour.
describe('onFrame', () => {
  it('runs on the loader own loop', () => {
    const { api, frames } = open();
    const handler = vi.fn();

    api.woc.onFrame(handler);
    frames.tick();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]?.[0]).toBeTypeOf('number');
  });

  it('stops when the addon is disposed', () => {
    const { api, bag, frames } = open();
    const handler = vi.fn();
    api.woc.onFrame(handler);

    bag.dispose();
    frames.tick();

    expect(handler).not.toHaveBeenCalled();
  });

  it('lets an explicit unsubscribe drop its bag entry too', () => {
    const { api, bag } = open();

    const before = bag.size;
    const off = api.woc.onFrame(() => undefined);
    const subscribed = bag.size;
    off();

    expect(subscribed).toBeGreaterThan(before);
    expect(bag.size).toBe(before);
  });

  // A handler that throws once throws every frame, so reporting each one would
  // write sixty lines a second into the log the manager tails. The subscription is
  // KEPT: the cost of a mistake is a warning, not a surface that stops working.
  it('reports a throwing handler once and keeps calling it', () => {
    const { api, frames } = open();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const handler = vi.fn(() => {
      throw new Error('addon bug');
    });

    api.woc.onFrame(handler);
    frames.tick();
    frames.tick();
    frames.tick();

    expect(handler).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});
