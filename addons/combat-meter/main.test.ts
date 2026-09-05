// @vitest-environment happy-dom

// The Combat Meter, run through the real loader.
//
// The assertions are about the arithmetic a player would act on rather than about the
// addon loading, and three of them cover fields that are documented traps: `inCombat` is
// not on the wire, so reading it ends every fight and resets the total on every hit; the
// outcome line counts events the damage rows deliberately skip, since a miss is the whole
// reason it exists; and `heal2` carries `cueOnly` events a meter must ignore by the flag
// rather than by the amount.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateManifest } from '../../loader/src/shared/schema.ts';
import {
  characterNamespace,
  configNamespace,
  perCharacterKey,
  SETTINGS_KEY,
} from '../../loader/src/shared/storage-keys.ts';
import { type MountInput, mountAddon, parseManifest } from '../../tests/fakes/addon.ts';
import { liveEntity } from '../../tests/fakes/entity.ts';
import { eventsFrame, PLAYER_ENTITY } from '../../tests/fakes/frames.ts';
import type { SharedHarness } from '../../tests/fakes/shared-services.ts';
import { createFakeStorage, type FakeStorage } from '../../tests/fakes/storage.ts';
import MANIFEST_TEXT from './addon.json?raw';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all. Same reason as the dev-harness suite.
import SOURCE from './main.js?raw';

const FQID = 'official/combat-meter';
const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);
/** The fixture player's id, which is what an event's ids are matched against. */
const PLAYER_ID = PLAYER_ENTITY.id;
const MOB_ID = 9;
/** What a fight against the default target is called, which is the mob's own display name. */
const MOB_NAME = 'Sableweb Lurker';
const MOB_HP = 800;
/** The biggest thing in the zone, so a fight holding both is named after this one. */
const BOSS_ID = 10;
const BOSS_NAME = 'Nythraxis';
const BOSS_HP = 40_000;
const OTHER_ID = PLAYER_ID + 1;
/** The player's own wolf, which nothing but `ownerId` tells from any other mob. */
const PET_ID = 670;
/** The pet's name, which is what a pet row is prefixed with. */
const PET_NAME = 'Grizzle';
/** Somebody else's pet, which the server delivers and this meter must refuse. */
const STRANGER_PET_ID = 671;
/** A pet whose entity has already left the snapshot, so nothing can resolve its owner. */
const GHOST_PET_ID = 672;
/** The addon's own repaint interval, so a suite can reach the next drawn number. */
const REPAINT_MS = 500;
const SECOND = 1000;
/** Which way each of the strip's two buttons moves the view, as the addon marks them. */
const STEPS = { older: '1', newer: '-1' };
/** Where this character's kept fights are filed, by the loader's own per-character key. */
const FIGHTS_KEY = perCharacterKey('pbe', 'Claudemoon/Marshal', 'fights');

const teardown: Array<() => void> = [];

// Fake timers because the meter draws on an interval rather than on every hit: a repaint per
// damage event would be a layout write at the game's event rate.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  for (const stop of teardown.splice(0)) {
    stop();
  }
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function manifest() {
  return parseManifest(MANIFEST_TEXT);
}

function textOf(selector: string): string {
  return document.querySelector(selector)?.textContent ?? '';
}

/** The fields a case cares about; `hit()` fills the rest. */
interface Hit {
  amount?: number;
  ability?: string | null;
  by?: number;
  at?: number;
  kind?: string;
  crit?: boolean;
  absorbed?: number;
  school?: string;
  /** The owner the RECORD carries, which game 0.36.0 snapshots at emit. */
  owner?: number;
}

/** The fields a case cares about; `heal()` fills the rest. */
interface Heal {
  amount?: number;
  ability?: string;
  by?: number;
  at?: number;
  crit?: boolean;
  cueOnly?: boolean;
  absorbed?: number;
  overheal?: number;
}

interface MeterHarness extends SharedHarness {
  /** One damage event landing. Defaults to a plain hit you dealt to a mob. */
  hit: (hit?: Hit) => void;
  /** One heal landing. Defaults to a heal you cast on yourself. */
  heal: (heal?: Heal) => void;
  /** Move both clocks together: what the addon measures with, and its interval. */
  tick: (ms?: number) => void;
  /** The one-direction summary line. */
  fight: () => string;
  /** The attack-table line at the bottom. */
  outcomes: () => string;
  /** The ability labels with a row, in the order they are drawn. */
  labels: () => string[];
  /** One row's figures line: total, share, dps. */
  figureOf: (label: string) => string;
  /** One row's detail line: hits, crit rate, average, biggest. */
  detailOf: (label: string) => string;
  /** Switch tables the way a player does. */
  openTab: (label: string) => void;
  /** Press the addon's own show/hide bind, the way a player does. */
  togglePanel: () => void;
  /** Step the fight strip, older or newer, the way a player does. */
  stepFight: (way: 'older' | 'newer') => void;
  /** What the strip says is open, and where that page sits in the list. */
  openFight: () => string;
  fightPosition: () => string;
  /** Whether a step is offered at all, which is how the strip says it has reached an end. */
  canStep: (way: 'older' | 'newer') => boolean;
  /** Wipe everything, the way a player does. */
  reset: () => void;
}

/** Any total order will do: the sort exists to make the assertion order-free. */
function byName(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a < b) {
    return -1;
  }
  return 1;
}

function rowFor(label: string): Element | null {
  return document.querySelector(`[data-ability="${label}"]`);
}

/**
 * One of the fight strip's two steps, found by the direction it moves the view rather than
 * by its glyph: the arrow is a character somebody may well retype, and the step is the thing
 * the button means.
 */
function stepButton(way: 'older' | 'newer'): HTMLButtonElement | null {
  const step = STEPS[way];
  return document.querySelector(`[data-role="fights"] [data-step="${step}"]`);
}

function hover(label: string): string {
  rowFor(label)?.dispatchEvent(new Event('pointerenter'));
  return document.getElementById('woc-tooltip')?.textContent ?? '';
}

/** The width the kit wrote on a row's fill, which is the share made visible. */
function fillWidthOf(label: string): string {
  const fill = rowFor(label)?.querySelector('.woc-bar-fill');
  return (fill as HTMLElement | null)?.style.width ?? '';
}

/**
 * The ability on an event, where an explicit null is the auto-attack case. Not
 * `?? 'Aimed Shot'`: that treats a deliberate null as absent, which is the case the Melee row
 * exists for.
 *
 * The values throughout this suite are display names, because that is what the wire puts in
 * this field. Ids here pass every assertion about a row just as well, so the icon is the only
 * thing that can tell the two apart, which is why it is asserted below.
 */
function abilityOf(hit: Hit): string | null {
  if ('ability' in hit) {
    return hit.ability ?? null;
  }
  return 'Aimed Shot';
}

/**
 * A spellbook in the game's own shape, carrying the divergence this addon turns on.
 * `arcane_shot` is displayed as "Fell Shot", so an event names one thing and the art is filed
 * under another. Both are here so a test can prove the join runs backwards correctly.
 */
const KNOWN = [
  {
    def: { id: 'arcane_shot', name: 'Fell Shot', school: 'arcane', requiresTarget: true },
    rank: 1,
    cost: 25,
    castTime: 0,
    cooldown: 6,
  },
];

/**
 * A pet, which is a mob-kind entity carrying an owner. Nothing else on the wire separates
 * one from any other mob in the zone, which is exactly why the meter has to read this field
 * rather than guessing from a name or a template.
 */
function pet(id: number, name: string, ownerId: number): Record<string, unknown> {
  return liveEntity({ set: { id, name, kind: 'mob', templateId: 'wolf', ownerId } });
}

/**
 * A mob with nobody's collar on it. `ownerId` is left at the fixture's null rather than set,
 * because null is what "nobody" is on the wire and a zero there would make every mob in the
 * fixture the player's own pet.
 */
function mob(id: number, name: string, maxHp: number): Record<string, unknown> {
  return liveEntity({ set: { id, name, maxHp, kind: 'mob', templateId: 'spider' } });
}

interface RunOpts {
  /** Stored settings, seeded before the body runs, as the loader would hydrate them. */
  settings?: Record<string, unknown>;
  /** Pass one in to seed this character's kept fights, or to read back what was written. */
  storage?: FakeStorage;
}

