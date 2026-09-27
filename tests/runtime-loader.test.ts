// @vitest-environment happy-dom

// Evaluating an addon body: settings hydrate before the first line, one call drains everything it
// created, and a throw leaves nothing behind.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadAddon } from '../loader/src/runtime/loader.ts';
import type { InstalledAddon } from '../loader/src/shared/protocol.ts';
import type { AddonManifest } from '../loader/src/shared/schema.ts';
import {
  addonNamespace,
  configNamespace,
  SETTINGS_KEY,
} from '../loader/src/shared/storage-keys.ts';
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

function row(overrides: Partial<InstalledAddon> = {}): InstalledAddon {
  return {
    fqid: FQID,
    marketplace: 'official',
    manifest: MANIFEST,
    enabled: true,
    pin: null,
    ...overrides,
  };
}

const teardown: Array<() => void> = [];

afterEach(() => {
  for (const stop of teardown.splice(0)) {
    stop();
  }
  document.body.innerHTML = '';
});

function load(source: string, hub: FakeStorage = createFakeStorage(), addon = row()) {
  const harness = createSharedServices(document, hub);
  teardown.push(harness.dispose);
  return { harness, loaded: loadAddon({ shared: harness.shared, row: addon, source }) };
}

describe('evaluating the source', () => {
  it('runs the body with woc in scope', async () => {
    const { loaded } = load('woc.log("ran", woc.addon.id);');
    const addon = await loaded;
    teardown.push(addon.dispose);

    expect(addon.fqid).toBe(FQID);
  });

  it("gives the addon its own identity, not another addon's", async () => {
    const hub = createFakeStorage();
    const { loaded } = load('woc.storage.set("who", woc.addon.fqid);', hub);
    teardown.push((await loaded).dispose);

    await vi.waitFor(async () => {
      expect(await hub.get(addonNamespace(FQID), 'who')).toBe(FQID);
    });
  });

  // In sloppy mode an undeclared assignment lands on the page's global object.
  it('evaluates in strict mode', async () => {
    const { loaded } = load('undeclared = 1;');

    await expect(loaded).rejects.toThrow(/failed to load/);
  });

  // Otherwise stack traces say <anonymous>.
  it('names the addon in the compiled source', async () => {
    const { loaded } = load('woc.log(new Error("here").stack);');
    const addon = await loaded;
    teardown.push(addon.dispose);

    // A syntax error after the appended comment would fail the load above.
    expect(addon.fqid).toBe(FQID);
  });
});

describe('hydration', () => {
  it('has the stored setting in place before the first line runs', async () => {
    const hub = createFakeStorage();
    hub.remote(configNamespace(FQID), SETTINGS_KEY, { window: 42 });

    const { loaded } = load('woc.storage.set("seen", woc.settings.window);', hub);
    teardown.push((await loaded).dispose);

    await vi.waitFor(async () => {
      expect(await hub.get(addonNamespace(FQID), 'seen')).toBe(42);
    });
  });

  it('falls back to the manifest default when nothing is stored', async () => {
    const hub = createFakeStorage();
    const { loaded } = load('woc.storage.set("seen", woc.settings.window);', hub);
    teardown.push((await loaded).dispose);

    await vi.waitFor(async () => {
      expect(await hub.get(addonNamespace(FQID), 'seen')).toBe(5);
    });
  });
});

describe('disposal', () => {
  it('takes the addon window away', async () => {
    const { loaded } = load('woc.ui.window({ id: "meter", title: "DPS" });');
    const addon = await loaded;
    expect(document.querySelectorAll('.woc-frame, .woc-window').length).toBeGreaterThan(0);

    addon.dispose();

    expect(document.querySelectorAll('.woc-frame, .woc-window')).toHaveLength(0);
  });

  it('stops a bare interval the addon set through the api', async () => {
    const ticks = { count: 0 };
    (globalThis as unknown as { __ticks: typeof ticks }).__ticks = ticks;
    const { loaded } = load('woc.setInterval(() => { __ticks.count += 1; }, 1);');
    const addon = await loaded;

    addon.dispose();
    const after = ticks.count;
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    expect(ticks.count).toBe(after);
  });

  it('is idempotent', async () => {
    const addon = await load('woc.log("hi");').loaded;

    addon.dispose();

    expect(() => {
      addon.dispose();
    }).not.toThrow();
  });
});

describe('an addon that throws', () => {
  it('rejects with the addon named and the original attached', async () => {
    const { loaded } = load('throw new Error("boom");');

    await expect(loaded).rejects.toThrow(`${FQID} failed to load: boom`);
    await expect(loaded).rejects.toHaveProperty('cause');
  });

  it('rejects on a syntax error without running a partial file', async () => {
    const { loaded } = load('this is not javascript');

    await expect(loaded).rejects.toThrow(/failed to load/);
  });

  // A failed addon was never enabled, so leftovers could never be disabled.
  it('drains what the half that ran had already created', async () => {
    const { loaded } = load(
      'woc.ui.window({ id: "meter" }); woc.keys.bind("toggle", () => {}); throw new Error("late");',
    );

    await expect(loaded).rejects.toThrow(/failed to load/);
    expect(document.querySelectorAll('.woc-frame, .woc-window')).toHaveLength(0);
  });

  it('releases the keybind too', async () => {
    const { harness, loaded } = load('woc.keys.bind("toggle", () => {}); throw new Error("late");');

    await expect(loaded).rejects.toThrow(/failed to load/);
    expect(Object.keys(harness.shared.dispatcher.bindings())).toEqual([]);
  });
});

// A guardrail, not a boundary.
describe('shadowed globals', () => {
  it.each([
    ['localStorage', 'localStorage.getItem("anything");'],
    ['sessionStorage', 'sessionStorage.getItem("anything");'],
    ['indexedDB', 'indexedDB.databases();'],
    ['XMLHttpRequest', 'new XMLHttpRequest();'],
    ['WebSocket', 'new WebSocket("wss://example.invalid");'],
    ['__game', '__game.player;'],
  ])('fails the load when an addon reaches for %s', async (_name, source) => {
    await expect(load(source).loaded).rejects.toThrow(/is shadowed inside an addon/);
  });

  it('names the sanctioned API in the failure', async () => {
    await expect(load('localStorage.getItem("x");').loaded).rejects.toThrow(/use woc.storage/);
  });

  // The closure runs in the page realm, so one line reaches around it.
  it('does not stop a deliberate escape', async () => {
    const { loaded } = load('woc.log(typeof Function("return this")().localStorage);');

    await expect(loaded).resolves.toBeDefined();
  });
});
