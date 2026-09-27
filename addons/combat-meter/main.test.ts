// @vitest-environment happy-dom

// The Combat Meter, run through the real loader.
//
// The assertions pin the arithmetic a player acts on, including three traps: entity `inCombat` is
// not on the wire, so reading it ends every fight on every hit; the outcome line counts events the
// damage rows skip; and `heal2` `cueOnly` events are skipped by the flag, not the amount.

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

// Fake timers because the meter draws on an interval: a repaint per damage event would be a layout
// write at the game's event rate.
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
  /** The owner the RECORD carries, snapshotted at emit. */
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

/** Any total order will do: the sort makes the assertion order-free. */
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
 * One of the strip's two steps, found by the direction it moves rather than its glyph, which
 * someone may retype.
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
 * The ability on an event, where an explicit null is the auto-attack case (not `?? 'Aimed Shot'`,
 * which would erase it). Values are display names, as on the wire; ids would pass every row
 * assertion just as well, so the icon assertion is what tells them apart.
 */
function abilityOf(hit: Hit): string | null {
  if ('ability' in hit) {
    return hit.ability ?? null;
  }
  return 'Aimed Shot';
}

/**
 * A spellbook in the game's shape. `arcane_shot` is displayed as "Fell Shot", so an event names one
 * thing and the art is filed under another.
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
 * A pet: a mob-kind entity carrying an owner, which is the only thing separating it from any other
 * mob.
 */
function pet(id: number, name: string, ownerId: number): Record<string, unknown> {
  return liveEntity({ set: { id, name, kind: 'mob', templateId: 'wolf', ownerId } });
}

/**
 * A mob with no owner. `ownerId` stays null, which is "nobody" on the wire; a zero would make every
 * fixture mob the player's pet.
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
 * Start the addon and wait for its panel. A saved frame starts hidden until its per-character state
 * loads: a watcher sample, then a storage read.
 */