/**
 * Start the addon and wait for its panel to come up. A frame that saves its state starts
 * hidden and is shown once that state arrives, keyed per character, so it takes a watcher
 * sample and then a storage read. Every case here is about what the meter draws.
 */
async function run(opts: RunOpts = {}): Promise<MeterHarness> {
  const player = liveEntity({ set: { templateId: 'priest' } });
  const entities = new Map([[PLAYER_ID, player]]);
  // Two pets in scope, told apart by nothing but who owns them, which is the whole of what
  // the server checks before it decides whose meter a record belongs on. Both are here in
  // every case so that a fixture cannot pass by having only ever seen the friendly one.
  entities.set(PET_ID, pet(PET_ID, PET_NAME, PLAYER_ID));
  entities.set(STRANGER_PET_ID, pet(STRANGER_PET_ID, 'Snarl', OTHER_ID));
  entities.set(MOB_ID, mob(MOB_ID, MOB_NAME, MOB_HP));
  entities.set(BOSS_ID, mob(BOSS_ID, BOSS_NAME, BOSS_HP));
  const world = { entities, player, known: KNOWN };
  const input: MountInput = {
    manifest: MANIFEST_TEXT,
    source: SOURCE,
    game: Promise.resolve({ world }),
    settings: opts.settings ?? {},
  };
  // Assigned only when there is one: `exactOptionalPropertyTypes` refuses an explicit
  // undefined for an optional property. See STYLE.md.
  if (opts.storage !== undefined) {
    input.storage = opts.storage;
  }
  const harness = await mountAddon(input);
  teardown.push(harness.dispose);
  // The sample resolves the character; the awaits let the read keyed on it return.
  harness.shared.world.watcher.poll();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  // The panel's first draw is a `woc.paint` request made while it was still hidden, so
  // the loop is what performs it once the restore has put it on screen.
  harness.frames.tick();

  return {
    ...harness,
    hit: (hit = {}) => {
      const event = {
        type: 'damage',
        sourceId: hit.by ?? PLAYER_ID,
        targetId: hit.at ?? MOB_ID,
        amount: hit.amount ?? 100,
        ability: abilityOf(hit),
        kind: hit.kind ?? 'hit',
        crit: hit.crit ?? false,
        school: hit.school ?? 'physical',
        absorbed: hit.absorbed,
        sourceOwnerId: hit.owner,
      };
      harness.inbound(eventsFrame([event]));
    },
    heal: (heal = {}) => {
      const event = {
        type: 'heal2',
        sourceId: heal.by ?? PLAYER_ID,
        targetId: heal.at ?? PLAYER_ID,
        amount: heal.amount ?? 100,
        ability: heal.ability ?? 'Mend Wounds',
        crit: heal.crit ?? false,
        cueOnly: heal.cueOnly,
        absorbed: heal.absorbed,
        overheal: heal.overheal,
      };
      harness.inbound(eventsFrame([event]));
    },
    tick: (ms = REPAINT_MS) => {
      harness.advance(ms);
      vi.advanceTimersByTime(ms);
      // The panel draws through `woc.paint`, so the interval only ASKS for a repaint
      // and the loop is what performs it. Arrangement rather than assertion: a real
      // browser runs a frame here without being told to.
      harness.frames.tick();
    },
    fight: () => textOf('.woc-meter-total'),
    outcomes: () => textOf('.woc-meter-outcomes'),
    labels: () =>
      [...document.querySelectorAll('[data-ability]')].map(
        (el) => el.getAttribute('data-ability') ?? '',
      ),
    figureOf: (label) => rowFor(label)?.querySelector('.woc-bar-value')?.textContent ?? '',
    detailOf: (label) => rowFor(label)?.querySelector('.woc-bar-detail')?.textContent ?? '',
    // Selected inside the meter's own strip, by the kit's class rather than one of the
    // addon's: the buttons are the loader's, and the addon marks only the strip.
    openTab: (label) => {
      const button = [...document.querySelectorAll('.woc-meter-tabs .woc-tab')].find(
        (el) => el.textContent === label,
      );
      (button as HTMLButtonElement | undefined)?.click();
      harness.frames.tick();
    },
    // The addon's own default bind, pressed at the dispatcher: the same path a
    // player takes, rather than a call to the frame the addon happens to hold.
    togglePanel: () => {
      harness.press('Alt+KeyD');
      harness.frames.tick();
    },
    stepFight: (way) => {
      stepButton(way)?.click();
      harness.frames.tick();
    },
    openFight: () => textOf('.woc-meter-page'),
    fightPosition: () => textOf('.woc-meter-position'),
    canStep: (way) => stepButton(way)?.disabled === false,
    reset: () => {
      harness.press('Alt+Shift+KeyD');
      harness.frames.tick();
    },
  };
}

// The two surfaces the meter takes from the kit rather than hand-rolling: the tab strip, which
// owns which tab is marked, and the tooltip, which is a function so a row reports the tally as
// it is now rather than as it was when the row was built.
describe('what it takes from the kit', () => {
  it('draws its tabs with the loader strip rather than its own buttons', async () => {
    await run();

    // A nav of kit tabs, marked the way the manager's own strip is marked.
    expect(document.querySelectorAll('.woc-meter-tabs .woc-tab')).toHaveLength(3);
    expect(document.querySelector('.woc-meter-tabs .woc-tab-active')?.textContent).toBe('Damage');
  });

  it('lets the strip own which tab is marked', async () => {
    const h = await run();

    h.openTab('Healing');

    expect(document.querySelector('.woc-meter-tabs .woc-tab-active')?.textContent).toBe('Healing');
  });

  // The reason the tooltip is a function: the row is hovered long after it was
  // built, and what it has to say is the tally as it is now.
  it('answers a hover with the numbers as they are, not as they were', async () => {
    const h = await run();
    h.hit({ ability: 'Aimed Shot', amount: 100 });
    h.tick();
    expect(hover('Aimed Shot')).toContain('1 hits');

    h.hit({ ability: 'Aimed Shot', amount: 100 });
    h.tick();

    expect(hover('Aimed Shot')).toContain('2 hits');
  });

  it('names the ability in the tooltip title', async () => {
    const h = await run();
    h.hit({ ability: 'Aimed Shot', amount: 100 });
    h.tick();

    hover('Aimed Shot');

    expect(document.querySelector('.woc-tip-title')?.textContent).toBe('Aimed Shot');
  });

  // A row with no art is one this character did not cast, which the row itself
  // cannot say: it just has an empty icon slot, the same as art that failed.
  it('says when a row is not from your own spellbook', async () => {
    const h = await run();
    h.hit({ ability: 'Cleave', amount: 100 });
    h.tick();

    expect(hover('Cleave')).toContain('not in your spellbook');
  });
});

describe('its manifest', () => {
  it('validates against the shared schema', () => {
    expect(validateManifest(MANIFEST_JSON).ok).toBe(true);
  });

  // An id is the storage namespace and the keybind scope, so renaming a published one orphans
  // every installed player's settings, keybinds and window position. Pinned in both places,
  // since the id and the display name are separate decisions.
  it('is the combat meter in both its id and its name', () => {
    expect(manifest().id).toBe('combat-meter');
    expect(manifest().name).toBe('Combat Meter');
  });

  // The five surfaces it actually uses. A permission it does not need would be
  // asked of every player installing it, on a screen built to be read. `storage` is here for
  // the kept fights, which are this character's rather than the account's.
  it('declares exactly the permissions it uses', () => {
    expect(manifest().permissions).toEqual(['net.read', 'world.read', 'ui', 'keys', 'storage']);
  });

  it('declares the keybinds it binds and the settings it reads', () => {
    expect((manifest().keybinds ?? []).map((bind) => bind.id).sort()).toEqual(['reset', 'toggle']);
    expect((manifest().settings ?? []).map((setting) => setting.id).sort()).toEqual([
      'fight-timeout',
      'keep-fights',
      'max-rows',
      'show-detail',
      'show-outcomes',
    ]);
  });

  // The smallest minor carrying EVERY published member this addon reads. `closable` is minor 2;
  // `Heal2Event.overheal`, `woc.ui.list`, `woc.paint` and `FrameOpts.toggleKey` are minor 4;
  // `DamageEvent.sourceOwnerId` is minor 5.
  // A FIELD on an event record counts as much as a function does, whether or not the loader
  // implements anything for it: nothing promises an event reaches an addon verbatim, and
  // under-declaring fails silently as a zero where over-declaring fails with a message.
  // `sourceOwnerId` is the sharpest case of that: an older loader would pass it through
  // unread, and the addon would go on dropping the pet damage this exists to keep.
  //
  // `woc.fmt.duration` is offered and refused; the reason is on the function in main.js.
  it('declares the API minor it actually needs', () => {
    expect(manifest().apiMinor).toBe(5);
  });
});

