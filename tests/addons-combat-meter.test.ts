// @vitest-environment happy-dom

// The Combat Meter, run through the real loader.
//
// It stopped being an example when it grew the per-ability breakdown, which is the
// one thing the game's own meter does not do, so the assertions are about the
// arithmetic a player would act on rather than about the addon loading.
//
// Three of these are here because the field they cover has already been wrong or
// is documented as a trap. `inCombat` is not on the wire, so the first version
// concluded every fight had ended and reset the total on every hit; the outcome
// line counts events the damage rows deliberately skip, since a miss is the whole
// reason it exists; and `heal2` carries `cueOnly` events that the game's own
// comment says a meter must ignore by the flag rather than by the amount.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MANIFEST_TEXT from '../addons/combat-meter/addon.json?raw';
// biome-ignore lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all. Same reason as the dev-harness suite.
import SOURCE from '../addons/combat-meter/main.js?raw';
import { loadAddon } from '../loader/src/runtime/loader.ts';
import type { InstalledAddon } from '../loader/src/shared/protocol.ts';
import { validateManifest } from '../loader/src/shared/schema.ts';
import { liveEntity } from './fakes/entity.ts';
import { eventsFrame, PLAYER_ENTITY } from './fakes/frames.ts';
import { createSharedServices, type SharedHarness } from './fakes/shared-services.ts';
import { createFakeStorage } from './fakes/storage.ts';

const FQID = 'official/combat-meter';
const MANIFEST_JSON: unknown = JSON.parse(MANIFEST_TEXT);
/** The fixture player's id, which is what an event's ids are matched against. */
const PLAYER_ID = PLAYER_ENTITY.id;
const MOB_ID = 9;
const OTHER_ID = PLAYER_ID + 1;
/** The addon's own repaint interval, so a suite can reach the next drawn number. */
const REPAINT_MS = 500;
const SECOND = 1000;

const teardown: Array<() => void> = [];

// Fake timers because the meter draws on an interval rather than on every hit: a
// repaint per damage event would be a layout write at the game's event rate. A
// suite that only landed a hit would be reading the panel from before it.
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
  const parsed = validateManifest(MANIFEST_JSON);
  if (!parsed.ok) {
    throw new Error(`the combat-meter manifest is invalid: ${JSON.stringify(parsed.issues)}`);
  }
  return parsed.value;
}

function row(): InstalledAddon {
  return { fqid: FQID, marketplace: 'official', manifest: manifest(), enabled: true, pin: null };
}

function textOf(selector: string): string {
  return document.querySelector(selector)?.textContent ?? '';
}

/** One damage event, with only the fields a caller cares about spelled out. */
interface Hit {
  amount?: number;
  ability?: string | null;
  by?: number;
  at?: number;
  kind?: string;
  crit?: boolean;
  absorbed?: number;
  school?: string;
}

/** One heal2 event, with only the fields a caller cares about spelled out. */
interface Heal {
  amount?: number;
  ability?: string;
  by?: number;
  at?: number;
  crit?: boolean;
  cueOnly?: boolean;
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
 * The ability on an event, where an explicit null is the auto-attack case.
 *
 * Not `?? 'Aimed Shot'`: that treats a deliberate null as absent, which is
 * exactly the case the Melee row exists for, and it silently made that test
 * assert the default instead.
 *
 * The values throughout this suite are DISPLAY NAMES, because that is what the wire
 * puts in this field: every `damage` and `heal2` emit fills it from `ability.name`,
 * and only `castStart` and `spellfx` carry the id. They used to be ids here and the
 * whole suite passed anyway, which is how the icon bug shipped: `readable()` turns
 * both forms into the same label, so no assertion about a row could tell them apart.
 * The icon is the only thing that can, which is why it is asserted below.
 */
function abilityOf(hit: Hit): string | null {
  if ('ability' in hit) {
    return hit.ability ?? null;
  }
  return 'Aimed Shot';
}

async function run(): Promise<MeterHarness> {
  const player = liveEntity({ set: { templateId: 'priest' } });
  const world = { entities: new Map([[PLAYER_ID, player]]), player };
  const harness = createSharedServices(document, createFakeStorage(), {
    game: Promise.resolve({ world }),
  });
  teardown.push(harness.dispose);
  const addon = await loadAddon({ shared: harness.shared, row: row(), source: SOURCE });
  teardown.push(addon.dispose);

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
      };
      harness.inbound(eventsFrame([event]));
    },
    tick: (ms = REPAINT_MS) => {
      harness.advance(ms);
      vi.advanceTimersByTime(ms);
    },
    fight: () => textOf('.woc-meter-total'),
    outcomes: () => textOf('.woc-meter-outcomes'),
    labels: () =>
      [...document.querySelectorAll('[data-ability]')].map(
        (el) => el.getAttribute('data-ability') ?? '',
      ),
    figureOf: (label) => rowFor(label)?.querySelector('.woc-bar-value')?.textContent ?? '',
    detailOf: (label) => rowFor(label)?.querySelector('.woc-bar-detail')?.textContent ?? '',
    openTab: (label) => {
      const button = [...document.querySelectorAll('.woc-meter-tab')].find(
        (el) => el.textContent === label,
      );
      (button as HTMLButtonElement | undefined)?.click();
    },
  };
}