async function run(opts: RunOpts = {}): Promise<MeterHarness> {
  const player = liveEntity({ set: { templateId: 'priest' } });
  const entities = new Map([[PLAYER_ID, player]]);
  // Two pets in scope, told apart only by owner, which is all the server checks. Both are in every
  // case so a fixture cannot pass having seen only the friendly one.
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
  // Assigned only when there is one: `exactOptionalPropertyTypes` refuses an explicit undefined.
  // See STYLE.md.
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
  // The first draw is a `woc.paint` request made while hidden, so the loop performs it once the
  // restore shows the panel.
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
      // The interval only ASKS for a repaint through `woc.paint`; the loop performs it. A real
      // browser runs this frame unprompted.
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
    // Selected inside the meter's strip by the kit's class: the buttons are the loader's, and the
    // addon marks only the strip.
    openTab: (label) => {
      const button = [...document.querySelectorAll('.woc-meter-tabs .woc-tab')].find(
        (el) => el.textContent === label,
      );
      (button as HTMLButtonElement | undefined)?.click();
      harness.frames.tick();
    },
    // The default bind pressed at the dispatcher, the path a player takes.
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

// The two kit surfaces the meter uses: the tab strip, which owns which tab is marked, and the
// tooltip, a function so a row reports the tally as it is now.
describe('what it takes from the kit', () => {
  it('draws its tabs with the loader strip rather than its own buttons', async () => {
    await run();

    // A nav of kit tabs, marked the way the manager's own strip is.
    expect(document.querySelectorAll('.woc-meter-tabs .woc-tab')).toHaveLength(3);
    expect(document.querySelector('.woc-meter-tabs .woc-tab-active')?.textContent).toBe('Damage');
  });

  it('lets the strip own which tab is marked', async () => {
    const h = await run();

    h.openTab('Healing');

    expect(document.querySelector('.woc-meter-tabs .woc-tab-active')?.textContent).toBe('Healing');
  });

  // The row is hovered long after it was built, so the tooltip reports the tally now.
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

  // A row with no art is one this character did not cast; the empty slot alone cannot say that.
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

  // The id is the storage namespace and keybind scope, so renaming a published one orphans every
  // player's settings. Pinned separately from the display name.
  it('is the combat meter in both its id and its name', () => {
    expect(manifest().id).toBe('combat-meter');
    expect(manifest().name).toBe('Combat Meter');
  });

  // The five surfaces it uses, and no more. `storage` holds the kept fights, per character.
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

  // The smallest minor carrying EVERY published member read: `closable` at 2;
  // `Heal2Event.overheal`, `ui.list`, `woc.paint` and `toggleKey` at 4; `DamageEvent.sourceOwnerId`
  // at 5. An event field counts as much as a function: under-declaring fails silently (an older
  // loader passes `sourceOwnerId` through unread and pet damage drops), where over-declaring fails
  // with a message.
  //
  // `woc.fmt.duration` is refused; the reason is on the function in main.js.
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

  // Before anything lands there is nothing to report; NaN or the last session's numbers would read
  // as broken.
  it('starts at zero with no rows', async () => {
    const h = await run();

    expect(h.fight()).toContain('0 damage');
    expect(h.labels()).toEqual([]);
  });
});

// A frame, not a window, and the ARIA role decides it: a window is a `dialog` the player opened, a
// frame is a `group` of HUD furniture. The close button and density do not separate them
// (`closable` works on either; a window refuses only `bare`). Pinned because both calls take the
// same options.
describe('the kind of panel it is', () => {
  function panel(): Element | null {
    return document.querySelector('[data-woc-frame="meter"]');
  }

  it('is a frame rather than a window', async () => {
    await run();

    expect(panel()?.classList.contains('woc-chrome-frame')).toBe(true);
    expect(panel()?.classList.contains('woc-chrome-window')).toBe(false);
  });

  // The role is the half of the distinction actually announced.
  it('announces itself as HUD furniture rather than as a dialog', async () => {
    await run();

    expect(panel()?.getAttribute('role')).toBe('group');
  });

  // A frame gets a close button only when it asks, and this one does: the keybind is the fast
  // route, the button the discoverable one. The rail button's window menu brings it back.
  it('carries the close button it asked for, and hiding it is what the button does', async () => {
    await run();
    const close = panel()?.querySelector('.woc-close');
    expect(close).not.toBeNull();
    expect(panel()?.classList.contains('woc-hidden')).toBe(false);

    (close as HTMLButtonElement).click();

    expect(panel()?.classList.contains('woc-hidden')).toBe(true);
  });

  // A compact frame keeps its title bar; only `bare` drops it.
  it('keeps the title bar it is named and dragged by', async () => {
    await run();

    expect(panel()?.querySelector('.woc-titlebar')).not.toBeNull();
    expect(panel()?.querySelector('.woc-title')?.textContent).toBe('Combat');
  });

  // Unstated density falls back to comfortable, whose 40px floor is right for a form and too loud
  // for a dense readout.
  it('says compact rather than falling back to the accessible default', async () => {
    await run();

    expect(panel()?.classList.contains('woc-density-compact')).toBe(true);
  });
});

describe('the running total', () => {
  // A single rolling figure repeats what the per-ability rates say and becomes the loudest, least
  // specific element.
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

  // The filter that makes it YOUR meter: otherwise every other player in range inflates the number.
  it('ignores damage somebody else dealt to somebody else', async () => {
    const h = await run();

    h.hit({ amount: 600, by: OTHER_ID });
    h.tick();

    expect(h.fight()).toContain('0 damage');
    expect(h.labels()).toEqual([]);
  });

  // The total is the fight's, so it accumulates rather than decaying.
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
  it('opens a row per ability, named as the event names it', async () => {
    const h = await run();

    h.hit({ ability: 'Aimed Shot' });
    h.hit({ ability: 'Multi Shot' });
    h.tick();

    expect(h.labels().sort(byName)).toEqual(['Aimed Shot', 'Multi Shot']);
  });

  // An auto-attack arrives with no ability and is a real share of the total.
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

    // 750 of 1000 over one second. The rate carries its unit, or three bare numbers leave the
    // reader guessing.
    expect(h.figureOf('Aimed Shot')).toBe('750  75%  750.0/s');
    expect(h.figureOf('Multi Shot')).toBe('250  25%  250.0/s');
  });

  // The four figures the game shows nowhere; crit rate shows what a talent or gear change did.
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

  // A hit a shield ate whole is a `hit` at 0, and `kind` tells it from a miss. It happened, so it
  // reaches the table with the absorbed figure.
  it('records a hit a shield ate whole', async () => {
    const h = await run();

    h.hit({ amount: 0, absorbed: 400 });
    h.tick();

    expect(h.labels()).toEqual(['Aimed Shot']);
    expect(h.detailOf('Aimed Shot')).toContain('400 absorbed');
  });

  // The kit's half: a row reading 0 of 0 has no denominator when everything was absorbed, and must
  // draw as an empty bar.
  it('draws a fully absorbed row as an empty bar rather than a full one', async () => {
    const h = await run();

    h.hit({ amount: 0, absorbed: 400 });
    h.tick();

    expect(h.figureOf('Aimed Shot')).toBe('0  0%  0.0/s');
    expect(fillWidthOf('Aimed Shot')).toBe('0.00%');
  });
});