describe('loading it', () => {
  it('puts its panel up and registers both keybinds', async () => {
    const { shared } = await run();

    expect(document.querySelectorAll('[data-woc-frame="meter"]')).toHaveLength(1);
    expect(Object.keys(shared.dispatcher.bindings()).sort()).toEqual([
      `${FQID}:reset`,
      `${FQID}:toggle`,
    ]);
  });

  it('logs nothing at error level', async () => {
    const { shared } = await run();

    expect(shared.logs.tail(FQID).filter((entry) => entry.level === 'error')).toEqual([]);
  });

  // Before anything lands there is nothing to report, and a panel that opened on
  // NaN or on the last session's numbers would be read as broken.
  it('starts at zero with no rows', async () => {
    const h = await run();

    expect(h.fight()).toContain('0 damage');
    expect(h.labels()).toEqual([]);
  });
});

// It is a frame rather than a window, and the five cases are the whole of that decision.
//
// The close button does not separate them: `closable` works on either, and this frame asks for
// one. Neither does density, since a window honours `compact` and refuses only `bare`. What
// decides it is the ARIA role a screen reader announces: a window is a `dialog`, a thing the
// player opened, and a frame is a `group`, HUD furniture. Pinned rather than left to the
// source, because the two calls take the same options.
describe('the kind of panel it is', () => {
  function panel(): Element | null {
    return document.querySelector('[data-woc-frame="meter"]');
  }

  it('is a frame rather than a window', async () => {
    await run();

    expect(panel()?.classList.contains('woc-chrome-frame')).toBe(true);
    expect(panel()?.classList.contains('woc-chrome-window')).toBe(false);
  });

  // The half of the distinction that is actually announced to anybody. A dialog is a
  // thing the player opened and expects to be returned from; this is furniture.
  it('announces itself as HUD furniture rather than as a dialog', async () => {
    await run();

    expect(panel()?.getAttribute('role')).toBe('group');
  });

  // A frame gets a close button only when it asks, and this one does: the keybind is the fast
  // route to dismissing a read meter and the button is the discoverable one. The rail button's
  // window menu is what brings it back, since a hidden frame has no button left to press.
  it('carries the close button it asked for, and hiding it is what the button does', async () => {
    await run();
    const close = panel()?.querySelector('.woc-close');
    expect(close).not.toBeNull();
    expect(panel()?.classList.contains('woc-hidden')).toBe(false);

    (close as HTMLButtonElement).click();

    expect(panel()?.classList.contains('woc-hidden')).toBe(true);
  });

  // A compact frame keeps its title bar, so the panel is still named and still has a bar to
  // drag it by; only `bare` drops it.
  it('keeps the title bar it is named and dragged by', async () => {
    await run();

    expect(panel()?.querySelector('.woc-titlebar')).not.toBeNull();
    expect(panel()?.querySelector('.woc-title')?.textContent).toBe('Combat');
  });

  // A frame that said nothing would fall back to comfortable, which is a 40px tap-target
  // floor: right for a form, and the loudest thing on screen in a dense readout.
  it('says compact rather than falling back to the accessible default', async () => {
    await run();

    expect(panel()?.classList.contains('woc-density-compact')).toBe(true);
  });
});

describe('the running total', () => {
  // A single rolling figure answers a question the per-ability rates already answer per
  // ability, and it makes the panel's loudest element the least specific thing in it.
  it('shows no single rolling figure', async () => {
    await run();

    expect(document.querySelector('.woc-meter-rolling')).toBeNull();
  });

  it('counts a hit the player dealt', async () => {
    const h = await run();

    h.hit({ amount: 600 });
    h.tick();

    expect(h.fight()).toContain('600 damage');
  });

  // The filter that makes it YOUR meter. Without it every other player fighting
  // in range inflates the number, which is the classic way one of these lies.
  it('ignores damage somebody else dealt to somebody else', async () => {
    const h = await run();

    h.hit({ amount: 600, by: OTHER_ID });
    h.tick();

    expect(h.fight()).toContain('0 damage');
    expect(h.labels()).toEqual([]);
  });

  // The total is the fight's, so it accumulates rather than decaying: that is the
  // whole difference from the figure it replaced.
  it('accumulates across the fight', async () => {
    const h = await run();

    h.hit({ amount: 400 });
    h.tick(4 * SECOND);
    h.hit({ amount: 200 });
    h.tick();

    expect(h.fight()).toContain('600 damage');
  });
});

describe('the ability breakdown', () => {
  it('opens a row per ability, named from the id', async () => {
    const h = await run();

    h.hit({ ability: 'Aimed Shot' });
    h.hit({ ability: 'Multi Shot' });
    h.tick();

    expect(h.labels().sort(byName)).toEqual(['Aimed Shot', 'Multi Shot']);
  });

  // An auto-attack arrives with no ability at all, and on most classes it is a
  // real share of the total. Dropping it would silently understate everything.
  it('files an auto-attack under Melee', async () => {
    const h = await run();

    h.hit({ ability: null });
    h.tick();

    expect(h.labels()).toEqual(['Melee']);
  });

  it('orders the rows biggest first', async () => {
    const h = await run();

    h.hit({ ability: 'Multi Shot', amount: 100 });
    h.hit({ ability: 'Aimed Shot', amount: 900 });
    h.hit({ ability: 'Serpent Sting', amount: 500 });
    h.tick();

    expect(h.labels()).toEqual(['Aimed Shot', 'Serpent Sting', 'Multi Shot']);
  });

  it('reports each row as total, share and dps', async () => {
    const h = await run();

    h.hit({ ability: 'Aimed Shot', amount: 750 });
    h.hit({ ability: 'Multi Shot', amount: 250 });
    h.tick(SECOND);

    // 750 of 1000 over the one second elapsed. The third figure carries its unit, because
    // three bare numbers in a row leave the reader to work out which one is a rate.
    expect(h.figureOf('Aimed Shot')).toBe('750  75%  750.0/s');
    expect(h.figureOf('Multi Shot')).toBe('250  25%  250.0/s');
  });

  // The four figures the game shows nowhere. Crit rate is the one worth having:
  // it is the only way to see what a talent or a gear change actually did.
  it('reports hits, crit rate, average and biggest per row', async () => {
    const h = await run();

    h.hit({ amount: 100 });
    h.hit({ amount: 300, crit: true });
    h.tick();

    expect(h.detailOf('Aimed Shot')).toBe('2 hits, 50% crit, avg 200, max 300');
  });

  it('adds absorbed damage to the row that was absorbed', async () => {
    const h = await run();

    h.hit({ amount: 100, absorbed: 40 });
    h.tick();

    expect(h.detailOf('Aimed Shot')).toContain('40 absorbed');
  });

  // A hit a shield ate whole is a `hit` landing at 0, and `kind` is what tells it apart from a
  // swing that never connected. It is a thing that happened, so it reaches the table carrying
  // the figure that says where the damage went.
  it('records a hit a shield ate whole', async () => {
    const h = await run();

    h.hit({ amount: 0, absorbed: 400 });
    h.tick();

    expect(h.labels()).toEqual(['Aimed Shot']);
    expect(h.detailOf('Aimed Shot')).toContain('400 absorbed');
  });

  // The half of that rule the kit is responsible for: a row reading 0 of 0 has no denominator
  // at all when everything in the table was absorbed. It has to draw as an empty bar, never as
  // a full one and never as a dropped declaration.
  it('draws a fully absorbed row as an empty bar rather than a full one', async () => {
    const h = await run();

    h.hit({ amount: 0, absorbed: 400 });
    h.tick();

    expect(h.figureOf('Aimed Shot')).toBe('0  0%  0.0/s');
    expect(fillWidthOf('Aimed Shot')).toBe('0.00%');
  });
});

