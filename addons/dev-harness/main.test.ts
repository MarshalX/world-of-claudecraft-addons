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
import { type AddonHarness, mountAddon, parseManifest } from '../../tests/fakes/addon.ts';
import { liveEntity } from '../../tests/fakes/entity.ts';
import { eventsFrame } from '../../tests/fakes/frames.ts';
// The addon's own two files, read the way the loader reads text it ships: the raw suffix
// rather than node:fs, so this suite needs no filesystem types and runs under happy-dom, whose
// URL rejects the file scheme.
//
// The manifest arrives as text and is parsed here rather than imported as JSON. It is
// untrusted input everywhere else in the loader, and `validateManifest` is what this suite
// checks; a typed JSON import would hand it a shape the compiler had already vouched for.
import MANIFEST_TEXT from './addon.json?raw';
// The sibling file the manifest declares, read as text for the same reason: this is what the
// host caches at install and hands back.
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
 * The report text, once the harness has finished its run.
 *
 * Ticking while it settles is what a browser does continuously, and it is what makes the
 * paint check do its real work rather than time out: `woc.paint` rides the LOADER'S loop
 * rather than `requestAnimationFrame`, and that loop is hand-driven here, so with nothing
 * ticking it the check waits out its own deadline and then honestly reports that no frame
 * ran. Every case below would pay that wait, for an answer that asserts nothing.
 */
async function reportFrom(harness: AddonHarness): Promise<string> {
  await expect
    .poll(() => {
      harness.frames.tick();
      return document.body.textContent ?? '';
    })
    .toMatch(/checks passed/);
  return document.body.textContent ?? '';
}

/**
 * The aura art manifest, shaped as the game serves it.
 *
 * The one art manifest this suite answers, and the others are left as the harness has
 * them, never settling. That asymmetry is the checks themselves: `checkIcons` accepts
 * either the optimistic URL or the withheld null for an ability and an item, and
 * `checkSkillArt` returns before it awaits anything when there is no player. The aura
 * check has neither out, because `icon.aura` answers null until its manifest lands and
 * the family does not depend on a class, so an unanswered read is a check that never
 * resolves and a report that never completes.
 */
const AURA_MANIFEST = {
  schemaVersion: 1,
  family: 'auras',
  assets: [{ auraId: 'resurrection_sickness', output: 'resurrection_sickness.webp' }],
};

/**
 * The skill manifest for the world case's hunter. With a player, `checkSkillArt` awaits this
 * read, and an unanswered one leaves the report never completing.
 */
const SKILL_MANIFEST = {
  schemaVersion: 1,
  class: 'hunter',
  assets: [{ abilityId: 'aimed_shot', sourceFile: 'aimed_shot.png', output: 'aimed_shot.webp' }],
};

/** Answers the aura manifest and leaves every other art read as the harness has it. */
function readArtManifest(url: string): Promise<unknown> {
  if (url === '/ui/auras/mapping.json') {
    return Promise.resolve(AURA_MANIFEST);
  }
  if (url === '/ui/skills/hunter/mapping.json') {
    return Promise.resolve(SKILL_MANIFEST);
  }
  return new Promise<unknown>(() => undefined);
}

/**
 * The harness runs with NO game, which is the state it is most often started in:
 * an addon's first line executes at document-start, on the landing page.
 *
 * `report` is handed back bound to this harness rather than living on its own, so there is
 * no way to await the report without the loop that settles it.
 */