describe('the outcome line', () => {
  // A miss deals nothing, so it never reaches a damage row; this line is the only place the rate
  // shows.
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

  // `evade` is a mob refusing the hit while immune (leashing home, or pinned in an instance it
  // cannot path through), a real outcome of your swing. It must be counted and named: the line
  // divides by every outcome recorded, so an unlisted one shrinks every percentage.
  it('names an evade rather than only deflating the rest', async () => {
    const h = await run();

    h.hit({ amount: 100 });
    h.hit({ amount: 0, kind: 'evade' });
    h.tick();

    expect(h.outcomes()).toBe('hit 50%, evade 50%');
  });

  // An evade always lands at 0, so it must never open a damage row or move the total.
  it('opens no damage row for an evade', async () => {
    const h = await run();

    h.hit({ amount: 0, kind: 'evade', ability: 'Aimed Shot' });
    h.tick();

    expect(h.labels()).toEqual([]);
    expect(h.fight()).toContain('0 damage');
  });

  // Damage taken is the mob's outcome, not yours; counting it would make a tank look like they
  // never connect.
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

  // Separate tallies, or the mirror case double-counts.
  it('keeps the two directions apart', async () => {
    const h = await run();
    h.hit({ ability: 'Aimed Shot', amount: 100 });
    h.hit({ by: OTHER_ID, at: PLAYER_ID, amount: 500, ability: 'Cleave' });
    h.tick();

    expect(h.labels()).toEqual(['Aimed Shot']);
    h.openTab('Taken');

    expect(h.labels()).toEqual(['Cleave']);
  });

  // A hit your shield ate whole landed nothing and still happened; dropping it would make an absorb
  // look like a miss.
  it('records a hit on you that a shield ate whole', async () => {
    const h = await run();

    h.hit({ by: OTHER_ID, at: PLAYER_ID, amount: 0, absorbed: 400, ability: 'Cleave' });
    h.tick();

    h.openTab('Taken');

    expect(h.labels()).toEqual(['Cleave']);
    expect(h.detailOf('Cleave')).toContain('400 absorbed');
  });

  // One direction per tab, or everyone who never gets hit reads a "0 taken".
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
  // `heal2`, not `heal`: only the former carries a `sourceId`.
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

  // `cueOnly` events drive a sound and carry no healing. The game says to ignore them by the flag:
  // a real direct heal can land at 0 on a full target.
  it('ignores a cue-only heal', async () => {
    const h = await run();

    h.heal({ amount: 0, cueOnly: true, ability: 'Renewal' });
    h.tick();
    h.openTab('Healing');

    expect(h.labels()).toEqual([]);
    expect(h.fight()).toContain('0 healing');
  });

  // A heal-absorb shield eats part of a heal, reported by the same field as on `damage`. The total
  // stays what landed; the absorbed figure rides the detail line.
  it('adds absorbed healing to the row a shield ate part of', async () => {
    const h = await run();

    h.heal({ amount: 300, absorbed: 200 });
    h.tick();
    h.openTab('Healing');

    expect(h.figureOf('Mend Wounds')).toContain('300');
    expect(h.detailOf('Mend Wounds')).toContain('200 absorbed');
  });

  // A devoured heal and an overheal both land at `amount: 0`, and only `absorbed` parts them: one
  // is a target at low health being eaten, the other a cast on somebody full.
  it('records a heal a shield ate whole, which lands at zero', async () => {
    const h = await run();

    h.heal({ amount: 0, absorbed: 500 });
    h.tick();
    h.openTab('Healing');

    expect(h.labels()).toEqual(['Mend Wounds']);
    expect(h.detailOf('Mend Wounds')).toContain('500 absorbed');
  });

  // The other `amount: 0`, which stays out: nothing was absorbed, so the target was full.
  it('records nothing for a heal that only overhealed', async () => {
    const h = await run();

    h.heal({ amount: 0 });
    h.tick();
    h.openTab('Healing');

    expect(h.labels()).toEqual([]);
  });

  // `cueOnly` and a fully absorbed heal both read `amount: 0`, so the flag must be read first. The
  // pairing is not something the wire sends; it pins the order of the two guards.
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

  // Three separate tallies, or a heal lands in the damage table.
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

  // The attack table is about your damage: meaningless on Healing, and on Taken it would read as
  // the attacker's outcomes.
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

  // A healer may deal and take nothing all encounter, so a heal must open a fight.
  it('opens a fight on a heal alone', async () => {
    const h = await run();

    h.heal({ amount: 400 });
    h.tick();
    h.openTab('Healing');

    expect(h.fight()).not.toContain('last fight');
  });

  // And keep one alive, or a healer's fight closes mid-encounter.
  it('keeps a fight alive on healing alone', async () => {
    const h = await run();
    h.hit({ amount: 100 });

    h.tick(4 * SECOND);
    h.heal({ amount: 100 });
    h.tick(4 * SECOND);

    expect(h.fight()).not.toContain('last fight');
  });
});