describe('the outcome line', () => {
  // The reason this exists: a miss deals nothing, so it never reaches a damage
  // row, and the rate is invisible everywhere else in the game.
  it('counts outcomes the damage rows skip', async () => {
    const h = await run();

    h.hit({ amount: 100 });
    h.hit({ amount: 0, kind: 'miss' });
    h.hit({ amount: 0, kind: 'dodge' });
    h.hit({ amount: 0, kind: 'dodge' });
    h.tick();

    expect(h.outcomes()).toBe('hit 25%, miss 25%, dodge 50%');
    // And none of the three whiffs opened a row or moved the total.
    expect(h.detailOf('Aimed Shot')).toContain('1 hits');
  });

  it('says nothing before anything has been swung', async () => {
    const h = await run();

    expect(h.outcomes()).toBe('');
  });

  // `evade` is a wild mob refusing the hit while immune (walking home on a broken leash, or,
  // since game 0.41.4, pinned in place inside an instance because it cannot reach you), and it
  // is a real outcome of a real swing you took. What it must not be is counted and unnamed:
  // the total this line
  // divides by is every outcome recorded, so an outcome missing from the printed list silently
  // shrinks every percentage beside it.
  it('names an evade rather than only deflating the rest', async () => {
    const h = await run();

    h.hit({ amount: 100 });
    h.hit({ amount: 0, kind: 'evade' });
    h.tick();

    expect(h.outcomes()).toBe('hit 50%, evade 50%');
  });

  // The other half: an evade always lands at 0, so it counts as an outcome and
  // must never open a damage row or move the total, exactly as a miss does not.
  it('opens no damage row for an evade', async () => {
    const h = await run();

    h.hit({ amount: 0, kind: 'evade', ability: 'Aimed Shot' });
    h.tick();

    expect(h.labels()).toEqual([]);
    expect(h.fight()).toContain('0 damage');
  });

  // Damage taken must not pollute YOUR attack table: it is the mob's outcome,
  // not yours, and counting it would make a tank look like they never connect.
  it('ignores the outcome of a hit that landed on the player', async () => {
    const h = await run();

    h.hit({ by: OTHER_ID, at: PLAYER_ID, amount: 500 });
    h.tick();

    expect(h.outcomes()).toBe('');
  });
});

describe('the taken table', () => {
  it('tallies what landed on the player, by ability', async () => {
    const h = await run();

    h.hit({ by: OTHER_ID, at: PLAYER_ID, amount: 500, ability: 'Cleave' });
    h.tick();

    h.openTab('Taken');

    expect(h.labels()).toEqual(['Cleave']);
    expect(h.figureOf('Cleave')).toContain('500');
  });

  // The two tables are separate tallies, so a dealt row must not appear under
  // Taken and vice versa. One shared map would double-count the mirror case.
  it('keeps the two directions apart', async () => {
    const h = await run();
    h.hit({ ability: 'Aimed Shot', amount: 100 });
    h.hit({ by: OTHER_ID, at: PLAYER_ID, amount: 500, ability: 'Cleave' });
    h.tick();

    expect(h.labels()).toEqual(['Aimed Shot']);
    h.openTab('Taken');

    expect(h.labels()).toEqual(['Cleave']);
  });

  // The same rule from the other side, and the reading a tank most wants: a hit
  // your own shield ate whole landed nothing on you and is still the thing that
  // happened. Dropping it would make an absorb look like a swing that missed.
  it('records a hit on you that a shield ate whole', async () => {
    const h = await run();

    h.hit({ by: OTHER_ID, at: PLAYER_ID, amount: 0, absorbed: 400, ability: 'Cleave' });
    h.tick();

    h.openTab('Taken');

    expect(h.labels()).toEqual(['Cleave']);
    expect(h.detailOf('Cleave')).toContain('400 absorbed');
  });

  // One direction per tab, not both on one line. Reporting both put a "0 taken"
  // in front of everyone who never gets hit, which is most of the time.
  it('summarises the open tab only', async () => {
    const h = await run();

    h.hit({ amount: 100 });
    h.hit({ by: OTHER_ID, at: PLAYER_ID, amount: 500 });
    h.tick();

    expect(h.fight()).toContain('100 damage');
    expect(h.fight()).not.toContain('taken');
    h.openTab('Taken');

    expect(h.fight()).toContain('500 taken');
    expect(h.fight()).not.toContain('damage');
  });
});

describe('the healing table', () => {
  // `heal2`, not `heal`: only the former carries a `sourceId`, so it is the only
  // event a heal can be attributed from at all.
  it('tallies what the player healed, by ability', async () => {
    const h = await run();

    h.heal({ amount: 400, ability: 'Mend Wounds' });
    h.tick();
    h.openTab('Healing');

    expect(h.labels()).toEqual(['Mend Wounds']);
    expect(h.fight()).toContain('400 healing');
  });

  it('ignores a heal somebody else cast', async () => {
    const h = await run();

    h.heal({ amount: 400, by: OTHER_ID });
    h.tick();
    h.openTab('Healing');

    expect(h.labels()).toEqual([]);
  });

  // `cueOnly` events exist to drive a sound and carry no healing, and the game's own comment
  // says a meter must ignore them by the flag rather than by the amount: a genuine direct heal
  // legitimately lands at 0 on a target already at full health.
  it('ignores a cue-only heal', async () => {
    const h = await run();

    h.heal({ amount: 0, cueOnly: true, ability: 'Renewal' });
    h.tick();
    h.openTab('Healing');

    expect(h.labels()).toEqual([]);
    expect(h.fight()).toContain('0 healing');
  });

  // A heal-absorb shield eats part of a heal before it lands, and the same field reports it on
  // `heal2` as on `damage`. The row's total stays what landed; the absorbed figure rides the
  // detail line, where it says why the landed number is lower than the cast was worth.
  it('adds absorbed healing to the row a shield ate part of', async () => {
    const h = await run();

    h.heal({ amount: 300, absorbed: 200 });
    h.tick();
    h.openTab('Healing');

    expect(h.figureOf('Mend Wounds')).toContain('300');
    expect(h.detailOf('Mend Wounds')).toContain('200 absorbed');
  });

  // A heal a shield devoured and a heal that overhealed both land at `amount: 0`, and
  // `absorbed` is the only thing that parts them. They deserve opposite reactions: one is a
  // cast wasted on somebody already full, the other a target still at low health whose healing
  // is being eaten off them.
  it('records a heal a shield ate whole, which lands at zero', async () => {
    const h = await run();

    h.heal({ amount: 0, absorbed: 500 });
    h.tick();
    h.openTab('Healing');

    expect(h.labels()).toEqual(['Mend Wounds']);
    expect(h.detailOf('Mend Wounds')).toContain('500 absorbed');
  });

  // The other half of that same `amount: 0`, which has to stay out. Nothing was absorbed, so
  // the cast landed on somebody already at full health.
  it('records nothing for a heal that only overhealed', async () => {
    const h = await run();

    h.heal({ amount: 0 });
    h.tick();
    h.openTab('Healing');

    expect(h.labels()).toEqual([]);
  });

  // `cueOnly` and a fully absorbed heal look alike from the outside, since both are
  // `amount: 0`, and only one is a real cast. The flag is what parts them and has to be read
  // first. The pairing below is not something the wire sends: it is adversarial on purpose,
  // because what is being pinned is the order of the two guards.
  it('still skips a cue-only record even though a zero heal can now count', async () => {
    const h = await run();

    h.heal({ amount: 0, cueOnly: true, absorbed: 500, ability: 'Renewal' });
    h.tick();
    h.openTab('Healing');

    expect(h.labels()).toEqual([]);
    expect(h.fight()).toContain('0 healing');
  });

  it('reports crit rate and biggest heal like the damage rows', async () => {
    const h = await run();

    h.heal({ amount: 100 });
    h.heal({ amount: 300, crit: true });
    h.tick();
    h.openTab('Healing');

    expect(h.detailOf('Mend Wounds')).toBe('2 hits, 50% crit, avg 200, max 300');
  });

  // Three separate tallies. One shared map would put a heal in the damage table
  // and double-count anything that appeared in both.
  it('keeps the three tables apart', async () => {
    const h = await run();
    h.hit({ amount: 100, ability: 'Aimed Shot' });
    h.heal({ amount: 400, ability: 'Mend Wounds' });
    h.hit({ by: OTHER_ID, at: PLAYER_ID, amount: 500, ability: 'Cleave' });
    h.tick();

    expect(h.labels()).toEqual(['Aimed Shot']);
    h.openTab('Healing');
    expect(h.labels()).toEqual(['Mend Wounds']);
    h.openTab('Taken');
    expect(h.labels()).toEqual(['Cleave']);
  });

  // The attack table is yours and is about damage. On Healing it is a non
  // sequitur, and on Taken it would read as the attacker's outcomes.
  it('shows no attack table on the healing or taken tabs', async () => {
    const h = await run();
    h.hit({ amount: 100 });
    h.hit({ amount: 0, kind: 'miss' });
    h.tick();
    expect(h.outcomes()).not.toBe('');

    h.openTab('Healing');
    expect(h.outcomes()).toBe('');
    h.openTab('Taken');

    expect(h.outcomes()).toBe('');
  });

  // A healer may deal no damage and take none for a whole encounter, so a heal has
  // to be able to open a fight or their meter never starts.
  it('opens a fight on a heal alone', async () => {
    const h = await run();

    h.heal({ amount: 400 });
    h.tick();
    h.openTab('Healing');

    expect(h.fight()).not.toContain('last fight');
  });

  // And it has to keep one alive, or a healer's fight would close mid-encounter
  // while they were still casting.
  it('keeps a fight alive on healing alone', async () => {
    const h = await run();
    h.hit({ amount: 100 });

    h.tick(4 * SECOND);
    h.heal({ amount: 100 });
    h.tick(4 * SECOND);

    expect(h.fight()).not.toContain('last fight');
  });
});

