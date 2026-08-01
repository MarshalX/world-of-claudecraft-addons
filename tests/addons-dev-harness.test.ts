// @vitest-environment happy-dom

// The Dev Harness addon, run through the real loader.
//
// This is the one test that goes end to end over the path an addon actually
// takes: the file on disk, its manifest validated by the schema CI uses, and the
// body evaluated by runtime/loader.ts with the published `woc` object in scope.
// It catches the class of failure a unit suite cannot: a surface that was never
// wired to the object an addon is handed, and an addon written against an API
// that has since moved.
//
// It does NOT replace running the harness in the game. Half its checks read the
// live game and report honestly here that there is none.

import { afterEach, describe, expect, it } from 'vitest';
// The addon's own two files, read the way the loader reads text it ships: the
// raw suffix rather than node:fs, so this suite needs no filesystem types and
// runs under happy-dom, whose URL rejects the file scheme.
//
// The manifest arrives as TEXT and is parsed here rather than imported as JSON.
// It is untrusted input everywhere else in the loader, and validateManifest is
// what this suite checks; a typed JSON import would hand it a shape the compiler
// had already vouched for.
import MANIFEST_TEXT from '../addons/dev-harness/addon.json?raw';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all. Same reason as the runtime bundle import in host/boot.ts.
import SOURCE from '../addons/dev-harness/main.js?raw';
import { loadAddon } from '../loader/src/runtime/loader.ts';
import { WORLD_KEYS } from '../loader/src/runtime/world/signature.ts';
import type { InstalledAddon } from '../loader/src/shared/protocol.ts';
import { validateManifest } from '../loader/src/shared/schema.ts';
import { createSharedServices } from './fakes/shared-services.ts';
import { createFakeStorage } from './fakes/storage.ts';

const FQID = 'local/dev-harness';

const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);

const teardown: Array<() => void> = [];

afterEach(() => {
  for (const stop of teardown.splice(0)) {
    stop();
  }
  document.body.innerHTML = '';
});

function manifest() {
  const parsed = validateManifest(MANIFEST_JSON);
  if (!parsed.ok) {
    throw new Error(`the harness manifest is invalid: ${JSON.stringify(parsed.issues)}`);
  }
  return parsed.value;
}

function row(): InstalledAddon {
  return { fqid: FQID, marketplace: 'local', manifest: manifest(), enabled: true, pin: null };
}

async function run() {
  const hub = createFakeStorage();
  const harness = createSharedServices(document, hub);
  teardown.push(harness.dispose);
  const addon = await loadAddon({ shared: harness.shared, row: row(), source: SOURCE });
  teardown.push(addon.dispose);
  return { addon, harness, hub };
}

describe('its manifest', () => {
  it('validates against the shared schema', () => {
    expect(validateManifest(MANIFEST_JSON).ok).toBe(true);
  });

  // The harness exists to exercise the settings form, so it has to declare one
  // of each type the form can render.
  it('declares one setting of every type', () => {
    const types = (manifest().settings ?? []).map((setting) => setting.type).sort();

    expect(types).toEqual(['boolean', 'number', 'select', 'string']);
  });

  it('declares the keybinds it binds', () => {
    const ids = (manifest().keybinds ?? []).map((bind) => bind.id).sort();

    expect(ids).toEqual(['run', 'toggle']);
  });
});

describe('loading it', () => {
  it('evaluates without throwing', async () => {
    const { addon } = await run();

    expect(addon.fqid).toBe(FQID);
  });

  // The window, the rail button, and the menu entry are all created on the
  // addon's first pass, so a missing one means a surface it thought it had.
  it('puts its window up', async () => {
    await run();

    expect(document.querySelectorAll('.woc-window, .woc-frame').length).toBeGreaterThan(0);
  });

  it('registers both of its declared keybinds', async () => {
    const { harness } = await run();

    expect(Object.keys(harness.shared.dispatcher.bindings()).sort()).toEqual([
      `${FQID}:run`,
      `${FQID}:toggle`,
    ]);
  });

  it('logs nothing at error level while loading', async () => {
    const { harness } = await run();

    const errors = harness.shared.logs.tail(FQID).filter((entry) => entry.level === 'error');
    expect(errors).toEqual([]);
  });
});

describe('disabling it', () => {
  it('leaves no DOM, no keybind, and no timer behind', async () => {
    const { addon, harness } = await run();

    addon.dispose();

    expect(document.querySelectorAll('.woc-window, .woc-frame')).toHaveLength(0);
    expect(Object.keys(harness.shared.dispatcher.bindings())).toEqual([]);
  });

  // It registers an onDispose hook, which is the surface an addon uses for
  // anything the API did not create.
  it('runs its own teardown hook', async () => {
    const { addon, harness } = await run();

    addon.dispose();

    const text = harness.shared.logs.tail(FQID).map((entry) => entry.text);
    expect(text.some((line) => line.includes('disposed after'))).toBe(true);
  });
});

/** The report text, once the harness has finished its run. */
async function report(): Promise<string> {
  await expect.poll(() => document.body.textContent ?? '').toMatch(/checks passed/);
  return document.body.textContent ?? '';
}

// Every check has to pass here. There is no game in this environment and the
// harness knows it: each check that reads the game reports the no-game case as a
// pass with a note rather than as a failure, so anything red here is the
// loader's fault rather than the environment's.
//
// The `world.entities accepted a write` failure this suite produced when it was
// first written was exactly that, and it was real: before world entry the roster
// was a bare Map, shared by every addon. See tests/world-api.test.ts.
describe('what it reports without a game', () => {
  it('passes every check', async () => {
    await run();

    expect(await report()).toContain('23 of 23 checks passed');
  });

  it('names no check as failed', async () => {
    await run();

    expect(await report()).not.toContain('FAIL');
  });

  // Named individually as well as counted, so a rename or a dropped check shows
  // up as a failure here rather than as a total that quietly went down by one.
  it.each([
    'identity',
    'settings',
    'storage',
    'sound',
    'keys',
    'world keys',
    'casts',
    'icons',
    'tile',
    'skill art',
    'shadowed globals',
    'timers',
  ])('passes the %s check', async (name) => {
    await run();

    expect(await report()).not.toContain(`FAIL  ${name}`);
  });
});

// The harness carries its OWN copy of the world key list, and that is deliberate: it
// stands in for the published types rather than reading the loader's array, so a key
// that reached one and not the other throws from `world.on` in a live session instead
// of passing everywhere. The copy still has to be kept up to date, which is what this
// pins: a key added to the loader and not to the harness is not checked at all, and
// nothing else would ever say so.
describe('the key list it carries', () => {
  /** Any total order will do: the sort exists only to make the comparison stable. */
  const byName = (a: string, b: string): number => a.localeCompare(b);

  /** The array literal out of the addon source, which is the only place it exists. */
  function harnessKeys(): string[] {
    const block = /const WORLD_KEYS = \[([^\]]*)\]/.exec(SOURCE);
    if (block === null) {
      throw new Error('the harness no longer declares a WORLD_KEYS array');
    }
    return [...(block[1] as string).matchAll(/'([^']+)'/g)].map((match) => match[1] as string);
  }

  it('covers every key the loader publishes', () => {
    expect([...harnessKeys()].sort(byName)).toEqual([...WORLD_KEYS].sort(byName));
  });
});