// A pet's damage is the owner's: the server delivers your pet's records to you, and matching a raw
// `sourceId` against your id silently undercounts every pet class. `ownerId` is all that separates
// a pet from other mobs, so the second case matters as much: folding in every owned entity makes a
// zone-wide display.
describe('what your pet did', () => {
  it('counts a hit your own pet dealt', async () => {
    const h = await run();

    h.hit({ by: PET_ID, amount: 400, ability: null });
    h.tick();

    expect(h.fight()).toContain('400 damage');
  });

  // The row says whose it was; otherwise the pet's melee shares your auto-attack bucket. `{pet}:
  // {ability}` is the game's own spelling.
  it('labels a pet row with the pet name', async () => {
    const h = await run();

    h.hit({ by: PET_ID, amount: 400, ability: null });
    h.tick();

    expect(h.labels()).toEqual([`${PET_NAME}: Melee`]);
  });

  // A stranger's pet is delivered the same way and resolves to someone else.
  it("ignores a hit somebody else's pet dealt", async () => {
    const h = await run();

    h.hit({ by: STRANGER_PET_ID, amount: 400, ability: null });
    h.tick();

    expect(h.fight()).toContain('0 damage');
    expect(h.labels()).toEqual([]);
  });

  // A pet gone from the snapshot, on a record with no owner, has nothing to attribute from; it
  // degrades rather than throwing.
  it('drops a pet event whose entity is gone and whose record says nothing', async () => {
    const h = await run();

    expect(() => h.hit({ by: GHOST_PET_ID, amount: 400, ability: null })).not.toThrow();
    h.tick();

    expect(h.fight()).toContain('0 damage');
    expect(h.labels()).toEqual([]);
  });

  // The case the snapshot lookup cannot answer: a pet despawns when its owner dies, so the killing
  // exchange's source is gone. The record's owner answers it.
  it('counts a despawned pet hit from the owner the record carries', async () => {
    const h = await run();

    h.hit({ by: GHOST_PET_ID, owner: PLAYER_ID, amount: 400, ability: null });
    h.tick();

    expect(h.fight()).toContain('400 damage');
  });

  // The name is unrecoverable once the entity is gone, so the row takes the generic label rather
  // than landing in your auto-attack bucket.
  it('labels a despawned pet row generically rather than as your own', async () => {
    const h = await run();

    h.hit({ by: GHOST_PET_ID, owner: PLAYER_ID, amount: 400, ability: null });
    h.tick();

    expect(h.labels()).toEqual(['Pet: Melee']);
  });

  // The record's owner is asked AGAINST you: a stranger's pet carries an owner id too.
  it('ignores a despawned pet whose record names somebody else as owner', async () => {
    const h = await run();

    h.hit({ by: GHOST_PET_ID, owner: OTHER_ID, amount: 400, ability: null });
    h.tick();

    expect(h.fight()).toContain('0 damage');
    expect(h.labels()).toEqual([]);
  });

  // Attribution does not change the attack table: a pet's swing rolls against the PET's hit rating
  // either way.
  it('keeps a despawned pet swing out of your attack table', async () => {
    const h = await run();

    h.hit({ amount: 100 });
    h.hit({ by: GHOST_PET_ID, owner: PLAYER_ID, amount: 0, kind: 'miss', ability: null });
    h.tick();

    expect(h.outcomes()).toBe('hit 100%');
  });

  // A pet's swing rolls against the PET's hit rating; blending it would make both tables
  // unreadable, the same reason damage taken is excluded.
  it('keeps a pet swing out of your attack table', async () => {
    const h = await run();

    h.hit({ amount: 100 });
    h.hit({ by: PET_ID, amount: 0, kind: 'miss', ability: null });
    h.tick();

    expect(h.outcomes()).toBe('hit 100%');
  });

  // Damage your pet takes is shown. The prefix names who it landed ON, since the ability is the
  // attacker's.
  it('attributes damage taken by your pet', async () => {
    const h = await run();

    h.hit({ by: MOB_ID, at: PET_ID, amount: 250, ability: 'Cleave' });
    h.tick();
    h.openTab('Taken');

    expect(h.labels()).toEqual([`${PET_NAME}: Cleave`]);
    expect(h.fight()).toContain('250 taken');
  });

  it("ignores damage taken by somebody else's pet", async () => {
    const h = await run();

    h.hit({ by: MOB_ID, at: STRANGER_PET_ID, amount: 250, ability: 'Cleave' });
    h.tick();
    h.openTab('Taken');

    expect(h.labels()).toEqual([]);
  });

  // Demon Heal carries the OWNER as `sourceId` and targets the pet, so the row stays unprefixed: on
  // this tab the prefix names the caster.
  it('files a heal you cast on your pet under your own name', async () => {
    const h = await run();

    h.heal({ at: PET_ID, amount: 300, ability: 'Demon Heal' });
    h.tick();
    h.openTab('Healing');

    expect(h.labels()).toEqual(['Demon Heal']);
    expect(h.fight()).toContain('300 healing');
  });

  // No pet ability has art by any route: none is in a spellbook, and a swing carries no name. The
  // tooltip gives a pet row its own reason.
  it('draws no art for a pet row and names the pet in its tooltip', async () => {
    const h = await run();

    h.hit({ by: PET_ID, amount: 400, ability: 'Bite' });
    h.tick();

    const icon = rowFor(`${PET_NAME}: Bite`)?.querySelector('img.woc-bar-icon');
    expect(icon?.hasAttribute('src')).toBe(false);
    expect(hover(`${PET_NAME}: Bite`)).toContain(`your pet ${PET_NAME}`);
  });

  // The pet's rows and yours share one total, so the share column answers how much of your output
  // was the pet.
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

// The rate column and summary say "per second" now. The denominator already matches the game's: a
// fight ends at `lastEventAt`, the game's at `Math.max(1, lastActivity - startedAt)`, floor
// included.
describe('stating the rate', () => {
  it('states the rate on the summary line, beside the total and the duration', async () => {
    const h = await run();

    h.hit({ amount: 1000 });
    h.tick(4 * SECOND);
    h.hit({ amount: 1000 });
    h.tick(SECOND);

    expect(h.fight()).toBe('2,000 damage (400.0/s) in 5s');
  });

  // The game's floor on the same figure: a sub-second burst would otherwise report a rate nobody
  // sustained.
  it('floors the duration at a second rather than reporting a burst rate', async () => {
    const h = await run();

    h.hit({ amount: 900 });
    h.tick(REPAINT_MS);

    expect(h.fight()).toBe('900 damage (900.0/s) in 1s');
  });

  // It serves all three tabs, so the noun changes and the rate stays right.
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

  // A closed fight's rate is frozen with everything else, or it falls against a clock nobody
  // started.
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

// `overheal` on `heal2` is PARTIAL ONLY: a tick that overhealed completely sends no record. So it
// ships as a marked floor, with no percentage, which would divide by a total missing the same
// ticks.
describe('overhealing', () => {
  it('reports overhealing on the row it was wasted from', async () => {
    const h = await run();

    h.heal({ amount: 300, overheal: 200 });
    h.tick();
    h.openTab('Healing');

    expect(h.detailOf('Mend Wounds')).toContain('200+ overhealed');
  });

  // The `+` is the whole of the honesty, so it is asserted.
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

  // Absent rather than zero, so a heal that wasted none draws no clause.
  it('says nothing about overhealing on a heal that wasted none', async () => {
    const h = await run();

    h.heal({ amount: 300 });
    h.tick();
    h.openTab('Healing');

    expect(h.detailOf('Mend Wounds')).not.toContain('overhealed');
  });

  // It rides `heal2` alone, so a damage row never grows the clause.
  it('never reports overhealing on a damage row', async () => {
    const h = await run();

    h.hit({ amount: 300 });
    h.tick();

    expect(h.detailOf('Aimed Shot')).not.toContain('overhealed');
  });
});

describe('when a fight ends', () => {
  // Entity `inCombat` is never sent and holds its constructed `false`, so reading it ends every
  // fight on every hit. The idle timeout is the whole of it.
  it('keeps one fight going across a lull shorter than the timeout', async () => {
    const h = await run();

    h.hit({ amount: 1000 });
    h.tick(4 * SECOND);
    h.hit({ amount: 1000 });
    h.tick(SECOND);

    expect(h.fight()).toContain('2,000 damage');
    expect(h.fight()).not.toContain('last fight');
  });

  // An average that kept falling while you read it would measure how long you have been standing
  // still.
  it('freezes once nothing has landed for the timeout', async () => {
    const h = await run();
    h.hit({ amount: 1000 });

    h.tick(6 * SECOND);
    const frozen = h.fight();
    h.tick(60 * SECOND);

    expect(h.fight()).toBe(frozen);
    expect(frozen).toContain('last fight');
  });

  // The duration runs to the last hit, not to when the timeout noticed.
  it('does not count the idle timeout as fight time', async () => {
    const h = await run();

    h.hit({ amount: 1000 });
    h.tick(6 * SECOND);

    expect(h.fight()).toContain('in 1s');
  });

  // Minutes and seconds, as the game's meter reads them. Kept alive with a hit every four seconds,
  // since one long jump closes the fight.
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

  // The other way a fight ends: the player resets mid-pull to measure what comes next.
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

  // The interval leaves no trace in the DOM; left running, it would throw on every tick against a
  // removed panel.
  it('stops repainting', async () => {
    const h = await run();
    for (const stop of teardown.splice(0)) {
      stop();
    }

    expect(() => h.tick(10 * SECOND)).not.toThrow();
    expect(h.fight()).toBe('');
  });
});

// Art is filed under the id and events carry the display name: `arcane_shot` is "Fell Shot", so
// slugifying gives `fell_shot`, which is no file. `world.abilities` runs the join backwards for the
// player's own kit; a mob's ability has no id to find, and drawing nothing is correct.
describe('ability art', () => {
  it('draws art from the ID for an ability the event named differently', async () => {
    const h = await run();

    h.hit({ ability: 'Fell Shot' });
    h.tick();

    const icon = rowFor('Fell Shot')?.querySelector('img.woc-bar-icon');
    // The id, never a slug of the name.
    expect(icon?.getAttribute('src')).toContain('arcane_shot');
    expect(icon?.hasAttribute('hidden')).toBe(false);
  });

  it("draws none for an ability outside the player's spellbook", async () => {
    const h = await run();

    h.hit({ ability: 'Crushing Blow' });
    h.tick();

    const icon = rowFor('Crushing Blow')?.querySelector('img.woc-bar-icon');
    // No src rather than an empty one, which would resolve against the document and point every
    // art-less row at the game's page.
    expect(icon?.hasAttribute('src')).toBe(false);
    expect(icon?.hasAttribute('hidden')).toBe(true);
  });

  // The names are what the game shows rather than a title-cased id.
  it('shows the name the game uses rather than one derived from an id', async () => {
    const h = await run();

    h.hit({ ability: 'Fell Shot' });
    h.tick();

    expect(h.labels()).toEqual(['Fell Shot']);
  });
});

// `school` is the one identifying field that does not depend on the id, so it marks rows art cannot
// reach, in the game's palette. Not rank or share: position and fill width already encode those,
// and rows would swap colours as the ranking shifted.
describe('colouring rows by school', () => {
  it('tints a row by the school the event reported', async () => {
    const h = await run();

    h.hit({ ability: 'Fell Shot', school: 'arcane' });
    h.tick();

    expect(rowFor('Fell Shot')?.classList.contains('woc-bar-school-arcane')).toBe(true);
  });

  // A row keeps its colour all fight, so an ability stays recognisable as its share moves.
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

  // `heal2` carries no school, so a healing row gets the default fill.
  it('leaves a healing row untinted, because heal2 carries no school', async () => {
    const h = await run();
    h.heal({ ability: 'Mend Wounds' });
    h.tick();

    h.openTab('Healing');

    const healRow = rowFor('Mend Wounds');
    const tinted = [...(healRow?.classList ?? [])].some((n) => n.startsWith('woc-bar-school-'));

    expect(tinted).toBe(false);
  });

  // On Taken the school is the ATTACKER'S: what kind of damage is landing on you.
  it('tints a taken row by the school that hit you', async () => {
    const h = await run();
    h.hit({ by: OTHER_ID, at: PLAYER_ID, ability: 'Shadow Bolt', school: 'shadow' });
    h.tick();

    h.openTab('Taken');

    expect(rowFor('Shadow Bolt')?.classList.contains('woc-bar-school-shadow')).toBe(true);
  });
});

// A hidden panel is not drawn to. The tallying, which runs off the socket, and the fight timeout
// keep running.
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

  // The timeout must keep running, or a fight that ended while the panel was away reopens looking
  // live.
  it('still ends the fight while hidden', async () => {
    const h = await run();

    h.hit();
    h.togglePanel();
    h.tick(SECOND * 10);
    h.togglePanel();

    expect(h.fight()).toContain('last fight');
  });

  // A fight fought entirely with the panel away is still there to read afterwards, rows and all.
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

  // The view FOLLOWS the newest fight, so a pull started while the panel was away is what shows on
  // return; the fight before it is one page older.
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

// The kept fights: what a player can reach through the strip and what each is called.
describe('the fights it keeps', () => {
  /** One whole fight against the default target, closed by the idle timeout. */
  function fought(h: MeterHarness, ability: string, amount: number): void {
    h.hit({ ability, amount });
    h.tick(SECOND * 10);
  }

  /**
   * Change a setting as the manager does, by writing the whole blob. The fake hub echoes a local
   * write as a change.
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

  // A fight is named after what was in it, latched at record time since the mob is gone by the time
  // it is read.
  it('names a fight after the biggest mob in it', async () => {
    const h = await run();
    h.hit({ at: MOB_ID, amount: 100 });
    h.hit({ at: BOSS_ID, amount: 100 });
    h.tick(SECOND * 10);

    expect(h.openFight()).toBe(BOSS_NAME);
  });

  // On the page still being fought, liveness beats the name.
  it('calls the fight in progress the current one, named or not', async () => {
    const h = await run();
    h.hit({ at: MOB_ID, amount: 100 });
    h.tick();

    expect(h.openFight()).toBe('Current');

    h.tick(SECOND * 10);

    expect(h.openFight()).toBe(MOB_NAME);
  });

  // The pin is the page OBJECT: a closing fight shifts every index, so a numeric pin would move the
  // player onto another fight.
  it('keeps the page under the player when another fight closes', async () => {
    const h = await run();
    fought(h, 'Fell Shot', 300);
    fought(h, 'Aimed Shot', 200);
    h.stepFight('older');
    expect(h.fight()).toContain('300 damage');
    expect(h.fightPosition()).toBe('2/3');

    fought(h, 'Melee', 50);

    // The same fight, one page further back, rather than whatever took page two.
    expect(h.fight()).toContain('300 damage');
    expect(h.fightPosition()).toBe('3/4');
  });

  // The last page is derived from the kept fights, so it never reports more than they account for.
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

    // The first fight is gone rather than unreachable.
    expect(h.fightPosition()).toBe('1/3');
    h.stepFight('older');
    expect(h.fight()).toContain('100 damage');
    h.stepFight('older');
    expect(h.fight()).toContain('150 damage');
  });

  // A pin that outlives its fight lands on the newest rather than whatever took its index.
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

  // Lowering the cap applies to fights already kept, now.
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

// Kept fights outlive the page, written once per FIGHT because the live one is left out.
describe('what it keeps for the character', () => {
  function storedFights(storage: FakeStorage): unknown {
    return storage.dump()[`${characterNamespace(FQID)}/${FIGHTS_KEY}`];
  }

  /** Let a per-character write settle: it awaits world entry and then the storage hub. */
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

  // Storing the live fight would be a write per hit, and a stale copy read after a reload would
  // report a fight that never ended.
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

  // A stored shape this version cannot read is dropped, not thrown on, or the addon fails to start
  // over its own file.
  it('ignores a stored shape it does not recognise', async () => {
    const storage = createFakeStorage();
    await storage.set(characterNamespace(FQID), FIGHTS_KEY, { version: 99, fights: 'nonsense' });

    const h = await run({ storage });
    await settled();
    h.frames.tick();

    expect(h.openFight()).toBe('Current');
    expect(h.canStep('older')).toBe(false);
  });

  // Everything, not only the live fight, or the numbers the player asked to be rid of stay one
  // press away.
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