// A pet's damage is the owner's. Since game 0.35.0 the server resolves each side to its
// controller before deciding who a combat record reaches, so an owner receives their own pet's
// events: matching a raw `sourceId` against your own id undercounts a hunter, warlock or mage
// by everything their pet did, silently.
//
// `ownerId` is the only thing separating a pet from any other mob in the zone, so the second
// case below is as load-bearing as the first: fold in every owned entity and the meter becomes
// a zone-wide damage display.
describe('what your pet did', () => {
  it('counts a hit your own pet dealt', async () => {
    const h = await run();

    h.hit({ by: PET_ID, amount: 400, ability: null });
    h.tick();

    expect(h.fight()).toContain('400 damage');
  });

  // The row says whose it was, which folding silently could not. Its own melee lands in the
  // same bucket as your auto-attack otherwise, and a player cannot tell what the pet added.
  // `{pet}: {ability}` is the game's own spelling for this in its breakdown.
  it('labels a pet row with the pet name', async () => {
    const h = await run();

    h.hit({ by: PET_ID, amount: 400, ability: null });
    h.tick();

    expect(h.labels()).toEqual([`${PET_NAME}: Melee`]);
  });

  // The half that keeps it YOUR meter. A stranger's pet is delivered by the same change that
  // delivers yours, and it resolves to a principal who is not you.
  it('ignores a hit somebody else pet dealt', async () => {
    const h = await run();

    h.hit({ by: STRANGER_PET_ID, amount: 400, ability: null });
    h.tick();

    expect(h.fight()).toContain('0 damage');
    expect(h.labels()).toEqual([]);
  });

  // A pet whose entity has gone from the snapshot and whose record carries no owner either
  // has nothing left to attribute from. It degrades rather than throwing on a lookup that
  // answered nothing, which is what every pre-0.36.0 server produces.
  it('drops a pet event whose entity is gone and whose record says nothing', async () => {
    const h = await run();

    expect(() => h.hit({ by: GHOST_PET_ID, amount: 400, ability: null })).not.toThrow();
    h.tick();

    expect(h.fight()).toContain('0 damage');
    expect(h.labels()).toEqual([]);
  });

  // The case the snapshot lookup structurally cannot answer, and the worst-placed one there
  // is: a pet despawns when its owner dies, so the exchange that killed them is exactly the
  // one whose source is already gone. Game 0.36.0 puts the owner on the record at emit.
  it('counts a despawned pet hit from the owner the record carries', async () => {
    const h = await run();

    h.hit({ by: GHOST_PET_ID, owner: PLAYER_ID, amount: 400, ability: null });
    h.tick();

    expect(h.fight()).toContain('400 damage');
  });

  // The name is unrecoverable once the entity is gone, so the row takes the generic label.
  // Reading it as your own cast would be worse than a vague name: it would put a pet's melee
  // in the bucket your auto-attack lands in, which is the thing the prefix exists to prevent.
  it('labels a despawned pet row generically rather than as your own', async () => {
    const h = await run();

    h.hit({ by: GHOST_PET_ID, owner: PLAYER_ID, amount: 400, ability: null });
    h.tick();

    expect(h.labels()).toEqual(['Pet: Melee']);
  });

  // The record's owner is asked AGAINST you, exactly as the snapshot lookup is. A stranger's
  // pet carries an owner id too, and folding on the field's presence alone would turn the
  // panel into a zone-wide display the moment 0.36.0 shipped.
  it('ignores a despawned pet whose record names somebody else as owner', async () => {
    const h = await run();

    h.hit({ by: GHOST_PET_ID, owner: OTHER_ID, amount: 400, ability: null });
    h.tick();

    expect(h.fight()).toContain('0 damage');
    expect(h.labels()).toEqual([]);
  });

  // The attack table is a separate decision from attribution and the record's owner must not
  // change it: a pet's swing rolls against the PET's hit rating whether or not the snapshot
  // still has the pet in it.
  it('keeps a despawned pet swing out of your attack table', async () => {
    const h = await run();

    h.hit({ amount: 100 });
    h.hit({ by: GHOST_PET_ID, owner: PLAYER_ID, amount: 0, kind: 'miss', ability: null });
    h.tick();

    expect(h.outcomes()).toBe('hit 100%');
  });

  // A pet's swing rolls against the PET'S hit rating, not yours. Counting it here would blend
  // two attack tables into one figure and leave neither readable, which is the same reason
  // damage taken has never entered this line.
  it('keeps a pet swing out of your attack table', async () => {
    const h = await run();

    h.hit({ amount: 100 });
    h.hit({ by: PET_ID, amount: 0, kind: 'miss', ability: null });
    h.tick();

    expect(h.outcomes()).toBe('hit 100%');
  });

  // Damage taken by your pet is damage you should see, and the server delivers it on exactly
  // that basis. Here the prefix names who it landed ON, since the ability is the attacker's.
  it('attributes damage taken by your pet', async () => {
    const h = await run();

    h.hit({ by: MOB_ID, at: PET_ID, amount: 250, ability: 'Cleave' });
    h.tick();
    h.openTab('Taken');

    expect(h.labels()).toEqual([`${PET_NAME}: Cleave`]);
    expect(h.fight()).toContain('250 taken');
  });

  it('ignores damage taken by somebody else pet', async () => {
    const h = await run();

    h.hit({ by: MOB_ID, at: STRANGER_PET_ID, amount: 250, ability: 'Cleave' });
    h.tick();
    h.openTab('Taken');

    expect(h.labels()).toEqual([]);
  });

  // Demon Heal is the inversion: it carries the OWNER as `sourceId` and targets the pet, so it
  // was already attributed to you before any of this. The row must therefore stay unprefixed,
  // because the caster is you and the prefix names the caster on this tab.
  it('files a heal you cast on your pet under your own name', async () => {
    const h = await run();

    h.heal({ at: PET_ID, amount: 300, ability: 'Demon Heal' });
    h.tick();
    h.openTab('Healing');

    expect(h.labels()).toEqual(['Demon Heal']);
    expect(h.fight()).toContain('300 healing');
  });

  // No art for any pet ability by any route: they are in no spellbook, so `byName` can only
  // answer null, and a swing carries no name at all. The tooltip is where a row can say why
  // its icon slot is empty, and for a pet the reason is not "not in your spellbook".
  it('draws no art for a pet row and names the pet in its tooltip', async () => {
    const h = await run();

    h.hit({ by: PET_ID, amount: 400, ability: 'Bite' });
    h.tick();

    const icon = rowFor(`${PET_NAME}: Bite`)?.querySelector('img.woc-bar-icon');
    expect(icon?.hasAttribute('src')).toBe(false);
    expect(hover(`${PET_NAME}: Bite`)).toContain(`your pet ${PET_NAME}`);
  });

  // The pet's rows and yours are separate tallies against one total, which is what makes the
  // share column answer "how much of my output was the pet".
  it('adds the pet to your total while keeping the rows apart', async () => {
    const h = await run();

    h.hit({ amount: 750, ability: 'Aimed Shot' });
    h.hit({ by: PET_ID, amount: 250, ability: null });
    h.tick(SECOND);

    expect(h.fight()).toContain('1,000 damage');
    expect(h.figureOf('Aimed Shot')).toBe('750  75%  750.0/s');
    expect(h.figureOf(`${PET_NAME}: Melee`)).toBe('250  25%  250.0/s');
  });
});