describe('its manifest', () => {
  it('validates against the shared schema', () => {
    expect(validateManifest(MANIFEST_JSON).ok).toBe(true);
  });

  // Renamed from dps-meter, id and directory included, once the heal tab made
  // "DPS" wrong. That was only safe because nothing had shipped: an id is the
  // storage namespace and the keybind scope, so renaming a PUBLISHED one orphans
  // every installed player's settings, keybinds and window position. Pinned in
  // both places, since the id and the display name are separate decisions and the
  // failure worth catching is a manifest that still answers to the old one.
  it('is the combat meter in both its id and its name', () => {
    expect(manifest().id).toBe('combat-meter');
    expect(manifest().name).toBe('Combat Meter');
  });

  // The four surfaces it actually uses. A permission it does not need would be
  // asked of every player installing it, on a screen built to be read.
  it('declares exactly the permissions it uses', () => {
    expect(manifest().permissions).toEqual(['net.read', 'world.read', 'ui', 'keys']);
  });

  it('declares the keybinds it binds and the settings it reads', () => {
    expect((manifest().keybinds ?? []).map((bind) => bind.id).sort()).toEqual(['reset', 'toggle']);
    expect((manifest().settings ?? []).map((setting) => setting.id).sort()).toEqual([
      'fight-timeout',
      'max-rows',
      'show-detail',
      'show-outcomes',
    ]);
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

describe('the running total', () => {
  // The rolling per-second figure is gone. It was a single number that answered a
  // question the per-ability rates already answer per ability, and it made the
  // panel's loudest element the least specific thing in it.
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

    // 750 of 1000 over the one second elapsed.
    expect(h.figureOf('Aimed Shot')).toBe('750  75%  750.0');
    expect(h.figureOf('Multi Shot')).toBe('250  25%  250.0');
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

  // The documented trap. `cueOnly` events exist to drive a sound and carry no
  // healing, and the game's own comment says a meter must ignore them by the FLAG
  // rather than by the amount: a genuine direct heal can legitimately land at 0 on
  // a target already at full health, so inferring it from the amount drops those
  // real casts too.
  it('ignores a cue-only heal', async () => {
    const h = await run();

    h.heal({ amount: 0, cueOnly: true, ability: 'Renewal' });
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

describe('when a fight ends', () => {
  // The bug this suite exists for. The first version read `player.inCombat` to
  // decide a fight was over, and that field is never sent to a client: it holds
  // its constructed `false` for the whole session. So the meter concluded every
  // fight had ended and treated the next hit as a new one, resetting the total on
  // EVERY hit. Nothing in the addon looks at a combat flag now.
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

  // Minutes and seconds, the way the game's own meter reads them. A raw `102s`
  // is a number the player has to divide before it means anything.
  //
  // Kept alive with a hit every four seconds rather than one long jump, because
  // a long jump closes the fight and freezes the duration at the first hit.
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

// The rows carry NO ability art, and that is asserted rather than left implicit,
// because it is a decision someone will reasonably try to undo.
//
// Skill art is filed under an ability's ID and a combat event carries its display
// NAME, and the two have diverged in the game: `arcane_shot` is shown everywhere as
// "Fell Shot", so no derivation from the name reaches the art. A first version
// slugified the name and drew icons for the two hunter abilities whose names still
// happened to match their ids, which read as random rather than as a limitation.
//
// Cooldown Bars keeps its icons because a cooldown map is keyed by the id, which is
// also what the art is filed under. It pays for that on the other side, with a label
// derived from the id that may not be what the game calls the ability.
describe('the absence of ability art', () => {
  it('draws no icon, whatever the event named the ability', async () => {
    const h = await run();

    h.hit({ ability: 'Fell Shot' });
    h.tick();

    expect(rowFor('Fell Shot')?.querySelector('.woc-bar-icon[src]')).toBeNull();
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

// What replaced the icons. `school` is the one identifying thing a damage event carries
// that does not depend on the ability id, so it is what tells two rows apart now that
// the art cannot, and the palette is the game's own rather than one invented here.
//
// Deliberately NOT rank or share: the row already encodes rank by its position and
// share by its fill width, so colouring by either would be a third encoding of a fact
// already on screen, and rows would swap colours whenever the ranking shifted.
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
