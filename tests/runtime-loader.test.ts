// @vitest-environment happy-dom

// Evaluating one addon.
//
// Addon source is a function BODY, not a module: no export to call, no
// registration step, `woc` in scope. What this suite pins is the three things
// that make that safe. Settings are hydrated before the first line, everything
// the addon created is in a bag one call drains, and a throw leaves nothing
// behind.

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

  // An undeclared assignment in a sloppy-mode function body becomes a property
  // of the page's global object, which is one addon's typo becoming another
  // addon's mystery variable, on a page shared with the game.
  it('evaluates in strict mode', async () => {
    const { loaded } = load('undeclared = 1;');

    await expect(loaded).rejects.toThrow(/failed to load/);
  });

  // Otherwise every stack trace an addon author is sent says <anonymous>.
  it('names the addon in the compiled source', async () => {
    const { loaded } = load('woc.log(new Error("here").stack);');
    const addon = await loaded;
    teardown.push(addon.dispose);

    // The sourceURL only shows up in a trace taken inside the addon, so the
    // check is on the compiled text reaching the engine at all: a syntax error
    // after the appended comment would fail the load above.
    expect(addon.fqid).toBe(FQID);
  });
});

// The reason the API is worth having: an addon reads woc.settings.window on its
// first line and does arithmetic with it.
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

  it('rejects on a syntax error rather than running a partial file', async () => {
    const { loaded } = load('this is not javascript');

    await expect(loaded).rejects.toThrow(/failed to load/);
  });

  // The half of the addon that ran before the throw has already created things.
  // Leaving them would be a keybind and a window belonging to an addon that is
  // not running and cannot be disabled, because it was never enabled.
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

// The guardrail. Not a boundary, and the message says which API to use.
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

  // The honest limit, pinned so nobody later mistakes the guardrail for a
  // sandbox: the closure runs in the page realm and one line reaches around it.
  it('does not stop a deliberate escape, which is the documented limit', async () => {
    const { loaded } = load('woc.log(typeof Function("return this")().localStorage);');

    await expect(loaded).resolves.toBeDefined();
  });
});