// The rate was already the third column of every row and nothing on screen said so, and the
// summary line left the player to divide a total by a duration themselves. Both are display
// changes rather than measurement changes: the two meters already agree on the denominator,
// since ours ends a fight at `lastEventAt` and the game's at `Math.max(1, lastActivity -
// startedAt)`, floor included.
describe('stating the rate', () => {
  it('states the rate on the summary line, beside the total and the duration', async () => {
    const h = await run();

    h.hit({ amount: 1000 });
    h.tick(4 * SECOND);
    h.hit({ amount: 1000 });
    h.tick(SECOND);

    expect(h.fight()).toBe('2,000 damage (400.0/s) in 5s');
  });

  // The floor the game applies to the same figure. A burst inside one second would otherwise
  // divide by a fraction and report a rate nobody sustained for any part of it.
  it('floors the duration at a second rather than reporting a burst rate', async () => {
    const h = await run();

    h.hit({ amount: 900 });
    h.tick(REPAINT_MS);

    expect(h.fight()).toBe('900 damage (900.0/s) in 1s');
  });

  // It serves all three tabs, so the noun changes and the rate has to stay right.
  it('states the rate on the healing and taken tabs too', async () => {
    const h = await run();
    h.heal({ amount: 400 });
    h.hit({ by: OTHER_ID, at: PLAYER_ID, amount: 800 });
    h.tick(2 * SECOND);

    h.openTab('Healing');
    expect(h.fight()).toContain('400 healing (200.0/s)');
    h.openTab('Taken');

    expect(h.fight()).toContain('800 taken (400.0/s)');
  });

  // A closed fight's rate is frozen with everything else, or it would keep falling against a
  // clock nobody started, which is the reading the duration freeze already exists to prevent.
  it('freezes the rate when the fight closes', async () => {
    const h = await run();
    h.hit({ amount: 1000 });

    h.tick(6 * SECOND);
    const frozen = h.fight();
    h.tick(60 * SECOND);

    expect(h.fight()).toBe(frozen);
    expect(frozen).toContain('(1,000.0/s)');
  });
});

// `overheal` is new on `heal2` in game 0.35.0 and is PARTIAL ONLY: every emit site still fires
// only when some healing landed, so a tick that overhealed completely sent no record at all
// and nothing here can see it. What ships is therefore a floor, marked as one, and no
// percentage anywhere: a percentage would divide by a total missing exactly the same ticks.
describe('overhealing', () => {
  it('reports overhealing on the row it was wasted from', async () => {
    const h = await run();

    h.heal({ amount: 300, overheal: 200 });
    h.tick();
    h.openTab('Healing');

    expect(h.detailOf('Mend Wounds')).toContain('200+ overhealed');
  });

  // The `+` is the whole of the honesty, so it is asserted rather than left to the phrasing.
  it('marks the figure as a floor rather than a total', async () => {
    const h = await run();

    h.heal({ amount: 300, overheal: 200 });
    h.heal({ amount: 100, overheal: 40 });
    h.tick();
    h.openTab('Healing');

    expect(h.detailOf('Mend Wounds')).toContain('240+ overhealed');
    expect(h.detailOf('Mend Wounds')).not.toMatch(/\d+% overheal/);
  });

  it('says in the tooltip what the figure cannot see', async () => {
    const h = await run();

    h.heal({ amount: 300, overheal: 200 });
    h.tick();
    h.openTab('Healing');

    expect(hover('Mend Wounds')).toContain('a fully wasted tick sends nothing');
  });

  // Absent rather than zero, so a heal that wasted none must not draw the clause at all.
  it('says nothing about overhealing on a heal that wasted none', async () => {
    const h = await run();

    h.heal({ amount: 300 });
    h.tick();
    h.openTab('Healing');

    expect(h.detailOf('Mend Wounds')).not.toContain('overhealed');
  });

  // It rides `heal2` alone, so a damage row can never grow the clause however the field moves.
  it('never reports overhealing on a damage row', async () => {
    const h = await run();

    h.hit({ amount: 300 });
    h.tick();

    expect(h.detailOf('Aimed Shot')).not.toContain('overhealed');
  });
});

describe('when a fight ends', () => {
  // `player.inCombat` is never sent to a client: it holds its constructed `false` for the
  // whole session, so deciding a fight is over from it ends every fight and resets the total
  // on every hit. The idle timeout is the whole of it.
  it('keeps one fight going across a lull shorter than the timeout', async () => {
    const h = await run();

    h.hit({ amount: 1000 });
    h.tick(4 * SECOND);
    h.hit({ amount: 1000 });
    h.tick(SECOND);

    expect(h.fight()).toContain('2,000 damage');
    expect(h.fight()).not.toContain('last fight');
  });

  // A fight average that kept falling while you read it would be answering a
  // question nobody asked: how long you have been standing still since.
  it('freezes once nothing has landed for the timeout', async () => {
    const h = await run();
    h.hit({ amount: 1000 });

    h.tick(6 * SECOND);
    const frozen = h.fight();
    h.tick(60 * SECOND);

    expect(h.fight()).toBe(frozen);
    expect(frozen).toContain('last fight');
  });

  // The duration runs to the last hit, not to the moment the timeout noticed, or
  // every fight would read the timeout longer than it was and every dps lower.
  it('does not count the idle timeout as fight time', async () => {
    const h = await run();

    h.hit({ amount: 1000 });
    h.tick(6 * SECOND);

    expect(h.fight()).toContain('in 1s');
  });

  // Minutes and seconds, the way the game's own meter reads them. Kept alive with a hit every
  // four seconds rather than one long jump, because a long jump closes the fight and freezes
  // the duration at the first hit.
  it('reads a long fight in minutes', async () => {
    const h = await run();

    for (let landed = 0; landed < 30; landed += 1) {
      h.hit({ amount: 100 });
      h.tick(4 * SECOND);
    }

    expect(h.fight()).toMatch(/in \d+m \d+s/);
    expect(h.fight()).not.toContain('last fight');
  });

  it('starts a new fight on the first hit after it ended', async () => {
    const h = await run();
    h.hit({ amount: 9000, ability: 'Aimed Shot' });
    h.tick(6 * SECOND);

    h.hit({ amount: 100, ability: 'Multi Shot' });
    h.tick();

    expect(h.fight()).toContain('100 damage');
    expect(h.labels()).toEqual(['Multi Shot']);
  });

  // The other way a fight ends: the player says so, mid-pull, because they want
  // the next thirty seconds measured rather than the last three minutes.
  it('starts a new fight on the reset keybind', async () => {
    const h = await run();
    h.hit({ amount: 9000 });
    h.tick();

    h.press('Alt+Shift+KeyD');
    h.frames.tick();

    expect(h.fight()).toContain('0 damage');
    expect(h.labels()).toEqual([]);
    expect(h.outcomes()).toBe('');
  });
});

