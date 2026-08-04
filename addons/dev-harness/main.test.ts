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
import { WORLD_KEYS } from '../../loader/src/runtime/world/signature.ts';
import { validateManifest } from '../../loader/src/shared/schema.ts';
import { mountAddon, parseManifest } from '../../tests/fakes/addon.ts';
import { eventsFrame } from '../../tests/fakes/frames.ts';
// The addon's own two files, read the way the loader reads text it ships: the
// raw suffix rather than node:fs, so this suite needs no filesystem types and
// runs under happy-dom, whose URL rejects the file scheme.
//
// The manifest arrives as TEXT and is parsed here rather than imported as JSON.
// It is untrusted input everywhere else in the loader, and validateManifest is
// what this suite checks; a typed JSON import would hand it a shape the compiler
// had already vouched for.
import MANIFEST_TEXT from './addon.json?raw';
// The sibling file the manifest declares. Read as text for the same reason the
// manifest is: this is what the host caches at install and hands back, and a typed
// JSON import would be a shape the compiler had already vouched for.
import DATA_TEXT from './data.json?raw';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all. Same reason as the runtime bundle import in host/boot.ts.
import SOURCE from './main.js?raw';

/** The dev server's source, which is where this addon is actually installed from. */
const MARKETPLACE = 'local';
const FQID = `${MARKETPLACE}/dev-harness`;

const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);

const teardown: Array<() => void> = [];

afterEach(() => {
  for (const stop of teardown.splice(0)) {
    stop();
  }
  document.body.innerHTML = '';
});

function manifest() {
  return parseManifest(MANIFEST_TEXT);
}

/**
 * The harness runs with NO game, which is the state it is most often started in:
 * an addon's first line executes at document-start, on the landing page.
 */
async function run() {
  const harness = await mountAddon({
    manifest: MANIFEST_TEXT,
    source: SOURCE,
    marketplace: MARKETPLACE,
  });
  teardown.push(harness.dispose);
  return { addon: harness.addon, harness, hub: harness.hub };
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

  // The declaration is what makes `woc.data` answerable at all: the host fetches
  // exactly this list at install, and the surface checks its argument against it
  // rather than joining anything onto a URL.
  it('declares the data file it ships', () => {
    expect(manifest().data).toEqual(['data.json']);
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

/** Press one of the manual demonstration buttons by its label. */
function press(label: string): void {
  [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent === label)
    ?.click();
}

// The demonstrations are manual by definition: a suite cannot see whether a
// nameplate sits over the right shoulder. What it CAN hold them to is that a
// button pressed with no game behind it creates nothing, since every one of these
// runs on the login screen as readily as in the world.
describe('the anchor demonstration', () => {
  it('creates nothing when there is no world to anchor to', async () => {
    await run();

    press('Anchors');

    expect(document.querySelector('.woc-anchor3d')).toBeNull();
  });

  it('says why rather than doing nothing visible', async () => {
    await run();

    press('Anchors');

    expect(document.querySelector('.woc-toast')?.textContent).toContain('No world yet');
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

    expect(await report()).toContain('36 of 36 checks passed');
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
    'character storage',
    'data',
    'sound',
    'keys',
    'world keys',
    'casts',
    'icons',
    'tile',
    'fields',
    'anchor',
    'project',
    'skill art',
    'shadowed globals',
    'timers',
    'clocks',
    'frames',
    'aura polarity',
    'combat records',
    'character key',
    'content',
    'counters',
  ])('passes the %s check', async (name) => {
    await run();

    expect(await report()).not.toContain(`FAIL  ${name}`);
  });
});

// The one check here whose subject is the GAME rather than the loader.
//
// `damage` and `heal2` pass through the loader untouched, so there is nothing in a
// unit suite that could be wrong about them: a fixture only ever agrees with what it
// was written to say, and the published claims about these records are true of the
// wire or they are not. That is why the harness watches them in a live session, and
// it is also why this suite can only check ONE thing about that watch, which is that
// it has teeth. Each case below puts a record on the socket that contradicts
// `packages/types/events-combat.d.ts` and requires the harness to name it.
describe('watching the combat records', () => {
  /** Land some records, then press the button that re-runs everything. */
  async function afterRecords(list: readonly unknown[]): Promise<void> {
    const { harness } = await run();
    await report();
    harness.inbound(eventsFrame(list));
    press('Run again');
  }

  function damage(over: Record<string, unknown>): Record<string, unknown> {
    return {
      type: 'damage',
      sourceId: 1,
      targetId: 2,
      amount: 100,
      ability: 'Aimed Shot',
      abilityId: null,
      kind: 'hit',
      crit: false,
      school: 'physical',
      ...over,
    };
  }

  // Nothing is wrong with these, so the check has to stay green AND start counting.
  // A watch that only ever reports failures would look identical to one wired to
  // nothing at all, for as long as the game kept behaving.
  it('counts ordinary records rather than only reporting faults', async () => {
    await afterRecords([damage({}), { type: 'heal2', sourceId: 1, targetId: 1, amount: 50 }]);

    await expect
      .poll(() => document.body.textContent ?? '')
      .toContain('1 damage and 1 heal records match the types');
  });

  // The exact defect this was written after: a kind the types do not list reaches an
  // addon as an ordinary string, and a display that groups by kind is silently wrong
  // rather than loudly. `evade` was one for two releases.
  it('names a damage kind the published union does not carry', async () => {
    await afterRecords([damage({ kind: 'absorbed_entirely' })]);

    await expect
      .poll(() => document.body.textContent ?? '')
      .toContain('FAIL  combat recordsthe wire sent kind "absorbed_entirely"');
  });

  it('names an evade that carried damage, since an evade lands at zero', async () => {
    await afterRecords([damage({ kind: 'evade', amount: 40 })]);

    await expect
      .poll(() => document.body.textContent ?? '')
      .toContain('an evade carried 40 damage');
  });

  // Absent rather than 0 is the whole of what tells a heal a shield devoured from a
  // heal that overhealed: both land at `amount: 0` and nothing else parts them.
  it('names a heal whose absorbed arrived as a zero instead of being absent', async () => {
    await afterRecords([{ type: 'heal2', sourceId: 1, targetId: 1, amount: 0, absorbed: 0 }]);

    await expect.poll(() => document.body.textContent ?? '').toContain('a heal carried absorbed 0');
  });

  // An addon builds an icon URL out of this field, so a non-string in it is a
  // request that cannot succeed rather than a missing picture.
  it('names an abilityId that arrived as something other than a string', async () => {
    await afterRecords([damage({ abilityId: 7 })]);

    await expect
      .poll(() => document.body.textContent ?? '')
      .toContain('abilityId arrived as number');
  });
});

// A declared data file is fetched by the HOST at install and answered out of that
// cache, and there is no marketplace behind this document, so the harness reports
// the read as unavailable rather than failing it. What CAN be checked with no host
// is the refusal, which is page-realm and is the security-shaped half; seeding the
// host's copy and running again covers the rest of the path, which is the manifest
// declaration, the bridge read, the parse, and the memo behind a second read.
describe('the data file it ships', () => {
  it('refuses a name the manifest does not declare', async () => {
    await run();

    expect(await report()).toContain('undeclared names refused');
  });

  it('reads back what is on disk once the host has a copy', async () => {
    const { harness } = await run();
    await report();

    harness.addonData(FQID, 'data.json', DATA_TEXT);
    press('Run again');

    await expect
      .poll(() => document.body.textContent ?? '')
      .toContain('data.json: 3 rows, parsed once');
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