async function run() {
  const harness = await mountAddon({
    manifest: MANIFEST_TEXT,
    source: SOURCE,
    marketplace: MARKETPLACE,
    fetchJson: readArtManifest,
  });
  teardown.push(harness.dispose);
  return {
    addon: harness.addon,
    harness,
    hub: harness.hub,
    report: () => reportFrom(harness),
  };
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

  // `probe` is declared and never bound by hand, which is what makes the toggleKey
  // check mean anything: a registration under that id can only have come from the
  // frame that named it, so the check is about the member rather than about the
  // keybind surface underneath it.
  it('declares the keybinds it binds', () => {
    const ids = (manifest().keybinds ?? []).map((bind) => bind.id).sort();

    expect(ids).toEqual(['probe', 'run', 'toggle']);
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

// The demonstrations are manual by definition: a suite cannot see whether a nameplate sits
// over the right shoulder. What it can hold them to is that a button pressed with no game
// behind it creates nothing, since every one of these runs on the login screen as readily as
// in the world.
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

// Every check has to pass here. There is no game in this environment and the harness knows it:
// each check that reads the game reports the no-game case as a pass with a note rather than as
// a failure, so anything red here is the loader's fault rather than the environment's.
describe('what it reports without a game', () => {
  it('passes every check', async () => {
    const { report } = await run();

    expect(await report()).toContain('56 of 56 checks passed');
  });

  it('names no check as failed', async () => {
    const { report } = await run();

    expect(await report()).not.toContain('FAIL');
  });

  // The claim the ticking in `reportFrom` buys: two requests and one draw is something a
  // broken loader fails here rather than in somebody's game.
  it('coalesces two repaint requests into one draw, once a frame runs', async () => {
    const { report } = await run();

    expect(await report()).toContain('two requests before a frame drew once');
  });

  // The half of the movement null the world cases below cannot reach.
  it('says a null multiplier is nobody having said yet, with no world under it', async () => {
    const { report } = await run();

    expect(await report()).toContain('no world yet, so the server has sent no multiplier');
  });

  // Named individually as well as counted, so a rename or a dropped check shows
  // up as a failure here rather than as a total that quietly went down by one.
  it.each([
    'identity',
    'settings',
    'fmt',
    'list',
    'layout',
    'describe',
    'geometry',
    'publish',
    'paint',
    'toggle key',
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
    'vault',
    'craft vault',
    'bank budget',
    'provenance',
    'swings',
    'ability shapes',
    'move speed',
  ])('passes the %s check', async (name) => {
    const { report } = await run();

    expect(await report()).not.toContain(`FAIL  ${name}`);
  });
});

// The fixtures below are the game's OWN object, in the game's own field names (`bankInfo`,
// `vaultInfo`, `craftVaultStock`, `known`): a fixture in the published names would test this
// suite rather than the loader.
type World = Record<string, unknown>;

/** The bank, satisfying both sums the published types say a consumer may rely on. */
const GOOD_BANK = {
  slots: [
    { itemId: 'copper_ore', count: 20 },
    { itemId: 'runed_blade', count: 1, craftedRecipeId: 'smithing_runed_blade' },
  ],
  capacity: 40,
  purchasedSlots: 8,
  bonusSlots: 4,
  nextExpansionCost: 5000,
  bonusSources: [],
  socketsUnlocked: 2,
  socketBags: ['leather_satchel', 'runed_pouch', null, null],
  nextSocketCost: 25_000,
  nextRungClaudiumPrice: 120,
  generalCapacity: 24,
  materialsCapacity: 16,
  generalUsed: 1,
  materialsUsed: 1,
};

/**
 * What is in the vault, and so what crafting may draw. Entry pairs rather than a literal: the
 * keys are the game's own ids, not names this project chose.
 */
const MATERIALS = Object.freeze([
  ['copper_ore', 120],
  ['sheenleaf_herb', 40],
] as const);

const STOCK: Record<string, number> = Object.fromEntries(MATERIALS);

/** Two rungs bought, so there is a cap and a next price, and one identity row. */
const GOOD_VAULT = {
  stock: STOCK,
  special: [{ itemId: 'runed_ingot', count: 3, craftedRecipeId: 'smithing_runed_ingot' }],
  upgrades: 2,
  perMaterialCap: 400,
  nextUpgradeCost: 90_000,
};

/** A channelled ability's def. `castTime` has to be 0: a channel's length is its own field. */
const GOOD_CHANNEL = {
  id: 'volley',
  name: 'Volley',
  school: 'nature',
  castTime: 0,
  channel: { duration: 6, ticks: 6 },
};

/**
 * A spellbook covering all three ability fields. Entries are `{ def, ... }`, the shape the
 * game resolves a spellbook into, and the fields are read off the DEF.
 */
const GOOD_SPELLBOOK = [
  {
    rank: 1,
    def: {
      id: 'aimed_shot',
      name: 'Aimed Shot',
      school: 'physical',
      castTime: 2.5,
      empowerStages: 3,
      offGcd: true,
    },
  },
  { rank: 1, def: GOOD_CHANNEL },
];

/** The player, dual-wielding and swinging, which is the only record an offhand rides. */
function self(): World {
  return liveEntity({
    set: { templateId: 'hunter', autoAttack: true, swingTimer: 0.8, offhandSwingTimer: 1.2 },
  });
}

/** Something else in range, auto-attacking, which only game 0.41.0 lets anyone read. */
function mob(): World {
  return liveEntity({
    set: { id: 902, kind: 'mob', name: 'Sableweb Lurker', autoAttack: true, swingTimer: 1.4 },
  });
}

/** A world with nothing wrong in it, in the game's own field names. */
function goodWorld(): World {
  const player = self();
  return {
    player,
    entities: new Map<number, World>([
      [661, player],
      [902, mob()],
    ]),
    known: GOOD_SPELLBOOK,
    inventory: [
      { itemId: 'baked_bread', count: 5 },
      { itemId: 'runed_blade', count: 1, craftedRecipeId: 'smithing_runed_blade' },
    ],
    bags: [null, null, null, null],
    bagCapacity: 16,
    equipment: { mainhand: 'runed_blade' },
    copper: 41_235,
    bankInfo: GOOD_BANK,
    vaultInfo: GOOD_VAULT,
    craftVaultStock: STOCK,
  };
}

/**
 * The report, with a world under it, and exactly what `over` says changed in that world.
 *
 * `zoneName` is what `world.zone` reads, and it is the game's DOM rather than its world
 * object, so it is a mount option rather than a field.
 */
async function inWorld(over: World = {}): Promise<string> {
  const harness = await mountAddon({
    manifest: MANIFEST_TEXT,
    source: SOURCE,
    marketplace: MARKETPLACE,
    fetchJson: readArtManifest,
    zoneName: () => 'Dawnhold',
    game: Promise.resolve({ world: { ...goodWorld(), ...over } }),
  });
  teardown.push(harness.dispose);
  return await reportFrom(harness);
}

// The present arm of the checks that answer "nothing to read" with no world, which is the arm
// the no-game case above cannot reach.
describe('what it reports in a world', () => {
  it('names no check as failed', async () => {
    expect(await inWorld()).not.toContain('FAIL');
  });

  it('reads the vault as a per-material store rather than a slot budget', async () => {
    expect(await inWorld()).toContain('2 materials stocked and 1 identity rows, 2 rungs at 400');
  });

  it('reads the crafting draw where it is allowed', async () => {
    expect(await inWorld()).toContain('2 materials drawable from where you stand');
  });

  it('reconciles the split budget and the bag sockets', async () => {
    expect(await inWorld()).toContain('1/24 general, 1/16 materials, 2 of 2 open sockets filled');
  });

  it('reports the Claudium rung price where the server joined one', async () => {
    expect(await inWorld()).toContain('120 Claudium for the next rung');
  });

  it('counts the stacks that record what minted them, across all three stores', async () => {
    expect(await inWorld()).toContain('3 of 5 stacks in reach record what minted them');
  });

  it('reads a swing off an entity that is not the player', async () => {
    expect(await inWorld()).toContain('1 of 1 others swinging, your offhand 1.2s out');
  });

  it('reads all three of the ability shapes off the spellbook', async () => {
    expect(await inWorld()).toContain('of 2 known: 1 empower, 1 channel, 1 off the global');
  });

  // The fields are the game's own: the multiplier rides the self wire as `msm` and lands on
  // the client's reconciliation state under these names.
  it('reads an unslowed player as a real multiplier rather than as no answer', async () => {
    const moving = { movementWireVersion: 2, reconMoveSpeedMult: 1 };

    expect(await inWorld(moving)).toContain('moving at 1.00x your base speed');
  });

  it('reads a snare as the multiplier the server applied', async () => {
    const snared = { movementWireVersion: 2, reconMoveSpeedMult: 0.6 };

    expect(await inWorld(snared)).toContain('moving at 0.60x your base speed');
  });

  // On wire v1 the client's field sits at its constructed 1 forever, which would read as unslowed.
  it('reports no answer on the older movement wire, where the 1 is a default', async () => {
    const old = { movementWireVersion: 1, reconMoveSpeedMult: 1 };

    expect(await inWorld(old)).toContain(
      'a live player and still no answer: offline, spectating, or the older movement wire',
    );
  });

  it('reports no answer while spectating, where the server skips the block', async () => {
    const watching = { movementWireVersion: 2, reconMoveSpeedMult: 1, spectating: 'Marshal' };

    expect(await inWorld(watching)).toContain(
      'a live player and still no answer: offline, spectating, or the older movement wire',
    );
  });
});

// Each case contradicts what `packages/types` promises about a 0.41.0 surface and requires the
// harness to name it.
describe('what it refuses in a world', () => {
  it('names a split budget whose halves are not the capacity', async () => {
    const text = await inWorld({ bankInfo: { ...GOOD_BANK, materialsCapacity: 15 } });

    expect(text).toContain('24 general and 15 materials is not the 40 the bank reports');
  });

  it('names used counts that do not add up to the stacks in the bank', async () => {
    const text = await inWorld({ bankInfo: { ...GOOD_BANK, generalUsed: 2 } });

    expect(text).toContain('2 and 1 charged against 2 stacks');
  });

  it('names a socket list that is not four entries long', async () => {
    const text = await inWorld({ bankInfo: { ...GOOD_BANK, socketBags: ['leather_satchel'] } });

    expect(text).toContain('socketBags holds 1 entries rather than 4');
  });

  it('names a Claudium price that arrived as a null instead of being absent', async () => {
    const text = await inWorld({ bankInfo: { ...GOOD_BANK, nextRungClaudiumPrice: null } });

    expect(text).toContain('nextRungClaudiumPrice arrived as null');
  });

  it('names a locked vault that still caps materials at something', async () => {
    const text = await inWorld({ vaultInfo: { ...GOOD_VAULT, upgrades: 0 } });

    expect(text).toContain('a locked vault caps every material at 400');
  });

  it('names a fully upgraded vault that still quotes a next price', async () => {
    const text = await inWorld({ vaultInfo: { ...GOOD_VAULT, upgrades: 5 } });

    expect(text).toContain('every rung is bought and the next still costs 90000');
  });

  it('names a crafting draw that came back gated', async () => {
    const text = await inWorld({ craftVaultStock: { status: 'away', info: null } });

    expect(text).toContain('it came back gated, carrying "away"');
  });

  it('names a channel that still carries a cast time', async () => {
    const book = [{ rank: 1, def: { ...GOOD_CHANNEL, castTime: 1.5 } }];

    expect(await inWorld({ known: book })).toContain(
      'volley is a channel and still carries a 1.5s cast time',
    );
  });

  // A stage count is a divisor over the cast clock, so a fractional one never lands on a stage.
  it('names an empower count that is not a whole number of stages', async () => {
    const def = { id: 'shot', name: 'Shot', castTime: 1, empowerStages: 2.5 };

    expect(await inWorld({ known: [{ rank: 1, def }] })).toContain(
      'shot claims 2.5 empower stages',
    );
  });

  it('names an offhand timer on an entity that is not the player', async () => {
    const player = liveEntity({ set: { templateId: 'hunter' } });
    const other = liveEntity({ set: { id: 902, kind: 'mob', offhandSwingTimer: 0.7 } });
    const text = await inWorld({
      player,
      entities: new Map([
        [661, player],
        [902, other],
      ]),
    });

    expect(text).toContain('1 others carry an offhand timer, which rides your record alone');
  });

  it('names a swing timer running on an entity that is not attacking', async () => {
    const player = liveEntity({ set: { templateId: 'hunter' } });
    const other = liveEntity({ set: { id: 902, kind: 'mob', autoAttack: false, swingTimer: 1.4 } });
    const text = await inWorld({
      player,
      entities: new Map([
        [661, player],
        [902, other],
      ]),
    });

    expect(text).toContain('a swing timer of 1.4 on an entity that is not attacking');
  });
});

// The one check here whose subject is the game rather than the loader.
//
// `damage` and `heal2` pass through the loader untouched, so nothing in a unit suite could be
// wrong about them: a fixture only ever agrees with what it was written to say. That is why
// the harness watches them in a live session, and it is why this suite can only check that the
// watch has teeth. Each case below puts a record on the socket that contradicts
// `packages/types/events-combat.d.ts` and requires the harness to name it.
describe('watching the combat records', () => {
  /** Land some records, then press the button that re-runs everything. */
  async function afterRecords(list: readonly unknown[]): Promise<void> {
    const { harness, report } = await run();
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

  // Nothing is wrong with these, so the check has to stay green and start counting. A watch
  // that only ever reported failures would look identical to one wired to nothing at all, for
  // as long as the game kept behaving.
  it('counts ordinary records rather than only reporting faults', async () => {
    await afterRecords([damage({}), { type: 'heal2', sourceId: 1, targetId: 1, amount: 50 }]);

    await expect
      .poll(() => document.body.textContent ?? '')
      .toContain('1 damage and 1 heal records match the types');
  });

  // A kind the types do not list reaches an addon as an ordinary string, so a display that
  // groups by kind is silently wrong rather than loudly.
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

// A declared data file is fetched by the host at install and answered out of that cache, and
// there is no marketplace behind this document, so the harness reports the read as unavailable
// rather than failing it. What can be checked with no host is the refusal, which is
// page-realm; seeding the host's copy and running again covers the manifest declaration, the
// bridge read, the parse, and the memo behind a second read.
describe('the data file it ships', () => {
  it('refuses a name the manifest does not declare', async () => {
    const { report } = await run();

    expect(await report()).toContain('undeclared names refused');
  });

  it('reads back what is on disk once the host has a copy', async () => {
    const { harness, report } = await run();
    await report();

    harness.addonData(FQID, 'data.json', DATA_TEXT);
    press('Run again');

    await expect
      .poll(() => document.body.textContent ?? '')
      .toContain('data.json: 3 rows, parsed once');
  });
});

// The harness carries its own copy of the world key list, standing in for the published types
// rather than reading the loader's array, so a key that reached one and not the other throws
// from `world.on` in a live session instead of passing everywhere. The copy still has to be
// kept up to date, which is what this pins: a key added to the loader and not to the harness is
// not checked at all.
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