describe('disabling it', () => {
  it('leaves no panel and no keybind behind', async () => {
    const h = await run();
    h.hit({ amount: 100 });
    h.tick();

    for (const stop of teardown.splice(0)) {
      stop();
    }

    expect(document.querySelectorAll('[data-woc-frame="meter"]')).toHaveLength(0);
    expect(Object.keys(h.shared.dispatcher.bindings())).toEqual([]);
  });

  // The interval is the one thing disposal has to reach that leaves no trace in
  // the DOM: a meter that kept repainting a removed panel would throw on every
  // tick for the rest of the session.
  it('stops repainting', async () => {
    const h = await run();
    for (const stop of teardown.splice(0)) {
      stop();
    }

    expect(() => h.tick(10 * SECOND)).not.toThrow();
    expect(h.fight()).toBe('');
  });
});

// Skill art is filed under an ability's id and a combat event carries its display name, and
// the two have diverged: `arcane_shot` is shown everywhere as "Fell Shot", so slugifying the
// name gives `fell_shot`, which is not a file. `world.abilities` runs the join backwards, and
// it covers the player's own kit, which is why the second case matters as much as the first: a
// mob's ability has no id to find, and drawing nothing is correct.
describe('ability art', () => {
  it('draws art from the ID for an ability the event named differently', async () => {
    const h = await run();

    h.hit({ ability: 'Fell Shot' });
    h.tick();

    const icon = rowFor('Fell Shot')?.querySelector('img.woc-bar-icon');
    // The id, never a slug of the name: `fell_shot` is not a file that exists.
    expect(icon?.getAttribute('src')).toContain('arcane_shot');
    expect(icon?.hasAttribute('hidden')).toBe(false);
  });

  it('draws none for an ability that is not the player own, which has no id to find', async () => {
    const h = await run();

    h.hit({ ability: 'Crushing Blow' });
    h.tick();

    const icon = rowFor('Crushing Blow')?.querySelector('img.woc-bar-icon');
    // No src at all rather than an empty one. An empty src resolves against the document base,
    // so writing one would point every art-less row at the game's own page.
    expect(icon?.hasAttribute('src')).toBe(false);
    expect(icon?.hasAttribute('hidden')).toBe(true);
  });

  // The names ARE right, and that is the half this addon has. It shows what the game
  // shows rather than a title-cased id, which is what Cooldown Bars is stuck with.
  it('shows the name the game uses rather than one derived from an id', async () => {
    const h = await run();

    h.hit({ ability: 'Fell Shot' });
    h.tick();

    expect(h.labels()).toEqual(['Fell Shot']);
  });
});

// `school` is the one identifying thing a damage event carries that does not depend on the
// ability id, so it tells apart the rows the art cannot reach, and the palette is the game's
// own. Deliberately not rank or share: the row already encodes rank by its position and share
// by its fill width, so colouring by either would be a third encoding of a fact already on
// screen, and rows would swap colours whenever the ranking shifted.
describe('colouring rows by school', () => {
  it('tints a row by the school the event reported', async () => {
    const h = await run();

    h.hit({ ability: 'Fell Shot', school: 'arcane' });
    h.tick();

    expect(rowFor('Fell Shot')?.classList.contains('woc-bar-school-arcane')).toBe(true);
  });

  // A row keeps its colour for the whole fight, which is the point of choosing school
  // over rank: an ability stays recognisable as its share moves around.
  it('keeps the first school it saw rather than recolouring per hit', async () => {
    const h = await run();
    h.hit({ ability: 'Fell Shot', school: 'arcane' });
    h.tick();

    h.hit({ ability: 'Fell Shot', school: 'fire' });
    h.tick();

    expect(rowFor('Fell Shot')?.classList.contains('woc-bar-school-arcane')).toBe(true);
    expect(rowFor('Fell Shot')?.classList.contains('woc-bar-school-fire')).toBe(false);
  });

  it('tells two abilities of different schools apart', async () => {
    const h = await run();

    h.hit({ ability: 'Fell Shot', school: 'arcane', amount: 500 });
    h.hit({ ability: 'Venom Barb', school: 'nature', amount: 300 });
    h.tick();

    expect(rowFor('Fell Shot')?.classList.contains('woc-bar-school-arcane')).toBe(true);
    expect(rowFor('Venom Barb')?.classList.contains('woc-bar-school-nature')).toBe(true);
  });

  // `heal2` carries no school at all, so a healing row has nothing true to pass and
  // must not borrow one. It gets the default fill.
  it('leaves a healing row untinted, because heal2 carries no school', async () => {
    const h = await run();
    h.heal({ ability: 'Mend Wounds' });
    h.tick();

    h.openTab('Healing');

    const healRow = rowFor('Mend Wounds');
    const tinted = [...(healRow?.classList ?? [])].some((n) => n.startsWith('woc-bar-school-'));

    expect(tinted).toBe(false);
  });

  // On Taken the school is the ATTACKER'S, which is the more useful reading there:
  // what kind of damage is landing on you.
  it('tints a taken row by the school that hit you', async () => {
    const h = await run();
    h.hit({ by: OTHER_ID, at: PLAYER_ID, ability: 'Shadow Bolt', school: 'shadow' });
    h.tick();

    h.openTab('Taken');

    expect(rowFor('Shadow Bolt')?.classList.contains('woc-bar-school-shadow')).toBe(true);
  });
});

// A hidden panel is not drawn to: twice a second is a sort of every ability plus a row update
// each, for the whole session. What must not stop is the tallying, which runs off the socket,
// or the fight timeout, which is what decides a fight has ended.
describe('a panel nobody can see', () => {
  it('keeps tallying while hidden and shows the fight when it comes back', async () => {
    const h = await run();

    h.togglePanel();
    h.hit({ amount: 500 });
    h.tick();
    expect(h.labels()).toEqual([]);

    h.togglePanel();

    expect(h.fight()).toContain('500 damage');
    expect(h.labels()).toEqual(['Aimed Shot']);
  });

  // The timeout has to keep running or a fight that ended while the panel was away
  // reopens looking live, with an average still decaying against a clock nobody
  // stopped.
  it('still ends the fight while hidden', async () => {
    const h = await run();

    h.hit();
    h.togglePanel();
    h.tick(SECOND * 10);
    h.togglePanel();

    expect(h.fight()).toContain('last fight');
  });

  // The whole point of the previous two together: a fight fought entirely with the
  // panel away is still there to read afterwards, rows and figures and all, rather
  // than only its summary line or nothing at all.
  it('shows a whole fight that happened and ended while it was away', async () => {
    const h = await run();

    h.togglePanel();
    h.hit({ ability: 'Fell Shot', amount: 300 });
    h.hit({ ability: 'Fell Shot', amount: 100 });
    h.hit({ ability: 'Melee', amount: 100 });
    h.tick(SECOND * 10);
    h.togglePanel();

    expect(h.fight()).toContain('500 damage');
    expect(h.fight()).toContain('last fight');
    expect(h.labels()).toEqual(['Fell Shot', 'Melee']);
    expect(h.figureOf('Fell Shot')).toContain('400');
    expect(h.detailOf('Fell Shot')).toContain('2 hits');
  });

  // The view FOLLOWS the newest fight rather than pinning to it, so a pull that starts while
  // the panel is away is what the panel is showing when it comes back. The fight before it is
  // not gone, which is what the strip is for; it is one page older.
  it('follows the new fight when one starts while hidden', async () => {
    const h = await run();

    h.hit({ ability: 'Fell Shot', amount: 300 });
    h.togglePanel();
    h.tick(SECOND * 10);
    h.hit({ ability: 'Melee', amount: 50 });
    h.togglePanel();

    expect(h.fight()).toContain('50 damage');
    expect(h.labels()).toEqual(['Melee']);

    h.stepFight('older');

    expect(h.fight()).toContain('300 damage');
    expect(h.labels()).toEqual(['Fell Shot']);
  });
});

// The fights it keeps, which is the whole of what the strip pages through. The cases here are
// about what a player can reach and what it is called, rather than about the array holding it.
describe('the fights it keeps', () => {
  /** One whole fight against the default target, closed by the idle timeout. */
  function fought(h: MeterHarness, ability: string, amount: number): void {
    h.hit({ ability, amount });
    h.tick(SECOND * 10);
  }

  /**
   * Change a setting the way the manager does, by writing the whole blob the loader hydrates
   * from. The fake hub echoes a local write as a change, so the addon's own handler runs.
   */
  async function changeSettings(h: MeterHarness, values: Record<string, unknown>): Promise<void> {
    await h.hub.set(configNamespace(FQID), SETTINGS_KEY, values);
    h.frames.tick();
  }

  it('offers no step before anything has been fought', async () => {
    const h = await run();

    expect(h.openFight()).toBe('Current');
    expect(h.canStep('older')).toBe(false);
    expect(h.canStep('newer')).toBe(false);
  });

  it('says which fight is open and where it sits', async () => {
    const h = await run();
    fought(h, 'Fell Shot', 300);
    fought(h, 'Aimed Shot', 200);

    // Two fights and the page that adds them up, newest first.
    expect(h.fightPosition()).toBe('1/3');

    h.stepFight('older');

    expect(h.fightPosition()).toBe('2/3');
    expect(h.fight()).toContain('300 damage');
  });

  // A fight is named after what was in it, because "Fight -3" is not a question anybody has.
  // Latched at record time: the mob is dead and gone from the snapshot by the time it is read.
  it('names a fight after the biggest mob in it', async () => {
    const h = await run();
    h.hit({ at: MOB_ID, amount: 100 });
    h.hit({ at: BOSS_ID, amount: 100 });
    h.tick(SECOND * 10);

    expect(h.openFight()).toBe(BOSS_NAME);
  });

  // Liveness beats the name on the page whose figures are still moving: whether what you are
  // reading is over is the thing to know first.
  it('calls the fight in progress the current one, named or not', async () => {
    const h = await run();
    h.hit({ at: MOB_ID, amount: 100 });
    h.tick();

    expect(h.openFight()).toBe('Current');

    h.tick(SECOND * 10);

    expect(h.openFight()).toBe(MOB_NAME);
  });

  // The pin is the page OBJECT rather than its index. A fight closing shifts every index
  // along, so a pin by number would move the player onto a different fight while they read.
  it('keeps the page under the player when another fight closes', async () => {
    const h = await run();
    fought(h, 'Fell Shot', 300);
    fought(h, 'Aimed Shot', 200);
    h.stepFight('older');
    expect(h.fight()).toContain('300 damage');
    expect(h.fightPosition()).toBe('2/3');

    fought(h, 'Melee', 50);

    // The same fight, one page further back, rather than whatever has taken page two.
    expect(h.fight()).toContain('300 damage');
    expect(h.fightPosition()).toBe('3/4');
  });

  // The last page is worked out from the fights still kept rather than run as a total of its
  // own, so it can never report more than the pages behind it can account for.
  it('adds the kept fights together on the last page', async () => {
    const h = await run();
    fought(h, 'Fell Shot', 300);
    fought(h, 'Melee', 100);

    h.stepFight('older');
    h.stepFight('older');

    expect(h.openFight()).toBe('All kept fights');
    expect(h.fight()).toContain('400 damage');
    expect(h.labels().sort(byName)).toEqual(['Fell Shot', 'Melee']);
    expect(h.canStep('older')).toBe(false);
  });

  it('drops the oldest fight once the cap is reached', async () => {
    const h = await run({ settings: { 'keep-fights': 2 } });
    fought(h, 'Fell Shot', 300);
    fought(h, 'Melee', 100);
    fought(h, 'Aimed Shot', 50);

    // Two fights and the page adding them up. The first is gone rather than unreachable.
    expect(h.fightPosition()).toBe('1/3');
    h.stepFight('older');
    expect(h.fight()).toContain('100 damage');
    h.stepFight('older');
    expect(h.fight()).toContain('150 damage');
  });

  // The pin can outlive its fight, and a view pointing at nothing has to land somewhere a
  // player recognises rather than on whichever fight has taken that index.
  it('takes the view back to the newest when the pinned fight ages out', async () => {
    const h = await run({ settings: { 'keep-fights': 2 } });
    fought(h, 'Fell Shot', 300);
    fought(h, 'Melee', 100);
    h.stepFight('older');
    expect(h.fight()).toContain('300 damage');

    fought(h, 'Aimed Shot', 50);

    expect(h.fight()).toContain('50 damage');
    expect(h.fightPosition()).toBe('1/3');
  });

  // Lowering the cap is a decision about what is kept, so it takes effect on the fights that
  // are already kept rather than at the end of the next fight.
  it('drops the fights a lowered cap no longer keeps', async () => {
    const h = await run();
    fought(h, 'Fell Shot', 300);
    fought(h, 'Melee', 100);
    fought(h, 'Aimed Shot', 50);
    expect(h.fightPosition()).toBe('1/4');

    await changeSettings(h, { 'keep-fights': 1 });

    expect(h.fightPosition()).toBe('1/2');
  });
});

// Kept fights outlive the page, which is the difference between this meter and the game's own.
// The write is per FIGHT rather than per hit, which is what the fight in progress being left
// out of the payload buys.
describe('what it keeps for the character', () => {
  function storedFights(storage: FakeStorage): unknown {
    return storage.dump()[`${characterNamespace(FQID)}/${FIGHTS_KEY}`];
  }

  /**
   * Let a per-character write settle. It awaits world entry and then the storage hub, so a
   * suite reading the store on the next line reads it before the write has been made.
   */
  async function settled(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  it('writes a fight down once it has closed', async () => {
    const storage = createFakeStorage();
    const h = await run({ storage });

    h.hit({ ability: 'Fell Shot', amount: 300, at: MOB_ID });
    h.tick(SECOND * 10);
    await settled();

    expect(storedFights(storage)).toMatchObject({
      version: 1,
      fights: [{ label: MOB_NAME, totals: { dealt: 300 } }],
    });
  });

  // Storing the fight in progress would be a write per hit to be worth anything, and a stale
  // copy read back after a reload would report a fight that never ended.
  it('leaves the fight in progress out of the store', async () => {
    const storage = createFakeStorage();
    const h = await run({ storage });

    h.hit({ ability: 'Fell Shot', amount: 300 });
    h.tick(SECOND * 10);
    h.hit({ ability: 'Melee', amount: 50 });
    h.tick();
    await settled();

    expect(storedFights(storage)).toMatchObject({ fights: [{ totals: { dealt: 300 } }] });
  });

  it('reads the fights back and pages into them', async () => {
    const storage = createFakeStorage();
    await storage.set(characterNamespace(FQID), FIGHTS_KEY, {
      version: 1,
      fights: [
        {
          at: 1,
          seconds: 10,
          label: BOSS_NAME,
          totals: { dealt: 1000, healed: 0, taken: 0 },
          tallies: {
            dealt: [{ label: 'Fell Shot', total: 1000, count: 4, crits: 1, biggest: 400 }],
            healed: [],
            taken: [],
          },
          outcomes: { hit: 4 },
        },
      ],
    });

    const h = await run({ storage });
    await settled();
    h.frames.tick();

    expect(h.openFight()).toBe(BOSS_NAME);
    expect(h.fight()).toContain('1,000 damage');
    expect(h.labels()).toEqual(['Fell Shot']);
    expect(h.detailOf('Fell Shot')).toContain('4 hits');
  });

  // A stored shape this version cannot read is dropped rather than thrown on: the alternative
  // is an addon that fails to start over a file it wrote itself.
  it('ignores a stored shape it does not recognise', async () => {
    const storage = createFakeStorage();
    await storage.set(characterNamespace(FQID), FIGHTS_KEY, { version: 99, fights: 'nonsense' });

    const h = await run({ storage });
    await settled();
    h.frames.tick();

    expect(h.openFight()).toBe('Current');
    expect(h.canStep('older')).toBe(false);
  });

  // Everything, rather than the fight in progress alone: leaving the kept fights behind would
  // leave the numbers the player asked to be rid of one press of the strip away.
  it('wipes the kept fights and what was written for them', async () => {
    const storage = createFakeStorage();
    const h = await run({ storage });
    h.hit({ ability: 'Fell Shot', amount: 300 });
    h.tick(SECOND * 10);
    await settled();

    h.reset();
    await settled();

    expect(h.canStep('older')).toBe(false);
    expect(h.fight()).toContain('0 damage');
    expect(storedFights(storage)).toBeUndefined();
  });
});
