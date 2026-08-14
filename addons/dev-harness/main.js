/// <reference types="@woc-addons/types" />

// Dev Harness: run every part of the addon API against the real game and say what worked.
//
// An ordinary addon with no access to anything the loader does not publish, which is what
// makes it worth having: if a surface can be checked from here, it can be checked by
// anyone's addon. It catches the two failures a unit suite cannot, a live game that is
// not the shape the fakes assume and a surface never wired to the object an addon is
// handed.
//
// It never touches the game's state: everything here reads, renders into the loader's own
// root, or plays a sound.

const CHECK_TIMEOUT_MS = 3000;
/** Long enough that one player action repaints once, short enough to feel live. */
const REFRESH_DEBOUNCE_MS = 150;
const COPPER_PER_SILVER = 100;
const COPPER_PER_GOLD = 10_000;
const TOAST_MS = 2500;
const BANNER_MS = 2000;
const MS_PER_SECOND = 1000;
/** How long the bar demonstration takes to drain. */
const DEMO_SECONDS = 4;
const DEMO_WIDTH = 190;
/** Under this share left the kit draws a bar warm, which the demo shows off. */
const DEMO_WARN = 0.25;
/** How far above a unit's own point its plate floats, in screen pixels. */
const PLATE_LIFT = 48;
/** How often the anchor demo rewrites its labels. Its POSITION is the loader's job. */
const ANCHOR_TICK_MS = 200;
const DECIMALS_YARDS = 1;
/** How many distinct wire contradictions to name before the note gets unreadable. */
const MAX_CONTRADICTIONS = 3;
/** Negative, because the server issues no such id and every roster answer for it is a null. */
const NO_SUCH_ENTITY = -1;
/** Every answer `world.reaction` is allowed to give for a unit that exists. */
const REACTIONS = ['hostile', 'friendly', 'neutral'];
/**
 * A frame is 16 ms, so past this is a document with no loop rather than a slow one, and
 * the report must not sit on "running the checks" waiting for one.
 */
const PAINT_WAIT_MS = 250;
/** How many rows the list probe draws, and how many it holds while drawing them. */
const LIST_BUDGET = 2;
const LIST_ROWS = 3;
/**
 * What the formatting check puts through. The two that look like typos are the cases
 * worth having: 59.5 reads as `60` rather than `1m`, since the minute branch is chosen on
 * the raw value and the ceiling lands after it, and 3720 is an hour and two minutes.
 */
const FMT_INPUT = {
  seconds: 45,
  nearlyAMinute: 59.5,
  minutes: 90,
  anHour: 3720,
  one: 1,
  many: 4,
  pair: 2,
  /** Read as a figure and never as an absence, which is the case below that says so. */
  zero: 0,
};

/** A quarter turn, which is where the sign convention is either right or backwards. */
const QUARTER_TURN_DEGREES = 90;

/** Straight ahead, a right turn and a left one, which are the three a reader can check. */
const COMPASS_CASES = [
  ['ahead', FMT_INPUT.zero, '↑'],
  ['to the right', QUARTER_TURN_DEGREES, '→'],
  ['to the left', -QUARTER_TURN_DEGREES, '←'],
];
/** How far east of the player the geometry probe measures, and what counts as agreement. */
const PROBE_YARDS = 10;
const PROBE_TOLERANCE = 0.01;

/**
 * The three squares the tile demonstration drains: label, ability, class, school. The last
 * one names an ability nothing ships art for, so its slot collapses and the square is left
 * with its wedge and its figures on nothing, which is the case a cooldown display meets
 * constantly.
 */
const DEMO_TILES = [
  ['Fireball', 'fireball', 'mage', 'fire'],
  ['Frostbolt', 'frostbolt', 'mage', 'frost'],
  ['Nothing painted', 'not_an_ability', 'mage', 'shadow'],
];

/**
 * Every key the published types say `world.on` accepts. Written out rather than read from
 * anywhere, which is the point: the loader owns one list and this is an independent second
 * one. A key added to the published types and not to the runtime's list would typecheck
 * everywhere and throw here.
 */
const WORLD_KEYS = [
  'player',
  'target',
  'entities',
  'party',
  'inventory',
  'equipment',
  'equipmentInstances',
  'bags',
  'copper',
  'zone',
  'characterKey',
  'character',
  'talents',
  'professions',
  'group',
  'encounter',
  'match',
  'arena',
  'battleground',
  'finder',
  'finderBoard',
  'quests',
  'cooldowns',
  'auras',
  'casts',
  'targetAuras',
  'hazards',
  'markers',
  'deathZones',
  'corpses',
  'nodeCooldowns',
  'corpse',
  'abilities',
  'combat',
  'market',
  'marketCollectPending',
  'mail',
  'mailUnread',
  'bank',
  'buyback',
];
/**
 * Every way the published types say an attack can land. A second independent copy, for the
 * reason `WORLD_KEYS` is one: a kind the wire sends and the types do not list reaches an
 * addon as an ordinary string and is silently wrong there rather than loudly.
 */
const DAMAGE_KINDS = ['hit', 'miss', 'dodge', 'parry', 'block', 'resist', 'evade'];
/** An arbitrary nested value, to show that storage is not flattened to strings. */
const PROBE_VALUE = Object.freeze(['a', ['b'], { c: true }]);
/** Matches --color-text-error, so a failed line reads the way the manager's do. */
const FAIL_COLOR = 'rgb(255 143 133)';

/**
 * The sibling file this addon declares, and what it has to contain. `data.json` is
 * deliberately inert: what is being demonstrated is the route, which is that a table can
 * live in its own file instead of being pasted into `main.js`.
 */
const DATA_FILE = 'data.json';
const DATA_MARKER = 'dev-harness data file';
/** A name no manifest declares, which is the only reason it is refused. */
const UNDECLARED_FILE = '../../secrets.json';

/** The world reads gated on standing at something, which all share one shape. */
const GATED_READS = ['market', 'mail', 'bank'];
/** The three states one of those can be in, and there is no fourth. */
const GATED_STATES = ['near', 'away', 'unknown'];

/** Epoch milliseconds at the start of 2020, which any real wall clock is past. */
const EPOCH_FLOOR_MS = 1_577_836_800_000;
/** The ceiling `woc.onFrame` documents for its delta, however long a tab slept. */
const MAX_FRAME_DT_MS = 250;

/**
 * The clock that measures an INTERVAL, and picking the wrong one of the two is silent:
 * `now()` is monotonic from this page load, `wallClock()` is epoch and is the one for
 * anything stored. A stored `now()` reading looks like the future on the next load.
 */
const started = woc.now();

/** Frames counted since load, for the net check. */
let framesSeen = 0;
woc.net.onRaw(() => {
  framesSeen += 1;
});

/** Ticks of the loader's own animation loop since load, and the last delta it gave. */
let framesTicked = 0;
let lastFrameDt = null;
// Subscribed for the session, like the world keys at the bottom of this file and at the
// same price: the watcher already samples once per animation frame.
woc.onFrame((dt) => {
  framesTicked += 1;
  lastFrameDt = dt;
});

/**
 * Subscribed and dropped in the same breath, so anything it counts is the loader still
 * calling a handler that was torn down. The teardown is the half worth checking: a handler
 * that never fires is visible immediately, while one the loader forgot to release keeps
 * running against a disabled addon.
 */
let strayFrames = 0;
woc.onFrame(() => {
  strayFrames += 1;
})();

/**
 * Whether the GAME still matches what the published types claim, which only a live session
 * can answer: these records pass through the loader untouched, so no fake can catch a
 * drift. Everything else in this file asks whether a surface reached the addon.
 *
 * Three claims, each of which fails silently in an addon that believed it. `evade` always
 * lands at 0, so a meter counts it as an outcome and never as damage. `absorbed` is absent
 * rather than 0, which is all that separates a heal a shield devoured from one that
 * overhealed. `abilityId` is a string whenever it is anything, since an addon builds an
 * icon URL from it.
 *
 * NOT watched: whether a non-null `abilityId` only rides a player's own hit. Its source
 * can have left interest scope, so the check would report the roster as the wire.
 */
const records = {
  damage: 0,
  heals: 0,
  withAbilityId: 0,
  resolved: 0,
  overhealed: 0,
  auras: 0,
  aurasAttributed: 0,
};
/** The distinct contradictions seen, named. A count alone does not say what broke. */
const contradictions = [];

function contradiction(note) {
  if (contradictions.length < MAX_CONTRADICTIONS && !contradictions.includes(note)) {
    contradictions.push(note);
  }
}

/**
 * The id a damage record carries, and whether the spellbook knows it. A null is the
 * ordinary answer and by a wide margin the common one: the game fills this only on a
 * player's primary direct hit. What is worth counting is how many of the non-null ones the
 * spellbook resolves, which is the measurement behind whether reaching for this field buys
 * a display anything a name lookup would not.
 */
function noteAbilityId(id) {
  if (id === null || id === undefined) {
    return;
  }
  if (typeof id !== 'string' || id.length === 0) {
    contradiction(`abilityId arrived as ${typeOf(id)}`);
    return;
  }
  records.withAbilityId += 1;
  if ((woc.world.abilities?.byId(id) ?? null) !== null) {
    records.resolved += 1;
  }
}

woc.net.onEvent('damage', (event) => {
  records.damage += 1;
  if (!DAMAGE_KINDS.includes(event.kind)) {
    contradiction(`the wire sent kind "${String(event.kind)}", which the types do not list`);
  }
  if (event.kind === 'evade' && event.amount !== 0) {
    contradiction(`an evade carried ${String(event.amount)} damage, and evades land at 0`);
  }
  if (event.absorbed === 0) {
    contradiction('a damage record carried absorbed 0, which the types say is absent instead');
  }
  noteAbilityId(event.abilityId);
});

woc.net.onEvent('heal2', (event) => {
  records.heals += 1;
  // Absent, never 0 and never null, is what lets an addon tell a heal a shield ate
  // from a heal that overhealed. Both land at `amount: 0` and nothing else parts them.
  if (event.absorbed === 0 || event.absorbed === null) {
    contradiction(`a heal carried absorbed ${String(event.absorbed)}, which is meant to be absent`);
  }
  noteOverheal(event);
});

/**
 * Overhealing, which is published as absent-or-positive and as PARTIAL ONLY.
 *
 * The absence rule is the same one `absorbed` carries and fails the same silent way: a 0
 * here would make "no overhealing" and "some overhealing" the same reading. The partial
 * rule cannot be checked from this side at all, because a fully overhealing tick emits no
 * record for a watcher to see, which is exactly why it is documented rather than asserted.
 */
function noteOverheal(event) {
  if (event.overheal === undefined) {
    return;
  }
  if (typeof event.overheal !== 'number' || event.overheal <= 0) {
    contradiction(`a heal carried overheal ${String(event.overheal)}, meant to be absent or > 0`);
    return;
  }
  records.overhealed += 1;
}

/**
 * The aura attribution added in game 0.35.0, and the only route to a MOB ability's id.
 *
 * Two claims worth a live session. All four fields ride the same emit path, so `sourceId`
 * and `abilityId` arrive together or not at all; an addon that tested one and read the
 * other would be right until that stopped holding. And `refresh` marks a re-application
 * that emits no fade, so a duration tracker counting gains against fades needs it: a
 * `refresh` on a record that is not a gain would break that counting silently.
 */
function lonelyField(hasSource) {
  if (hasSource) {
    return 'sourceId';
  }
  return 'abilityId';
}

woc.net.onEvent('aura', (event) => {
  records.auras += 1;
  const hasSource = event.sourceId !== undefined;
  const hasAbility = event.abilityId !== undefined;
  if (hasSource !== hasAbility) {
    contradiction(`an aura carried ${lonelyField(hasSource)} without the other`);
  }
  if (hasAbility && (typeof event.abilityId !== 'string' || event.abilityId.length === 0)) {
    contradiction(`an aura abilityId arrived as ${typeOf(event.abilityId)}`);
  }
  if (event.refresh !== undefined && event.gained !== true) {
    contradiction('an aura marked refresh on a record that was not a gain');
  }
  if (hasAbility) {
    records.aurasAttributed += 1;
  }
});

/** Whole seconds since this addon loaded, which is what the monotonic clock is for. */
function uptimeSeconds() {
  return Math.round((woc.now() - started) / MS_PER_SECOND);
}

/** One check's outcome. `note` is shown for a failure, and for a pass on demand. */
function result(name, ok, note) {
  return { name, ok, note };
}

function typeOf(value) {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

function checkIdentity() {
  const { addon } = woc;
  const missing = ['id', 'fqid', 'name', 'version', 'marketplace'].filter(
    (key) => typeof addon[key] !== 'string' || addon[key].length === 0,
  );
  if (missing.length > 0) {
    return result('identity', false, `woc.addon is missing ${missing.join(', ')}`);
  }
  if (woc.api !== 1) {
    return result('identity', false, `woc.api is ${String(woc.api)}, expected 1`);
  }
  return result('identity', true, `${addon.fqid} at ${addon.version}, API ${String(woc.api)}`);
}

function checkGame() {
  const { game } = woc;
  if (typeof game.channel !== 'string') {
    return result('game', false, 'woc.game.channel is not a string');
  }
  if (game.version === null) {
    // Not a failure. The footer is written by the game and is not there before
    // the document is, so a null here on an early run is expected.
    return result('game', true, `${game.channel}, version not readable yet`);
  }
  return result('game', true, `${game.channel} running ${game.version} (${String(game.build)})`);
}

/** Every declared setting arrived, and arrived as the type it was declared as. */
function checkSettings() {
  const expected = {
    cue: 'string',
    'open-on-load': 'boolean',
    'net-samples': 'number',
    detail: 'string',
  };
  const wrong = Object.keys(expected).filter((key) => typeOf(woc.settings[key]) !== expected[key]);
  if (wrong.length > 0) {
    const got = wrong.map((key) => `${key} is ${typeOf(woc.settings[key])}`).join(', ');
    return result('settings', false, `hydrated with the wrong type: ${got}`);
  }
  return result('settings', true, `cue=${woc.settings.cue}, detail=${woc.settings.detail}`);
}

async function checkStorage() {
  const key = 'harness-probe';
  const written = { at: woc.now(), nested: PROBE_VALUE };
  await woc.storage.set(key, written);

  const read = await woc.storage.get(key);
  if (JSON.stringify(read) !== JSON.stringify(written)) {
    return result('storage', false, `read back ${JSON.stringify(read)}`);
  }

  const keys = await woc.storage.keys();
  if (!keys.includes(key)) {
    return result('storage', false, `keys() did not list it: ${keys.join(', ')}`);
  }
  // Deliberately checked: settings live in a namespace of their own, and an
  // addon's own keys() must not report them.
  if (keys.includes('values') || keys.includes('keybinds')) {
    return result('storage', false, "keys() is reporting loader-owned keys as this addon's own");
  }

  await woc.storage.delete(key);
  const gone = await woc.storage.get(key, 'absent');
  if (gone !== 'absent') {
    return result('storage', false, 'delete left the value behind');
  }
  return result('storage', true, `round trip and delete over ${String(keys.length)} key(s)`);
}

/**
 * The store refusing a write for a character the world can name. Null otherwise.
 *
 * `world.characterKey` and the key `woc.storage.character` files under are the same value
 * by construction, and this is the only place both can be read in the same breath: two
 * checks reading them separately would disagree whenever a login landed between them.
 *
 * Only one direction of a disagreement is a failure. A store that refuses while the world
 * names a character is an addon whose per-character data silently never persists. The
 * other direction is what this addon's own suite arranges on purpose, so it is reported in
 * the note rather than failed.
 */
function refusedWhileKnown(accepted) {
  const key = woc.world.characterKey;
  if (accepted || key === null) {
    return null;
  }
  return `a per-character write was refused while characterKey is "${key}"`;
}

/**
 * The per-character store.
 *
 * The first write decides which half of this runs, rather than a reading of `world.player`.
 * The two do move together in the loader, but inferring one from the other would make this
 * check fail whenever that coupling was the thing that broke.
 *
 * Which half runs is reported rather than asserted. The refusal itself has a unit suite
 * with a fake that can hold world entry open; what cannot be checked anywhere but here is
 * that any of this reached the object an addon is handed, and that a real round trip
 * through the userscript manager comes back.
 */
async function checkCharacterStorage() {
  const store = woc.storage.character;
  if (typeof store?.set !== 'function') {
    return result('character storage', false, 'storage.character is not on the object');
  }
  const key = 'harness-probe';
  // Not a read, deliberately: a read before world entry is CONTRACTED not to
  // settle, so awaiting one here would hang the slow half for the session.
  const refusal = await store
    .set(key, PROBE_VALUE)
    .then(() => null)
    .catch((err) => String(err));
  const refused = refusedWhileKnown(refusal === null);
  if (refused !== null) {
    return result('character storage', false, refused);
  }
  if (refusal !== null) {
    return result('character storage', true, 'no character yet, so a write was refused');
  }

  const read = await store.get(key);
  const keys = await store.keys();
  await store.delete(key);
  const gone = await store.get(key, 'absent');

  if (JSON.stringify(read) !== JSON.stringify(PROBE_VALUE)) {
    return result('character storage', false, `read back ${JSON.stringify(read)}`);
  }
  // The derivation has to come back OFF: a raw listing would hand this addon the
  // key with the realm and character still on it, and every other character's too.
  if (!keys.includes(key)) {
    return result('character storage', false, `keys() did not list it: ${keys.join(', ')}`);
  }
  if (gone !== 'absent') {
    return result('character storage', false, 'delete left the value behind');
  }
  // Separate stores, not one with a prefix. Written last so the account-wide key
  // it leaves behind is the one checkStorage already cleans up.
  await woc.storage.set(key, 'account-wide');
  const stillMine = await store.get(key, 'absent');
  await woc.storage.delete(key);
  if (stillMine !== 'absent') {
    return result('character storage', false, 'an account-wide key was visible as this character');
  }
  // The key is named as well as counted, so a reader can see the pair the check
  // above will not fail on: a store that answers for a character the world has
  // not named yet reads here as a round trip against "null".
  return result(
    'character storage',
    true,
    `round trip over ${String(keys.length)} key(s), world names ${String(woc.world.characterKey)}`,
  );
}

/**
 * The declared file itself: parsed by the loader, and the same object every call.
 *
 * The read needs the host, because the file is fetched at install and answered from that
 * cache rather than over the network at run time. A document with no marketplace behind it
 * has nothing to hand back, and that is reported in the loader's own words rather than
 * failed. In a real game a rejection means the addon was installed by a loader that did
 * not know about `data` yet.
 */
async function readDataFile() {
  const read = await woc
    .data(DATA_FILE)
    .then((file) => ({ file }))
    .catch((err) => ({ failed: String(err) }));
  if (read.failed !== undefined) {
    return result('data', true, `undeclared names refused, nothing cached to read: ${read.failed}`);
  }
  const table = read.file;
  const rows = table?.rows;
  if (table?.marker !== DATA_MARKER || !Array.isArray(rows)) {
    return result('data', false, `${DATA_FILE} came back as ${JSON.stringify(table)}`);
  }
  if ((await woc.data(DATA_FILE)) !== table) {
    return result('data', false, 'a second read parsed the file again instead of sharing it');
  }
  return result('data', true, `${DATA_FILE}: ${String(rows.length)} rows, parsed once`);
}

/**
 * A file shipped beside this one, and the name that was never declared.
 *
 * The second half is the one worth watching a person run. `woc.data` checks its argument
 * for membership in the manifest's `data` list, and nothing anywhere joins that argument
 * onto a URL, so a traversing name is refused for being undeclared rather than for looking
 * dangerous. That is a property of the design rather than of a filter.
 */
async function checkData() {
  if (typeof woc.data !== 'function') {
    return result('data', false, 'woc.data is not on the object an addon is handed');
  }
  const refusal = await woc
    .data(UNDECLARED_FILE)
    .then(() => null)
    .catch((err) => String(err));
  if (refusal === null) {
    return result('data', false, `${UNDECLARED_FILE} resolved, so the declared list is not read`);
  }
  // The message has to name what IS declared, because the failure it reports is
  // almost always a file added to the directory and not to the manifest.
  if (!refusal.includes(DATA_FILE)) {
    return result('data', false, `the refusal did not say what is declared: ${refusal}`);
  }
  return await readDataFile();
}

/**
 * The bus, checked against itself, which is the only thing one addon can do. The harness
 * cannot prove two addons reach each other, because it is one addon and the loader never
 * delivers anybody their own messages. So what is checked is exactly that refusal, plus
 * the surface being callable and the wildcard being a real value rather than undefined.
 */
function checkBus() {
  const { bus } = woc;
  if (typeof bus?.emit !== 'function' || typeof bus.on !== 'function') {
    return result('bus', false, 'woc.bus is not callable');
  }
  if (typeof bus.anySender !== 'string' || bus.anySender === '') {
    return result('bus', false, `anySender is ${typeOf(bus.anySender)}`);
  }
  let heard = 0;
  const offOwn = bus.on(woc.addon.fqid, 'harness-probe', () => {
    heard += 1;
  });
  const offAny = bus.on(bus.anySender, 'harness-probe', () => {
    heard += 1;
  });
  bus.emit('harness-probe', PROBE_VALUE);
  offOwn();
  offAny();

  if (heard > 0) {
    return result('bus', false, `an addon was handed its own message ${String(heard)} time(s)`);
  }
  return result(
    'bus',
    true,
    `callable, and does not talk to itself (anySender "${bus.anySender}")`,
  );
}

/**
 * The cue list is empty until the SFX pack has been fetched, and `preload`
 * resolving is what says it has been. Reading `cues()` on the addon's first pass
 * is a race with that fetch, so preloading nothing is how to wait for it.
 */
async function checkSound() {
  await woc.sound.preload([]);

  const cues = woc.sound.cues();
  if (cues.length === 0) {
    return result('sound', false, 'the cue list is empty, so the SFX pack was not read');
  }
  const wanted = String(woc.settings.cue);
  if (!cues.includes(wanted)) {
    return result('sound', false, `"${wanted}" is not one of the ${String(cues.length)} cues`);
  }
  // A cue is not a file: the pack collapses a numbered family into one cue, so
  // this count is well below the number of files the game serves.
  return result('sound', true, `${String(cues.length)} cues, "${wanted}" is one of them`);
}

function checkKeys() {
  const combo = woc.keys.combo('toggle');
  if (combo === null) {
    return result('keys', false, 'combo("toggle") is null for a declared bind');
  }
  if (woc.keys.combo('never-declared') !== null) {
    return result('keys', false, 'combo() answered for an id the manifest does not declare');
  }

  const report = woc.keys.conflicts(combo);
  if (!(Array.isArray(report.game) && Array.isArray(report.addons))) {
    return result('keys', false, 'conflicts() did not return the two lists');
  }
  // The source is the interesting half. 'stored' means only explicitly saved
  // bindings could be read, so an empty reading does not mean the key is free.
  const own = report.addons.some((entry) => entry.startsWith(`${woc.addon.fqid}:`));
  if (!own) {
    return result('keys', false, `conflicts("${combo}") did not see this addon's own bind`);
  }
  return result('keys', true, `bound to ${combo}, conflicts read from "${report.source}"`);
}

function checkWorld() {
  if (!(woc.world.entities instanceof Map)) {
    return result('world', false, 'world.entities is not a Map');
  }
  let readOnly = false;
  try {
    woc.world.entities.set(1, {});
  } catch {
    readOnly = true;
  }
  if (!readOnly) {
    return result('world', false, 'world.entities accepted a write');
  }
  if (woc.world.player === null) {
    return result('world', true, 'readable, no player yet (login screen or loading)');
  }
  return result('world', true, `${String(woc.world.entities.size)} entities in interest scope`);
}

/**
 * Every published key is watchable, and every read answers.
 *
 * A key that reached the published types without reaching the runtime's own list throws
 * from `world.on`, which is invisible to a unit suite because nothing there reads the
 * published types.
 *
 * The reads are checked for being present rather than for a value. Before world entry
 * almost all of them are legitimately null, and a key missing from the object entirely is
 * a different thing from one answering null, which is what `undefined` separates.
 */
function checkWorldKeys() {
  const unwatchable = [];
  const missing = [];
  for (const key of WORLD_KEYS) {
    if (woc.world[key] === undefined) {
      missing.push(key);
    }
    try {
      woc.world.on(key, () => undefined)();
    } catch {
      unwatchable.push(key);
    }
  }
  if (missing.length > 0) {
    return result('world keys', false, `no read for ${missing.join(', ')}`);
  }
  if (unwatchable.length > 0) {
    return result('world keys', false, `world.on refused ${unwatchable.join(', ')}`);
  }
  return result('world keys', true, `${String(WORLD_KEYS.length)} keys readable and watchable`);
}

/**
 * A mob's cast is readable even though no event announces it. `net.onEvent('castStart')`
 * fires for a player cast, a pet's cast and the game's timed activities, and never for a
 * mob, so `world.casts` is the only way to see a boss cast. What this can check without a
 * fight is that the derivation runs over the live roster and agrees with the cast fields on
 * the entities.
 */
function checkCasts() {
  const { casts } = woc.world;
  if (!(casts instanceof Map)) {
    return result('casts', false, 'world.casts is not a Map');
  }
  const casting = [...woc.world.entities.values()].filter(
    (entity) => typeof entity.castingAbility === 'string' && entity.castingAbility.length > 0,
  );
  if (casting.length !== casts.size) {
    return result(
      'casts',
      false,
      `${String(casts.size)} in world.casts, ${String(casting.length)} entities with a cast field`,
    );
  }
  if (casts.size === 0) {
    return result('casts', true, 'readable, nothing in scope is casting');
  }
  const names = [...casts.values()].map((cast) => cast.ability);
  return result('casts', true, `${String(casts.size)} casting: ${names.join(', ')}`);
}

/**
 * Whether this document has the loader's stylesheet in it at all. The control for the
 * measurement below: the harness also runs headless, where CSS text does not survive, and
 * a rule missing because no sheet was injected has to be told apart from one missing
 * because its class was renamed.
 */
function sheetLive() {
  return getComputedStyle(win.el).position === 'absolute';
}

/**
 * A suite can assert the classes the kit writes and not that the sheet declaring them
 * exists, since CSS text does not survive that environment: a class renamed on one side
 * of the seam passes every test and draws nothing. Here it is measurable.
 *
 * Attached and taken away in the same call, because a style cannot be computed for an
 * element outside the document and every kit rule is scoped under the loader's root.
 */
function checkTile() {
  if (typeof woc.ui.tile !== 'function') {
    return result('tile', false, 'ui.tile is not callable');
  }
  const tile = woc.ui.tile({ label: 'Probe', fraction: 0.5, count: 2, school: 'frost' });
  stage.appendChild(tile.el);
  const swept = tile.el
    .querySelector('.woc-tile-sweep')
    ?.style.getPropertyValue('--woc-tile-sweep');
  const drawn = getComputedStyle(tile.el).borderTopWidth;
  const styled = sheetLive();
  const announced = tile.el.getAttribute('aria-label');
  tile.destroy();

  // Half a timer left has to be half the square GIVEN BACK, not half of it covered:
  // the public fraction is what remains and the wedge takes what has elapsed.
  if (swept !== '50.00%') {
    return result('tile', false, `a half-spent timer swept ${swept ?? 'nothing'}`);
  }
  if (announced !== 'Probe, 2') {
    return result('tile', false, `announced as ${String(announced)}`);
  }
  if (!styled) {
    return result('tile', true, 'sweep and name written, no sheet in this document to measure');
  }
  if (drawn === '' || drawn === '0px') {
    return result('tile', false, 'the loader has a sheet, and none of it reaches a tile');
  }
  return result('tile', true, `sweep written, sheet live at a ${drawn} border`);
}

/**
 * Whether the loader wired these to the object an addon is handed at all: a builder that
 * never reached `woc.ui` typechecks everywhere and throws only here.
 *
 * The SETTER is checked rather than the change event: `set` must move the control without
 * calling back, or a pane that saves on change writes the value it was just given
 * straight back.
 */
function checkFields() {
  const { field, tabs } = woc.ui;
  if (typeof field?.checkbox !== 'function' || typeof tabs !== 'function') {
    return result('fields', false, 'ui.field or ui.tabs is not callable');
  }
  let reported = 0;
  const check = field.checkbox({
    label: 'Probe',
    value: false,
    onChange: () => {
      reported += 1;
    },
  });
  check.set(true);
  const moved = check.value();
  check.destroy();

  const strip = tabs({
    tabs: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
    onSelect: () => {
      reported += 1;
    },
  });
  strip.select('b');
  const active = strip.active();
  strip.destroy();

  if (!moved) {
    return result('fields', false, 'set() did not move the control');
  }
  if (active !== 'b') {
    return result('fields', false, `select() left the strip on ${active}`);
  }
  if (reported > 0) {
    return result('fields', false, `set() called back ${String(reported)} time(s)`);
  }
  return result('fields', true, 'four fields and a tab strip, none of them calling back on set');
}

/** Which of the two a reorder did, for the note a failure carries. */
function keptWord(kept) {
  if (kept) {
    return 'kept';
  }
  return 'rebuilt';
}

/**
 * A row that survives a sync has to be the SAME row, since an addon holds measured state
 * on it and a rebuilt row draws identically until the moment those measurements matter.
 * A row past the budget comes OUT of the parent and stays alive, so `size` counts it
 * while the DOM does not.
 */
function checkList() {
  if (typeof woc.ui.list !== 'function') {
    return result('list', false, 'ui.list is not callable');
  }
  const parent = document.createElement('div');
  const built = [];
  const gone = [];
  const rows = woc.ui.list({
    parent,
    key: (item) => item.id,
    create: (item) => {
      built.push(item.id);
      const el = document.createElement('div');
      el.dataset.probe = item.id;
      return { el, destroy: () => gone.push(item.id) };
    },
    shown: (_item, index) => index < LIST_BUDGET,
  });
  const order = () => [...parent.children].map((el) => el.getAttribute('data-probe')).join(',');

  rows.sync([{ id: 'a' }, { id: 'b' }]);
  const first = rows.get('a');
  rows.sync([{ id: 'b' }, { id: 'a' }]);
  const reordered = order();
  const kept = rows.get('a') === first;
  rows.sync([{ id: 'b' }, { id: 'a' }, { id: 'c' }]);
  const cut = { drawn: order(), held: rows.size, walked: rows.values().length };
  rows.destroy();

  if (built.join(',') !== 'a,b,c') {
    return result('list', false, `created ${built.join(',') || 'nothing'}, expected a,b,c once`);
  }
  if (!kept || reordered !== 'b,a') {
    const held = keptWord(kept);
    return result('list', false, `a reorder gave "${reordered}" and ${held} the row`);
  }
  if (cut.drawn !== 'b,a' || cut.held !== LIST_ROWS) {
    return result('list', false, `past the budget: drew "${cut.drawn}", held ${String(cut.held)}`);
  }
  // The row it is NOT drawing has to be in the walk: a fade wants the pin that is off
  // the list exactly as much as the ones on it.
  if (cut.walked !== LIST_ROWS) {
    return result('list', false, `values() walked ${String(cut.walked)} of ${String(cut.held)}`);
  }
  // Held order rather than drawn order: a reorder moves elements and never the rows.
  if (gone.join(',') !== 'a,b,c') {
    return result('list', false, `destroy tore down ${gone.join(',') || 'nothing'}`);
  }
  return result(
    'list',
    true,
    'keyed, reordered without rebuilding, and walked a row it did not draw',
  );
}

/**
 * Every one writes a CLASS and never an inline style, which is the whole argument: an
 * inline style outranks every selector a stylesheet can spell, so one that reached for
 * `style` would look right on a desktop and silently drop the coarse-pointer floor.
 */
function checkLayout() {
  const { column, row, line, show } = woc.ui;
  if ([column, row, line, show].some((one) => typeof one !== 'function')) {
    return result('layout', false, 'one of ui.column, ui.row, ui.line or ui.show is not callable');
  }
  const col = column({ className: 'harness-probe' });
  const strip = row({ wrap: true, align: 'baseline', parent: col });
  const note = line({ tone: 'muted', parent: col });
  const styled = [col, strip, note].filter((el) => el.getAttribute('style') !== null);

  show(note, false);
  const hidden = note.className;
  show(note, true);
  const shownAgain = note.className;
  col.remove();

  if (styled.length > 0) {
    return result('layout', false, `${String(styled.length)} of them wrote an inline style`);
  }
  if (strip.parentElement !== col || note.parentElement !== col) {
    return result('layout', false, 'parent did not append');
  }
  if (hidden === shownAgain) {
    return result('layout', false, `show() left the class at "${shownAgain}" either way`);
  }
  return result('layout', true, `classes only, hidden as "${hidden}"`);
}

function checkAnchor() {
  if (typeof woc.ui.anchor3d !== 'function') {
    return result('anchor', false, 'ui.anchor3d is not callable');
  }
  const { player } = woc.world;
  const anchor = woc.ui.anchor3d(() => player?.pos ?? null);
  const placed = anchor.el.isConnected;
  const { visible } = anchor;
  anchor.destroy();

  if (!placed) {
    return result('anchor', false, 'the anchor was never put in the loader root');
  }
  if (anchor.el.isConnected) {
    return result('anchor', false, 'destroy left the element behind');
  }
  if (player === null) {
    return result('anchor', true, 'no player yet, so there is no point to project');
  }
  // Visible or not is the camera's business: the player can be behind it, which
  // is exactly what the anchor is supposed to hide for.
  return result('anchor', true, `anchored to you, ${onScreenWord(visible)}`);
}

/** Whether the first frame had placed it yet, said in words a reader can use. */
function onScreenWord(visible) {
  if (visible) {
    return 'on screen';
  }
  return 'off screen or not yet placed';
}

/**
 * Where a world point lands on screen, which is the arithmetic behind an anchor. The null
 * is the whole safety of this call and is why there is no `onScreen` flag beside it: a
 * point behind the camera has no place on screen, and a surface that answered with
 * coordinates anyway would put a marker on the wrong side of the player.
 */
function checkProject() {
  if (typeof woc.ui.project !== 'function') {
    return result('project', false, 'ui.project is not callable');
  }
  if (woc.ui.project({ unit: 'nonsense' }) !== null) {
    return result('project', false, 'an unresolvable unit projected to a position');
  }
  if (woc.world.player === null) {
    return result('project', true, 'no player yet, so there is no point to project');
  }
  const at = woc.ui.project({ unit: 'player', over: 'head' });
  if (at === null) {
    return result('project', true, 'you are behind the camera, or not being drawn');
  }
  if (![at.x, at.y, at.depth].every((n) => Number.isFinite(n)) || at.depth < 0) {
    return result('project', false, `projected to ${JSON.stringify(at)}`);
  }
  return result(
    'project',
    true,
    `your head is at ${at.x.toFixed(0)}, ${at.y.toFixed(0)}, ${at.depth.toFixed(DECIMALS_YARDS)} yd out`,
  );
}

/** The URL, or null once the loader knows the game ships no file for that id. */
function builtOrWithheld(built, expected) {
  return built === null || built === expected;
}

/** Which of the two answers came back, in the words the report needs. */
function artWord(built) {
  if (built === null) {
    return 'withheld, the manifest says there is no file';
  }
  return 'built';
}

/**
 * The icon URL builders answer, and refuse an id they cannot build a name from.
 *
 * Two answers are correct for `ability` and `item` and only one is for `mob`, and the
 * difference is a served manifest. Where the game publishes which ids ship a painted file,
 * the loader withholds the URL for the rest rather than handing over one that 404s, so a
 * blank slot means "no art exists". The answer also moves: it is the optimistic URL until
 * the manifest lands, so this accepts either and says which one it got.
 */
function checkIcons() {
  const { icon } = woc.ui;
  const ability = icon.ability('fireball', 'mage');
  if (!builtOrWithheld(ability, '/ui/skills/mage/fireball.webp')) {
    return result('icons', false, `ability() built ${String(ability)}`);
  }
  if (icon.mob('bog_bloat') !== '/ui/mobs/bog_bloat.webp') {
    return result('icons', false, `mob() built ${String(icon.mob('bog_bloat'))}`);
  }
  const item = icon.item('baked_bread');
  if (!builtOrWithheld(item, '/ui/items/baked_bread.webp')) {
    return result('icons', false, `item() built ${String(item)}`);
  }
  // Provenance for the FILE, never the item's name: nothing in the game keeps the
  // two in step. A name at all means there is a file, so the pair cannot disagree.
  if (icon.itemArtName('baked_bread') !== null && item === null) {
    return result('icons', false, 'itemArtName named art for an item with no icon');
  }
  // A missing class is the case an addon hits before world entry, and a path with an
  // empty segment in it would be a request that cannot succeed rather than a null.
  if (icon.ability('fireball', '') !== null) {
    return result('icons', false, 'ability() built a path with no class in it');
  }
  return result('icons', true, `empty ids refused, baked_bread ${artWord(item)}`);
}

/**
 * The served art manifest, read for the player's own class. The half a unit suite cannot
 * reach: whether the game still serves the manifest, and whether the ability ids in it line
 * up with what the player has. Not every ability ships a file, so the check is that the
 * loader can tell rather than that any given ability has one.
 */
async function checkSkillArt() {
  const cls = woc.world.player?.templateId ?? '';
  if (cls === '') {
    return result('skill art', true, 'no player yet, so no class to read a manifest for');
  }
  await woc.ui.icon.preload(cls);

  // The player's whole kit, which `world.abilities.known` is exactly. Walking the keys of
  // the cooldown map instead only ever sees the abilities already on cooldown.
  const ids = (woc.world.abilities?.known ?? []).map((info) => info.id);
  if (ids.length === 0) {
    return result('skill art', true, `manifest read for ${cls}, no spellbook to check it against`);
  }
  const withArt = ids.filter((id) => woc.ui.icon.ability(id, cls) !== null);
  return result(
    'skill art',
    true,
    `${cls}: ${String(withArt.length)} of ${String(ids.length)} known abilities have a file`,
  );
}

/** The round trip, or a plain note that none has been measured yet. */
function describeLatency(latencyMs) {
  if (latencyMs === null) {
    return 'not measured';
  }
  return `${String(latencyMs)} ms`;
}

function checkNet() {
  const { state } = woc.net;
  if (typeof state.connected !== 'boolean') {
    return result('net', false, 'net.state.connected is not a boolean');
  }
  if (!state.connected) {
    return result('net', true, 'socket not connected yet, nothing to count');
  }
  const wanted = Number(woc.settings['net-samples']);
  if (framesSeen < wanted) {
    return result('net', false, `only ${String(framesSeen)} frames seen, wanted ${String(wanted)}`);
  }
  const latency = describeLatency(state.latencyMs);
  return result(
    'net',
    true,
    `${String(framesSeen)} frames, tick ${String(state.tick)}, ${latency}`,
  );
}

/** The timer surface, and that it is the loader's rather than the page's. */
function checkTimers() {
  return new Promise((resolve) => {
    const failed = woc.setTimeout(() => {
      resolve(
        result('timers', false, `setTimeout did not fire within ${String(CHECK_TIMEOUT_MS)} ms`),
      );
    }, CHECK_TIMEOUT_MS);

    woc.setTimeout(() => {
      woc.clearTimeout(failed);
      woc.requestAnimationFrame(() => {
        resolve(result('timers', true, 'setTimeout and requestAnimationFrame both fired'));
      });
    }, 0);
  });
}

/**
 * The two clocks, and the difference between them a stored stamp depends on. `woc.now()`
 * is measured from this page load, so it is always a small number and is meaningless in
 * the next session; `woc.wallClock()` is epoch milliseconds and is the only one of the two
 * that survives a reload. A wall clock reading below 2020 is not an epoch stamp at all, and
 * a monotonic reading at or above it means `now()` has been wired to the wrong source.
 */
function checkClocks() {
  const monotonic = woc.now();
  const wall = woc.wallClock();
  if (typeof wall !== 'number' || typeof monotonic !== 'number') {
    return result('clocks', false, `now() is ${typeOf(monotonic)}, wallClock() is ${typeOf(wall)}`);
  }
  if (wall < EPOCH_FLOOR_MS) {
    return result(
      'clocks',
      false,
      `wallClock() reads ${String(wall)}, which is not an epoch stamp`,
    );
  }
  if (monotonic >= wall) {
    return result('clocks', false, 'now() is not counting from this page load');
  }
  return result(
    'clocks',
    true,
    `up ${String(uptimeSeconds())}s, wall clock at ${new Date(wall).toISOString()}`,
  );
}

/**
 * A count of zero is not a failure: this document may have no animation loop running. A
 * failure is a delta outside the documented range, or a handler still called after its
 * teardown. No "is it callable" arm, unlike `checkData`: the subscription is made at load,
 * so a missing `onFrame` takes the addon down before any check runs.
 */
function checkFrames() {
  if (strayFrames > 0) {
    return result('frames', false, `a torn-down handler still ran ${String(strayFrames)} time(s)`);
  }
  if (framesTicked === 0) {
    return result('frames', true, 'subscribed, no frame has run in this document yet');
  }
  if (!(lastFrameDt >= 0 && lastFrameDt <= MAX_FRAME_DT_MS)) {
    return result('frames', false, `dt was ${String(lastFrameDt)}, outside 0 to 250 ms`);
  }
  return result(
    'frames',
    true,
    `${String(framesTicked)} frames, last dt ${lastFrameDt.toFixed(1)} ms`,
  );
}

/**
 * Each shadowed global, touched in a way that fires the proxy's `get` trap. Property reads
 * only, never a call or a construction: if the shadow were ever absent these have to be
 * harmless, and `new WebSocket(...)` in an unshadowed closure would open a real socket.
 */
const SHADOW_PROBES = [
  ['localStorage', () => localStorage.length],
  ['sessionStorage', () => sessionStorage.length],
  ['indexedDB', () => indexedDB.databases],
  ['XMLHttpRequest', () => XMLHttpRequest.prototype],
  ['WebSocket', () => WebSocket.prototype],
];

/**
 * The loader shadows the riskiest globals inside an addon closure, so reaching for one
 * fails loudly and names the API to use instead. It is not a sandbox and the loader says
 * so plainly; this checks it is doing the job it does claim, which is to stop the accident.
 */
function checkShadowedGlobals() {
  const reachable = [];
  for (const [name, touch] of SHADOW_PROBES) {
    try {
      touch();
      reachable.push(name);
    } catch {
      // Throwing is the pass. The message names the sanctioned API.
    }
  }
  if (reachable.length > 0) {
    return result('shadowed globals', false, `still reachable: ${reachable.join(', ')}`);
  }
  return result('shadowed globals', true, `${String(SHADOW_PROBES.length)} globals shadowed`);
}

/** What a display could guess from an id alone, which is the thing being replaced. */
function titleCase(id) {
  return id
    .split('_')
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * `titleCase` above is the ORACLE rather than a duplicate: the published member has to
 * agree with the hand-written one, or a migrated addon draws different words. Everything
 * rounds UP, since a countdown reading 0 while the thing runs is the one error a timer
 * must not make.
 */
function checkFmt() {
  const { fmt } = woc;
  if (typeof fmt?.duration !== 'function') {
    return result('fmt', false, 'woc.fmt is not on the object an addon is handed');
  }
  const wrong = [];
  const same = (what, got, want) => {
    if (got !== want) {
      wrong.push(`${what} gave "${String(got)}", expected "${want}"`);
    }
  };
  const { seconds, nearlyAMinute, minutes, anHour, one, many, pair, zero } = FMT_INPUT;
  same('seconds', fmt.duration(seconds), '45');
  same('just under a minute', fmt.duration(nearlyAMinute), '60');
  same('over a minute', fmt.duration(minutes), '2m');
  same('coarse', fmt.duration(anHour, 'coarse'), '1h 2m');
  same('titleCase', fmt.titleCase('aimed_shot'), titleCase('aimed_shot'));
  same('one', fmt.count(one, 'item'), '1 item');
  same('several', fmt.count(many, 'item'), '4 items');
  same('irregular plural', fmt.count(pair, 'wolf', 'wolves'), '2 wolves');
  for (const [what, degrees, want] of COMPASS_CASES) {
    same(what, fmt.compass(degrees), want);
  }
  // A reading nobody has yet is nothing; a reading of zero is a reading. Checked as a
  // pair, because a falsy test satisfies the first half and breaks the second.
  same('absent duration', fmt.duration(null), '');
  same('absent bearing', fmt.compass(null), '');
  same('unusable duration', fmt.duration(Number.NaN), '');
  same('unusable bearing', fmt.compass(Number.NaN), '');
  same('zero seconds', fmt.duration(zero), '0');
  if (wrong.length > 0) {
    return result('fmt', false, wrong.join('; '));
  }
  return result('fmt', true, 'duration, titleCase, count and compass all as written by hand');
}

/**
 * The spellbook, and the id-to-name bridge it exists for.
 *
 * The round trip is the point, so that is what is asserted: every ability has to come back
 * as itself through both lookups. An index that answered a plausible-looking neighbour
 * would pass a spot check on one ability and be wrong everywhere else.
 *
 * The lookups are also checked for rejecting a name that is not the player's, because that
 * is the case a meter hits constantly: every mob ability reaches it as a display name with
 * no id behind it, and a null is the honest answer.
 */
function checkAbilities() {
  const book = woc.world.abilities;
  if (book === undefined || typeof book.byId !== 'function') {
    return result('abilities', false, 'world.abilities is not an index');
  }
  if (book.known.length === 0) {
    return result('abilities', true, 'empty, no world yet (login screen or loading)');
  }
  const broken = [];
  for (const info of book.known) {
    if (book.byId(info.id) !== info || book.byName(info.name) !== info) {
      broken.push(info.id);
    }
  }
  if (broken.length > 0) {
    return result('abilities', false, `did not round trip: ${broken.join(', ')}`);
  }
  if (book.byName('\0 not an ability') !== null) {
    return result('abilities', false, 'byName answered for a name nobody has');
  }
  // How many names a title-cased id would have got wrong, which is what a display had to
  // fall back on before this surface existed. A count of zero would mean the bridge is not
  // earning its place on this character.
  const diverged = book.known.filter((info) => info.name !== titleCase(info.id));
  return result(
    'abilities',
    true,
    `${String(book.known.length)} known, ${String(diverged.length)} unguessable from the id`,
  );
}

/**
 * The derived half answers with no world at all: an id nobody has comes back title-cased
 * under `known: false`. The mark stays the addon's, so what is checked is that the FACT
 * arrives rather than that anything was drawn.
 */
function checkDescribe() {
  const book = woc.world.abilities;
  if (typeof book?.describe !== 'function') {
    return result('describe', false, 'world.abilities.describe is not callable');
  }
  const made = book.describe('\0_not_an_ability');
  if (made.known !== false || made.school !== null) {
    return result('describe', false, `an id nobody has came back known: ${String(made.known)}`);
  }
  const [first] = book.known;
  if (first === undefined) {
    return result(
      'describe',
      true,
      'derived names disclosed, no spellbook yet to check a real one',
    );
  }
  const real = book.describe(first.id);
  if (real.known !== true || real.name !== first.name) {
    return result(
      'describe',
      false,
      `${first.id} described as "${real.name}", known ${String(real.known)}`,
    );
  }
  return result('describe', true, `"${first.name}" read off the spellbook, a made-up id disclosed`);
}

/**
 * Only answerable while there is a player, and checked against the player's OWN position,
 * where the answers are known without a second source. A null from either while a player
 * is live means the surface is reading a position the loader does not have.
 */
function checkGeometry() {
  const { world } = woc;
  if (typeof world.distanceTo !== 'function' || typeof world.bearingTo !== 'function') {
    return result('geometry', false, 'world.distanceTo or world.bearingTo is not callable');
  }
  const here = world.player?.pos ?? null;
  if (here === null) {
    return result('geometry', true, 'no player, so nothing to measure from yet');
  }
  const under = world.distanceTo({ x: here.x, z: here.z });
  const away = world.distanceTo({ x: here.x + PROBE_YARDS, z: here.z });
  if (under === null || away === null) {
    return result('geometry', false, 'answered null with a live player');
  }
  if (Math.abs(away - under - PROBE_YARDS) > PROBE_TOLERANCE) {
    return result(
      'geometry',
      false,
      `${String(PROBE_YARDS)} yards east measured ${away.toFixed(DECIMALS_YARDS)}`,
    );
  }
  const bearing = world.bearingTo({ x: here.x + PROBE_YARDS, z: here.z });
  if (bearing === null || !Number.isFinite(bearing)) {
    return result('geometry', false, 'bearingTo answered nothing for a point beside the player');
  }
  return result(
    'geometry',
    true,
    `${away.toFixed(DECIMALS_YARDS)} yards east, bearing ${String(Math.round(bearing))} (${woc.fmt.compass(bearing)})`,
  );
}

/**
 * NOBODY RECEIVES THEIR OWN MESSAGES, so a self round trip is unobservable by design and
 * an arriving answer cannot be checked here. What can: both halves reachable, the two
 * controls handed back, and following your own topic hearing nothing.
 */
function checkPublish() {
  const { bus } = woc;
  if (typeof bus?.publish !== 'function' || typeof bus.follow !== 'function') {
    return result('publish', false, 'bus.publish or bus.follow is not callable');
  }
  let heard = 0;
  let asked = 0;
  // Reads none of this addon's own state, deliberately: a producer runs during the call
  // that registers it, while the body is still being evaluated.
  const publication = bus.publish('harness-probe', () => {
    asked += 1;
    return PROBE_VALUE;
  });
  const announced = asked;
  const unfollow = bus.follow('harness-probe', () => {
    heard += 1;
  });
  publication.announce();
  const total = asked;
  unfollow();
  publication.stop();

  if (typeof publication.announce !== 'function' || typeof publication.stop !== 'function') {
    return result('publish', false, 'publish() did not hand back announce and stop');
  }
  if (announced !== 1) {
    return result('publish', false, `publish() ran its producer ${String(announced)} times`);
  }
  if (total !== announced + 1) {
    return result(
      'publish',
      false,
      `announce() ran the producer ${String(total - announced)} times`,
    );
  }
  if (heard > 0) {
    return result('publish', false, `an addon followed itself ${String(heard)} time(s)`);
  }
  return result('publish', true, 'announces once when registered, and again on demand');
}

/** What two requests before one frame have to have produced. See `checkPaint`. */
function paintOutcome(painted) {
  if (painted === 1) {
    return result('paint', true, 'two requests before a frame drew once');
  }
  if (painted === 0 && framesTicked === 0) {
    return result('paint', true, 'requested, no frame has run in this document yet');
  }
  return result('paint', false, `two requests drew ${String(painted)} time(s)`);
}

/**
 * `woc.paint`, which is the coalesced repaint three addons wrote byte for byte.
 *
 * Two requests before a frame have to produce ONE paint, which is the whole feature.
 *
 * IT WAITS ON `onFrame`, NOT ON `requestAnimationFrame`: a repaint rides the LOADER'S
 * shared loop, and in a document where that loop is driven by something other than the
 * browser, rAF fires while no loader frame has run at all.
 *
 * A loop that has not ticked is a stated skip rather than a failure, told apart by the
 * frame counter `frames` reads, so this cannot pass by having waited in the wrong place.
 */
function checkPaint() {
  return new Promise((resolve) => {
    if (typeof woc.paint !== 'function') {
      resolve(result('paint', false, 'woc.paint is not callable'));
      return;
    }
    let painted = 0;
    const request = woc.paint(() => {
      painted += 1;
    });
    // Before the watch, so the seat on the loop is taken ahead of it and the paint runs
    // first within one frame.
    request();
    request();
    const finish = () => {
      off();
      woc.clearTimeout(deadline);
      resolve(paintOutcome(painted));
    };
    const off = woc.onFrame(() => {
      if (painted > 0) {
        finish();
      }
    });
    const deadline = woc.setTimeout(finish, PAINT_WAIT_MS);
  });
}

/**
 * The `probe` id is claimed by nothing else, so a registration under it can only have come
 * from the frame, which is what makes this a check of the member rather than of the
 * keybind surface under it.
 *
 * The release is half the contract: the bind belongs to the FRAME, so destroying one takes
 * it with it, or a rebuild would leave a key pointing at a panel that is gone.
 */
function checkToggleKey() {
  const combo = woc.keys.combo('probe');
  if (combo === null) {
    return result('toggle key', false, 'combo("probe") is null for a declared bind');
  }
  const claimed = () => woc.keys.conflicts(combo).addons.includes(`${woc.addon.fqid}:probe`);
  if (claimed()) {
    return result('toggle key', false, `${combo} was already claimed before any frame asked`);
  }
  const probe = woc.ui.frame({ id: 'toggle-probe', title: 'Probe', toggleKey: 'probe' });
  const bound = claimed();
  probe.destroy();
  const released = !claimed();

  if (!bound) {
    return result('toggle key', false, `a frame declaring toggleKey did not claim ${combo}`);
  }
  if (!released) {
    return result('toggle key', false, `${combo} stayed bound after its frame was destroyed`);
  }
  return result('toggle key', true, `a frame took ${combo} and gave it back when destroyed`);
}

/**
 * The checks that describe the live world, in report order.
 *
 * Separated from the rest because their answers change while the player plays, and because
 * they are cheap: reading state the loader already holds. They are re-run from `world.on`
 * as things move, so a line that says "no target, so target-of-target went unchecked"
 * becomes a real check the moment a target is picked. Most of the world surface can only
 * be verified while something is actually happening.
 */
const LIVE_CHECKS = [
  checkWorld,
  checkAbilities,
  checkDescribe,
  checkGeometry,
  checkCombat,
  checkCombatRecords,
  checkMobTargeting,
  checkEntityStats,
  checkUnits,
  checkReaction,
  checkAuraQueries,
  checkAuraPolarity,
  checkHoldings,
  checkCharacter,
  checkCharacterKey,
  checkContent,
  checkCounters,
  checkSaleLedger,
  checkGroup,
  checkCasts,
  checkProject,
  checkFrames,
];

/** Everything else, which answers the same way all session and is run on demand. */
const STATIC_CHECKS = [
  checkIdentity,
  checkGame,
  checkSettings,
  checkFmt,
  checkKeys,
  checkToggleKey,
  checkWorldKeys,
  checkIcons,
  checkTile,
  checkList,
  checkLayout,
  checkFields,
  checkAnchor,
  checkBus,
  checkPublish,
  checkNet,
  checkClocks,
  checkShadowedGlobals,
];

/**
 * The world keys a live check reads, so a change to any of them repaints. Deliberately the
 * keys the checks consume rather than every key that exists: subscribing to all of them
 * would wake the harness on traffic no line here reports.
 */
const LIVE_KEYS = [
  'player',
  'target',
  'entities',
  'party',
  'combat',
  'zone',
  'copper',
  'bags',
  'equipment',
  'inventory',
  'character',
  'characterKey',
  'talents',
  'abilities',
  'casts',
  'group',
  'encounter',
];

/**
 * The slow half: a storage round trip, a pack fetch, a timer, an image load. Never re-run
 * on a world change, since a storage round trip writes through the bridge to the userscript
 * manager and the answer cannot move.
 */
async function runSlowChecks() {
  return await Promise.all([
    checkStorage(),
    checkCharacterStorage(),
    checkData(),
    checkSound(),
    checkTimers(),
    checkPaint(),
    checkSkillArt(),
  ]);
}

function runLiveChecks() {
  return [...STATIC_CHECKS.map((check) => check()), ...LIVE_CHECKS.map((check) => check())];
}

const win = woc.ui.window({
  id: 'report',
  title: 'Dev Harness',
  width: 460,
  height: 420,
  save: true,
  visible: woc.settings['open-on-load'] === true,
});

/**
 * The report, in a container of its own so a live repaint cannot take the
 * controls with it, or wipe a bar demo half way through its drain.
 */
const report = document.createElement('div');
/** Where a demo puts something to look at, kept outside the repainting half. */
const stage = document.createElement('div');
win.body.append(report, stage);

/** The slow half's last answer, held so a live repaint can show it unchanged. */
let slowResults = [];

/**
 * Copper as the game writes it, so the readout matches what a player sees.
 *
 * Bare copper when there is nothing above it, rather than an empty string.
 */
function money(copper) {
  const gold = Math.floor(copper / COPPER_PER_GOLD);
  const silver = Math.floor((copper % COPPER_PER_GOLD) / COPPER_PER_SILVER);
  const loose = copper % COPPER_PER_SILVER;
  const parts = [];
  if (gold > 0) {
    parts.push(`${String(gold)}g`);
  }
  if (silver > 0) {
    parts.push(`${String(silver)}s`);
  }
  if (loose > 0 || parts.length === 0) {
    parts.push(`${String(loose)}c`);
  }
  return parts.join(' ');
}

/**
 * The gear, bag and money reads, and the zone label behind the DOM.
 *
 * `bagCapacity` is read rather than derived: the loader takes the game's own number
 * straight through, and an addon cannot compute the same figure from anything published.
 * So it is checked against `inventory.length`, because a capacity below what is already
 * carried is the only thing wrong with it a check can know from here.
 *
 * The zone is the single read whose source is the game's DOM rather than its world object,
 * so a game update that renames the element leaves it silently null.
 */
function checkHoldings() {
  const { world } = woc;
  const { inventory, bags, bagCapacity, equipment, copper, zone } = world;
  if (inventory === null) {
    return result('holdings', true, 'no world yet');
  }
  if (!Array.isArray(bags)) {
    return result('holdings', false, 'bags is not an array');
  }
  if (typeof bagCapacity !== 'number' || bagCapacity < inventory.length) {
    return result(
      'holdings',
      false,
      `bagCapacity ${String(bagCapacity)} is below the ${String(inventory.length)} slots in use`,
    );
  }
  if (equipment === null || typeof equipment !== 'object') {
    return result('holdings', false, 'equipment is not a slot map');
  }
  if (typeof copper !== 'number') {
    return result('holdings', false, `copper is ${typeOf(copper)}`);
  }
  if (zone === null) {
    return result('holdings', false, 'the zone label did not resolve, so its anchor has moved');
  }
  const worn = Object.keys(equipment).length;
  // The per-copy lock, which is a `HeldSlot` field and therefore only ever readable here and on
  // the bank: a market row or a letter attachment is projected to the three public fields before
  // the server sends it. Reported rather than asserted, since a bag with nothing locked in it is
  // the ordinary state and this check would otherwise be a demand that the tester lock something.
  const badLock = inventory.find((slot) => {
    const held = slot.instance?.locked;
    return held !== undefined && typeof held !== 'boolean';
  });
  if (badLock !== undefined) {
    return result('holdings', false, `${badLock.itemId} carries a lock that is not a boolean`);
  }
  const locked = inventory.filter((slot) => slot.instance?.locked === true).length;
  return result(
    'holdings',
    true,
    `in ${zone}: ${String(worn)} worn, ${String(inventory.length)}/${String(bagCapacity)} bags,` +
      ` ${String(locked)} locked, ${money(copper)}`,
  );
}

/**
 * The character sheet. The numbers themselves cannot be checked against anything: only the
 * live game knows how much experience the player has. What is checked is the shape, and
 * that lifetime totals are not below their live counterparts, which is the one invariant
 * these fields have with each other.
 */
function checkCharacter() {
  const { character, talents, professions } = woc.world;
  if (character === null) {
    return result('character', true, 'no world yet');
  }
  if (typeof character.xp !== 'number' || typeof character.renown !== 'number') {
    return result('character', false, 'the sheet is not carrying numbers');
  }
  if (character.lifetimeXp < character.xp) {
    return result(
      'character',
      false,
      `lifetimeXp ${String(character.lifetimeXp)} is below xp ${String(character.xp)}`,
    );
  }
  if (character.lifetimeHonor < character.honor) {
    return result('character', false, 'lifetimeHonor is below honor');
  }
  if (!(character.deeds instanceof Map)) {
    return result('character', false, 'deeds is not a Map');
  }
  if (!(character.deedStats.visited instanceof Set)) {
    return result('character', false, 'deedStats.visited is not a Set');
  }
  if (talents === null || professions === null) {
    return result('character', false, 'the sheet resolved but talents or professions did not');
  }
  // An ARRAY is the assertion, never a non-empty one: the game elides the wire key
  // entirely for anyone who has never slotted a tool effect, which is most players,
  // so an empty list here is the ordinary reading rather than a failure to read.
  if (!Array.isArray(professions.toolEffectSlots)) {
    return result('character', false, 'professions.toolEffectSlots is not an array');
  }
  return result(
    'character',
    true,
    `${String(character.deeds.size)} deeds, renown ${String(character.renown)}, ` +
      `${String(Object.keys(talents.rows).length)} talent rows, ` +
      `${String(professions.toolEffectSlots.length)} tool effects slotted`,
  );
}

/**
 * Who the loader thinks is playing. Opaque by contract, so nothing here parses it, and the
 * interesting assertion is that the store and the world agree, which
 * `checkCharacterStorage` makes. What is left for this line is the shape and the reading
 * itself, since a key that came back empty would file every per-character record under
 * nothing at all and would look exactly like a key that was never derived.
 */
function checkCharacterKey() {
  const { characterKey } = woc.world;
  if (characterKey === null) {
    return result('character key', true, 'no character yet, so nothing to key on');
  }
  if (typeof characterKey !== 'string' || characterKey.length === 0) {
    return result('character key', false, `it came back as ${typeOf(characterKey)}`);
  }
  return result('character key', true, `per-character state is filed under "${characterKey}"`);
}

/**
 * The two static content tables. Never null even before world entry, which is why neither
 * is a watch key: an empty table is the honest answer for a client that has not carried
 * one, and authored content cannot change during a session. Both are copies the loader
 * froze, so the write test is here for the reason `world.entities` gets one.
 */
function checkContent() {
  const { recipes, stations } = woc.world;
  if (!(Array.isArray(recipes) && Array.isArray(stations))) {
    return result(
      'content',
      false,
      `recipes is ${typeOf(recipes)}, stations is ${typeOf(stations)}`,
    );
  }
  if (!(refusesWrite(recipes) && refusesWrite(stations))) {
    return result('content', false, 'a content table accepted a write');
  }
  if (recipes.length === 0) {
    return result('content', true, 'no recipe table yet (login screen or loading)');
  }
  const shapeless = recipes.filter(
    (recipe) => typeof recipe.id !== 'string' || !Array.isArray(recipe.reagents),
  );
  if (shapeless.length > 0) {
    return result('content', false, `${String(shapeless.length)} recipes are not recipes`);
  }
  const gated = recipes.filter((recipe) => recipe.stationType !== null).length;
  return result(
    'content',
    true,
    `${String(recipes.length)} recipes (${String(gated)} need a station), ${String(stations.length)} stations`,
  );
}

/**
 * The counters a player has to be standing at, and the one shape they share.
 *
 * None of the three is ever null, which is the point of the shape: `unknown` already means
 * the loader has no world. What is checked is that the payload and the status agree. An
 * `away` carrying a reading is a pane drawn from wherever the player last stood, and a
 * `near` carrying nothing is a pane that cannot draw at all; both look like working code
 * from the outside.
 */
function checkCounters() {
  const wrong = [];
  const open = [];
  for (const key of GATED_READS) {
    const read = woc.world[key];
    if (!GATED_STATES.includes(read?.status)) {
      wrong.push(`${key} is ${typeOf(read)}`);
    } else if ((read.info !== null) !== (read.status === 'near')) {
      wrong.push(`${key} is "${read.status}" and carries ${typeOf(read.info)}`);
    } else if (read.status === 'near') {
      open.push(key);
    }
  }
  if (wrong.length > 0) {
    return result('counters', false, wrong.join(', '));
  }
  if (open.length === 0) {
    return result('counters', true, `${GATED_READS.join(', ')}: none of them in reach`);
  }
  return result('counters', true, `in reach: ${open.join(', ')}`);
}

/** Whether a published table is the frozen copy it claims to be. */
function refusesWrite(table) {
  try {
    table.push(null);
  } catch {
    return true;
  }
  // Put it back. The tables are copies, so this is not the game's own state, but a check
  // that leaves a null row behind would break the next addon to read it.
  table.pop();
  return false;
}

/** The player's own row straight off the entity, for comparing the projection against. */
function rawThreat(entity, playerId) {
  if (!(entity.threat instanceof Map)) {
    return null;
  }
  return entity.threat.get(playerId) ?? null;
}

function runWord(current) {
  if (current === null) {
    return 'not in a run';
  }
  return `${current.delveId} ${String(current.moduleIndex)}/${String(current.moduleCount)}`;
}

/**
 * The group, the run, and a mob's hate table.
 *
 * The threat half is checked against the entity it came from rather than against a number:
 * the rows must be sorted, and the player's own row must agree with the raw table. A
 * projection that quietly stopped sorting would still look plausible on screen.
 *
 * The loot roll half watches the clock conversion. A roll whose `remaining` is null while
 * the world is up means the loader never got the sim's clock off the snapshot.
 */
function checkGroup() {
  const { group, encounter, threat, target } = woc.world;
  if (group === null || encounter === null) {
    return result('group', true, 'no world yet');
  }
  const unclocked = group.rolls.filter((roll) => roll.remaining === null);
  if (unclocked.length > 0) {
    return result('group', false, `${String(unclocked.length)} rolls with no clock to time them`);
  }
  if (target !== null) {
    const table = threat(target.id);
    const sorted = [...table.rows].sort((a, b) => b.threat - a.threat);
    if (table.rows.some((row, at) => row.threat !== sorted[at].threat)) {
      return result('group', false, 'the hate table came back unsorted');
    }
    const raw = rawThreat(target, woc.world.player.id);
    if (table.mine !== raw) {
      return result('group', false, `mine is ${String(table.mine)}, the table says ${String(raw)}`);
    }
    if (table.rows.length > 0) {
      return result(
        'group',
        true,
        `${String(table.rows.length)} on the hate table, mine ${String(table.mine)} of ${String(table.top)}`,
      );
    }
  }
  const inside = runWord(encounter.run);
  return result(
    'group',
    true,
    `${String(group.rolls.length)} rolls, ${String(group.lockouts.size)} lockouts, ${inside}`,
  );
}

/** Whichever field this kind of entity fills, which is the thing being checked. */
function fightingId(entity) {
  if (entity.kind === 'mob') {
    return entity.aggroTargetId;
  }
  return entity.targetId;
}

/**
 * Unit tokens, against the state they are resolved from. Every assertion here is one an
 * addon would otherwise trust silently: that `player` and `target` agree with the plain
 * reads, that an unknown token is a null rather than a throw, and that `targettarget` on a
 * mob target is not the permanently-null field. The last cannot be checked without a mob
 * target, so it reports what it could see rather than passing quietly.
 */
function checkUnits() {
  const { world } = woc;
  if (typeof world.unit !== 'function') {
    return result('units', false, 'world.unit is not callable');
  }
  if (world.unit('player') !== world.player) {
    return result('units', false, 'the player token did not resolve to world.player');
  }
  if (world.unit('target') !== world.target) {
    return result('units', false, 'the target token did not resolve to world.target');
  }
  if (world.unit('nonsense') !== null) {
    return result('units', false, 'an unknown token answered with something');
  }
  const { target } = world;
  if (target === null) {
    return result('units', true, 'no target, so target-of-target went unchecked');
  }
  const victim = world.unit('targettarget');
  const expected = fightingId(target);
  if ((victim?.id ?? null) !== (expected ?? null)) {
    return result(
      'units',
      false,
      `targettarget resolved ${victim?.id ?? null}, expected ${expected}`,
    );
  }
  return result('units', true, `target is a ${target.kind}, fighting ${expected ?? 'nobody'}`);
}

/**
 * `world.reaction`, and the claim the whole reading rests on.
 *
 * The load-bearing half is the last one: the lookup exists because the game writes
 * `hostile` where it builds a MOB and never on a player, so a session in which any player
 * carries it is a session where this stopped being true, and the flag would then be
 * answering a question the bout is being asked. Nothing else can catch that, since a plate
 * built either way looks right until you meet somebody who wants to kill you.
 *
 * A hostile mob is checked in the other direction, because that is the one case where the
 * flag IS the answer and a rule that had stopped reading it would still pass every
 * friendly case.
 */
function checkReaction() {
  const { world } = woc;
  if (typeof world.reaction !== 'function') {
    return result('reaction', false, 'world.reaction is not callable');
  }
  if (world.reaction(NO_SUCH_ENTITY) !== null) {
    return result('reaction', false, 'an id nothing in scope holds answered with a reading');
  }
  let players = 0;
  let flagged = 0;
  for (const [id, entity] of world.entities) {
    const side = world.reaction(id);
    if (!REACTIONS.includes(side)) {
      return result('reaction', false, `entity ${String(id)} answered ${String(side)}`);
    }
    if (entity.kind === 'player') {
      players += 1;
      if (entity.hostile === true) {
        flagged += 1;
      }
    }
    if (
      entity.kind === 'mob' &&
      entity.hostile === true &&
      entity.ownerId === null &&
      side !== 'hostile'
    ) {
      return result('reaction', false, `a hostile mob (${String(id)}) read ${String(side)}`);
    }
  }
  if (flagged > 0) {
    return result(
      'reaction',
      false,
      `${String(flagged)} players carry hostile, which the game never sets`,
    );
  }
  return result('reaction', true, `${String(players)} players in scope, none flagged hostile`);
}

/**
 * The aura filters, checked against the unfiltered list they narrow. A filter that returned
 * everything would pass any spot check on a player with one aura, so this compares counts
 * against a hand-rolled filter over the same list.
 */
function checkAuraQueries() {
  const { world } = woc;
  if (typeof world.aurasOn !== 'function') {
    return result('aura queries', false, 'world.aurasOn is not callable');
  }
  if (world.aurasOn('nonsense').length > 0) {
    return result('aura queries', false, 'an unresolvable unit answered with auras');
  }
  const all = world.aurasOn('player');
  const mine = world.aurasOn('player', { mine: true });
  const { player } = world;
  if (player === null) {
    return result('aura queries', true, 'no world yet');
  }
  const expected = all.filter((one) => one.sourceId === player.id).length;
  if (mine.length !== expected) {
    return result('aura queries', false, `mine kept ${mine.length}, expected ${expected}`);
  }
  return result('aura queries', true, `${all.length} on you, ${mine.length} your own`);
}

/** Whichever way round `dispellable` was asked, the polarity it implies. */
function dispelsWrongWay(aura) {
  const harmful = woc.world.harmful(aura);
  return (
    (woc.world.dispellable(aura) && !harmful) || (woc.world.dispellable(aura, true) && harmful)
  );
}

/**
 * `harmful` is a function rather than a field because the loader hands over the game's own
 * aura objects, so there is nowhere to put a computed flag. That leaves two ways to ask
 * one question, and a filter that drifted from the predicate would leave one addon
 * highlighting what the next calls a benefit.
 *
 * `dispellable` is checked as an IMPLICATION rather than against a list of abilities:
 * whatever comes off an ally is harmful and whatever is stripped off an enemy is a
 * benefit, which holds for every effect and needs no fight to check.
 */
function checkAuraPolarity() {
  const { world } = woc;
  if (typeof world.harmful !== 'function' || typeof world.dispellable !== 'function') {
    return result('aura polarity', false, 'world.harmful or world.dispellable is not callable');
  }
  const all = world.aurasOn('player');
  const harmful = all.filter((aura) => world.harmful(aura));
  const queried = world.aurasOn('player', { harmful: true });
  if (queried.length !== harmful.length) {
    return result(
      'aura polarity',
      false,
      `the query kept ${String(queried.length)} auras and the predicate ${String(harmful.length)}`,
    );
  }
  const backwards = all.filter(dispelsWrongWay);
  if (backwards.length > 0) {
    return result('aura polarity', false, `${String(backwards.length)} dispel the wrong way round`);
  }
  if (all.length === 0) {
    return result('aura polarity', true, 'agreeing, nothing on you to sort');
  }
  const removable = all.filter((aura) => world.dispellable(aura)).length;
  return result(
    'aura polarity',
    true,
    `${String(harmful.length)} of ${String(all.length)} on you are harmful, ${String(removable)} removable`,
  );
}

function combatWord(active) {
  if (active) {
    return 'in combat';
  }
  return 'idle';
}

/**
 * The combat reading, and the honesty of the source it travels with.
 *
 * There is no combat flag on the wire, so this cannot check the answer against anything.
 * What it can check is that the shape holds and that the source is one the loader claims to
 * produce, which catches the reading degrading to a bare boolean or to a source string
 * nothing documents.
 *
 * A `recent` reading means every branch backed by server state declined and a five second
 * timer answered instead, which is the one case an addon may want to treat differently.
 */
function checkCombat() {
  const state = woc.world.combat;
  if (state === null || typeof state !== 'object') {
    return result('combat', false, 'world.combat is not a reading');
  }
  if (typeof state.active !== 'boolean') {
    return result('combat', false, `active is ${typeof state.active}, expected a boolean`);
  }
  const sources = ['party', 'threat', 'pvp', 'recent', 'none'];
  if (!sources.includes(state.source)) {
    return result('combat', false, `source is '${state.source}', which is not one of the five`);
  }
  if (!state.active && state.source !== 'none') {
    return result('combat', false, `inactive but sourced to '${state.source}'`);
  }
  return result('combat', true, `${combatWord(state.active)} via ${state.source}`);
}

/**
 * The combat records against what the published types say they carry. Vacuous until
 * something lands, which is the honest state: it becomes a real check on the first swing of
 * the first fight. Reporting it as passing with nothing seen would be the dishonest
 * version, so the note says which it is.
 */
function checkCombatRecords() {
  if (contradictions.length > 0) {
    return result('combat records', false, contradictions.join('; '));
  }
  if (records.damage === 0 && records.heals === 0 && records.auras === 0) {
    return result('combat records', true, 'nothing has landed yet, so there is nothing to check');
  }
  const seen = `${String(records.damage)} damage and ${String(records.heals)} heal records`;
  const ids = `${String(records.withAbilityId)} carried an abilityId`;
  const over = `${String(records.overhealed)} heals reported overheal`;
  const auras = `${String(records.auras)} aura records, ${String(records.aurasAttributed)} attributed`;
  return result(
    'combat records',
    true,
    `${seen} match the types, ${ids} (${String(records.resolved)} in your spellbook), ${over}, ${auras}`,
  );
}

/**
 * A mob's target, which is not on the field that looks like it. `targetId` is filled from a
 * selection and a mob does not select, so on every mob it is present, correctly typed and
 * permanently null; what a mob is fighting rides `aggroTargetId`, and its hate table rides
 * `threat`. The harness watches for the day the game starts filling `targetId` on mobs.
 */
function checkMobTargeting() {
  const mobs = [...woc.world.entities.values()].filter((entity) => entity.kind === 'mob');
  if (mobs.length === 0) {
    return result('mob targeting', true, 'no mobs in scope');
  }
  const withThreat = mobs.filter((mob) => mob.threat instanceof Map && mob.threat.size > 0);
  const wrongShape = mobs.filter((mob) => !(mob.threat instanceof Map));
  if (wrongShape.length > 0) {
    return result('mob targeting', false, `${wrongShape.length} mobs carry no threat Map`);
  }
  const selecting = mobs.filter((mob) => mob.targetId !== null);
  if (selecting.length > 0) {
    return result(
      'mob targeting',
      false,
      `${selecting.length} mobs carry targetId, which the types say never happens`,
    );
  }
  const aggroed = mobs.filter((mob) => mob.aggroTargetId !== null);
  return result(
    'mob targeting',
    true,
    `${mobs.length} mobs, ${aggroed.length} attacking, ${withThreat.length} with a hate table`,
  );
}

/**
 * Both ride `dynamicFields`, so both are real on every entity including your own player.
 *
 * The reading worth having is the COUNT of OTHERS carrying a ranged power, which is the
 * half the shape walk cannot reach: it visits the local player alone, so it can prove the
 * field is a number and say nothing about whether the entity path fills it.
 */
function checkEntityStats() {
  const { player } = woc.world;
  if (player === null) {
    return result('entity stats', true, 'no player yet, so there is nothing to read');
  }
  if (typeof player.helmHidden !== 'boolean') {
    return result('entity stats', false, `helmHidden is ${typeOf(player.helmHidden)}`);
  }
  if (typeof player.rangedPower !== 'number') {
    return result('entity stats', false, `rangedPower is ${typeOf(player.rangedPower)}`);
  }
  const armed = [...woc.world.entities.values()].filter((e) => (e.rangedPower ?? 0) > 0);
  const hidden = [...woc.world.entities.values()].filter((e) => e.helmHidden === true);
  return result(
    'entity stats',
    true,
    `yours ${String(player.rangedPower)}, ${armed.length} others carry ranged power, ${hidden.length} hide a helm`,
  );
}

/**
 * The sold-price ledger, which is the only record of a completed sale the game keeps.
 *
 * Gated on standing at the Merchant, so it is vacuous the rest of the time. What it checks
 * when it can is the pair that has to reconcile: rows are capped, and the overflow count is
 * what explains a `collectionCopper` the rows do not add up to.
 */
function checkSaleLedger() {
  const { market } = woc.world;
  if (market.status !== 'near') {
    return result('sale ledger', true, 'not at the Merchant, so there is no page to read');
  }
  // The browse ORDER, new in game 0.37.1. Checked for being one of the two the server can echo
  // rather than for either in particular, because which one is showing is the player's own
  // choice in the game's window and this addon must never ask them to change it.
  const { sort } = market.info;
  if (sort !== 'name' && sort !== 'price') {
    return result('sale ledger', false, `the browse order echoed back as ${typeOf(sort)}: ${sort}`);
  }
  const { collectionSales: sales, collectionSalesOmitted: omitted } = market.info;
  if (!Array.isArray(sales)) {
    return result('sale ledger', false, `collectionSales is ${typeOf(sales)}`);
  }
  if (typeof omitted !== 'number') {
    return result('sale ledger', false, `collectionSalesOmitted is ${typeOf(omitted)}`);
  }
  const proceeds = sales.reduce((sum, row) => sum + row.proceeds, 0);
  if (omitted === 0 && sales.length > 0 && proceeds !== market.info.collectionCopper) {
    return result(
      'sale ledger',
      false,
      `${String(proceeds)} in rows, none omitted, but the` +
        ` counter holds ${String(market.info.collectionCopper)}`,
    );
  }
  return result(
    'sale ledger',
    true,
    `sorted by ${sort}, ${String(sales.length)} sales waiting, ${String(omitted)} dropped by the cap`,
  );
}

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className !== undefined) {
    el.className = className;
  }
  if (text !== undefined) {
    el.textContent = text;
  }
  return el;
}

/** Failures are coloured; a pass takes whatever the frame's own text colour is. */
function lineColor(ok) {
  if (ok) {
    return 'inherit';
  }
  return FAIL_COLOR;
}

/** The two-column-aligned verdict a report line starts with. */
function verdict(ok) {
  if (ok) {
    return 'ok';
  }
  return 'FAIL';
}

function renderResults(results) {
  const showAll = woc.settings.detail === 'everything';
  const passed = results.filter((entry) => entry.ok).length;

  const list = element('ul');
  list.style.listStyle = 'none';
  list.style.padding = '0';
  list.style.margin = '0';
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '4px';

  for (const entry of results) {
    const row = element('li');
    row.style.color = lineColor(entry.ok);
    row.append(element('strong', undefined, `${verdict(entry.ok)}  ${entry.name}`));
    if (!entry.ok || showAll) {
      const note = element('div', undefined, entry.note);
      note.style.opacity = '0.75';
      note.style.fontSize = '13px';
      row.append(note);
    }
    list.append(row);
  }

  report.replaceChildren(
    element('p', undefined, `${String(passed)} of ${String(results.length)} checks passed.`),
    list,
  );
  return passed === results.length;
}

function button(label, onClick) {
  const el = element('button', undefined, label);
  el.type = 'button';
  el.style.cursor = 'pointer';
  el.addEventListener('click', onClick);
  return el;
}

/**
 * Re-run the live half and repaint, keeping the slow half's last answer. Skipped while the
 * window is hidden: the checks are cheap, but painting a report nobody is looking at is
 * not, and the harness has no business doing DOM work at snapshot rate during a fight.
 */
function refresh() {
  if (!win.visible) {
    return;
  }
  renderResults([...runLiveChecks(), ...slowResults]);
}

/**
 * The full pass, including the slow half, which is what a button press is for. The slow
 * results are then held so a live repaint can show them without redoing a storage round
 * trip on every target change.
 */
function run() {
  report.replaceChildren(element('p', undefined, 'Running the checks...'));
  runSlowChecks()
    .then((results) => {
      slowResults = results;
      const allPassed = renderResults([...runLiveChecks(), ...slowResults]);
      if (allPassed) {
        woc.log('every check passed');
      } else {
        woc.warn('some checks failed');
      }
    })
    .catch((err) => {
      woc.error('the harness itself threw', err);
      report.replaceChildren(element('p', undefined, `The harness threw: ${String(err)}`));
    });
}

/**
 * A timer bar, drained by a frame loop so the fill can be watched moving. The reason a bar
 * is a manual trigger rather than a check: a suite can assert the width string the addon
 * wrote, and cannot see whether the row is legible, whether the icon lines up with the
 * label, or whether the countdown's digits shuffle as they change.
 */
function demoBar() {
  const bar = woc.ui.bar({
    label: 'Fireball (demo)',
    icon: woc.ui.icon.ability('fireball', 'mage'),
    detail: 'a bar, drained from a frame loop',
  });
  bar.el.style.width = `${String(DEMO_WIDTH)}px`;
  stage.appendChild(bar.el);

  const startedAt = woc.now();
  const drain = () => {
    const elapsed = (woc.now() - startedAt) / MS_PER_SECOND;
    const left = Math.max(DEMO_SECONDS - elapsed, 0);
    if (left <= 0) {
      bar.destroy();
      return;
    }
    const fraction = left / DEMO_SECONDS;
    bar.update({
      fraction,
      value: `${left.toFixed(1)}s`,
      tone: barTone(fraction),
    });
    woc.requestAnimationFrame(drain);
  };
  drain();
}

/**
 * The same timer as a square, drained beside the bar so the two can be compared.
 *
 * A row of them rather than one, because everything a tile gets wrong is only visible
 * against its neighbours: whether the wedges sweep the same way, whether the countdown
 * stays put while its digits change, whether a school border reads as a border.
 *
 * One of the three deliberately points at art that does not exist. The kit hides a slot
 * whose image fails, and on a tile that leaves a bare square with its timer still on it.
 */
function demoTiles() {
  const row = element('div');
  row.style.display = 'flex';
  row.style.gap = '4px';
  row.style.marginTop = '6px';
  stage.appendChild(row);

  const tiles = DEMO_TILES.map(([label, ability, cls, school]) => {
    const tile = woc.ui.tile({ label, icon: woc.ui.icon.ability(ability, cls), school, count: 2 });
    row.appendChild(tile.el);
    return tile;
  });

  const startedAt = woc.now();
  const drain = () => {
    const elapsed = (woc.now() - startedAt) / MS_PER_SECOND;
    const left = Math.max(DEMO_SECONDS - elapsed, 0);
    if (left <= 0) {
      row.remove();
      for (const tile of tiles) {
        tile.destroy();
      }
      return;
    }
    const fraction = left / DEMO_SECONDS;
    for (const tile of tiles) {
      tile.update({ fraction, value: left.toFixed(0), tone: barTone(fraction) });
    }
    woc.requestAnimationFrame(drain);
  };
  drain();
}

/** Warm as it runs out, which is the tone change the kit draws. */
function barTone(fraction) {
  if (fraction <= DEMO_WARN) {
    return 'warn';
  }
  return 'default';
}

/**
 * A settings pane built from the kit, which is the point of the field family. A manual
 * demonstration for the reason the bar is: a suite can assert the value a control reports
 * and cannot see whether the row lines up with the one under it, or whether any of it looks
 * like it belongs in a loader frame.
 */
function demoForm() {
  const form = element('div', 'woc-form');
  form.style.marginTop = '8px';
  stage.replaceChildren(form);

  const say = (what) => {
    woc.log('form:', what);
  };
  form.append(
    woc.ui.field.checkbox({ label: 'Include pet damage', value: true, onChange: say }).el,
    woc.ui.field.slider({ label: 'Rolling window', value: 5, min: 1, max: 60, onChange: say }).el,
    woc.ui.field.select({
      label: 'Anchor',
      value: 'top',
      options: ['top', 'bottom'],
      onChange: say,
    }).el,
    woc.ui.field.text({ label: 'Window title', value: 'DPS', placeholder: 'DPS', onChange: say })
      .el,
    woc.ui.tabs({
      tabs: [
        { id: 'damage', label: 'Damage' },
        { id: 'healing', label: 'Healing' },
      ],
      onSelect: say,
    }).el,
  );
}

/**
 * A context menu, opened at the button that asked for it. The half worth looking at is the
 * dismissal: it has to go on Escape, on a click anywhere else including one the game's own
 * controls swallow, and on choosing something. None of that is visible in an assertion.
 */
function demoMenu(at) {
  woc.ui.menu(at, [
    { label: 'Reset the meter', onSelect: () => woc.log('menu: reset') },
    { label: 'Nothing to report', onSelect: () => undefined, disabled: true },
    { label: 'Close this addon', onSelect: () => woc.log('menu: close'), separator: true },
  ]);
}

/**
 * The tooltip in its structured form, on a row that names an ability.
 *
 * A string still works and is what most attachments want; this is the case the
 * builder exists for, where a hovered row says what the game's own tooltips say.
 */
function demoTooltip() {
  const row = element('div', 'woc-row-desc', 'Hover me: a tooltip with a title, art and tones');
  row.style.marginTop = '8px';
  stage.replaceChildren(row);
  woc.ui.tooltip(row, {
    title: 'Fireball',
    icon: woc.ui.icon.ability('fireball', 'mage'),
    lines: [
      '55 mana',
      { text: '35 yd range, 2.5 sec cast', tone: 'muted' },
      { text: 'Deals fire damage to the target.', tone: 'default' },
      { text: 'Requires a target you are in combat with', tone: 'danger' },
    ],
  });
}

/**
 * A badge to hang on a world anchor. Styled inline from the game's own custom properties
 * rather than from a copy of them, so a badge written this way follows the player's theme.
 * The loader gives an anchor no look of its own, since what belongs over a world point is
 * the addon's business.
 */
function anchorBadge(text) {
  const badge = element('div', undefined, text);
  badge.style.padding = '2px 8px';
  badge.style.whiteSpace = 'nowrap';
  badge.style.fontSize = '13px';
  badge.style.borderRadius = 'var(--radius-sm, 4px)';
  badge.style.border = '1px solid var(--color-border-default, rgb(78 61 29))';
  badge.style.background = 'var(--panel-base, rgb(21 21 31))';
  badge.style.color = 'var(--gold, rgb(255 209 0))';
  return badge;
}

/**
 * A world point that will still mean this point later. The game mutates an entity's `pos`
 * in place rather than replacing it, so holding the object holds "wherever that unit is
 * now" and never "where it was": a distance measured against the live object reads 0.0 yd
 * from anywhere on the map.
 */
function snapshot(pos) {
  if (pos === null || pos === undefined) {
    return null;
  }
  return { x: pos.x, y: pos.y, z: pos.z };
}

/** Yards along the ground: y is height, so the distance a player reads ignores it. */
function groundDistance(from, to) {
  if (from === null || to === null) {
    return null;
  }
  return Math.hypot(to.x - from.x, to.z - from.z);
}

function distanceWord(from, to) {
  const yards = groundDistance(from, to);
  if (yards === null) {
    return 'no player';
  }
  return `${yards.toFixed(DECIMALS_YARDS)} yd`;
}

/** The unit a plate follows: your target if you have one, otherwise you. */
function platedUnit() {
  return woc.world.target ?? woc.world.player;
}

/**
 * What the following plate says. With no target it plates you, and the distance from you to
 * yourself is zero: a true number that demonstrates nothing. So it says what it is instead,
 * and the distance appears when there is something to be a distance from.
 */
function plateText() {
  const unit = platedUnit();
  if (unit === null) {
    return 'nobody';
  }
  if (unit === woc.world.player) {
    return `${unit.name} (you, take a target)`;
  }
  return `${unit.name} (${distanceWord(woc.world.player?.pos ?? null, unit.pos)})`;
}

/**
 * Two anchors, because the halves fail differently: the following one takes a function
 * and tracks what it is pointed at, while the pinned one is a fixed point captured where
 * you stood, which is the only way to watch the culling work.
 *
 * The labels are rewritten on a slow timer and the positions are NOT: an addon moving
 * these itself would be running a second frame loop beside the loader's.
 */
function startAnchors() {
  const plate = woc.ui.anchor3d(() => platedUnit()?.pos ?? null, { offset: { y: -PLATE_LIFT } });
  const plateBadge = anchorBadge('');
  plate.el.appendChild(plateBadge);

  const here = snapshot(woc.world.player?.pos);
  const pin = woc.ui.anchor3d(here ?? { x: 0, y: 0, z: 0 });
  const pinBadge = anchorBadge('');
  pin.el.appendChild(pinBadge);

  const label = () => {
    plateBadge.textContent = plateText();
    pinBadge.textContent = `pinned, ${distanceWord(woc.world.player?.pos ?? null, here)} away`;
  };
  label();
  const timer = woc.setInterval(label, ANCHOR_TICK_MS);

  return () => {
    woc.clearInterval(timer);
    plate.destroy();
    pin.destroy();
  };
}

/** The demo's teardown while it is running, or null while it is not. */
let stopAnchors = null;

/**
 * Put two anchors in the world, or take them away again. A toggle rather than a one-shot:
 * the point of these is to walk around and watch them behave.
 */
function demoAnchors() {
  if (stopAnchors !== null) {
    stopAnchors();
    stopAnchors = null;
    woc.ui.toast('Anchors removed', { timeout: TOAST_MS });
    return;
  }
  if (woc.world.player === null) {
    woc.ui.toast('No world yet, so there is nothing to anchor to', { timeout: TOAST_MS });
    return;
  }
  stopAnchors = startAnchors();
  woc.ui.toast('Anchors placed: walk away and turn around', { timeout: TOAST_MS });
}

/** Null is a cancelled prompt, which is not a failure. */
function describeCapture(combo) {
  if (combo === null) {
    return 'Capture cancelled';
  }
  return `Captured ${combo}`;
}

function showAlert() {
  woc.ui
    .alert({
      title: 'Dev Harness',
      message: 'This modal resolves even if the addon is disabled while it is open.',
      buttons: [
        { id: 'ok', label: 'Understood', primary: true },
        { id: 'cancel', label: 'Cancel', cancel: true },
      ],
    })
    .then((pressed) => {
      woc.log('alert resolved with', pressed);
    })
    .catch((err) => {
      woc.error('alert rejected, which it never should', err);
    });
}

function captureKey() {
  woc.ui.toast('Press any key', { timeout: TOAST_MS });
  woc.keys
    .capture()
    .then((combo) => {
      woc.log('captured', combo);
      woc.ui.toast(describeCapture(combo), { timeout: TOAST_MS });
    })
    .catch((err) => {
      woc.error('capture rejected, which it never should', err);
    });
}

/**
 * The two announcement surfaces, and the two steps of the louder one. A toast and a banner
 * are easy to confuse in a description and impossible to confuse once both have been seen:
 * one waits its turn at the top of the screen, the other lands over the middle of the view.
 *
 * Both banner sizes get a button because the judgement they need is comparative: a warning
 * is loud enough only relative to what else is on screen during a fight.
 */
const ANNOUNCEMENTS = [
  ['Toast', () => woc.ui.toast(`Uptime ${String(uptimeSeconds())}s`, { timeout: TOAST_MS })],
  [
    'Banner',
    () =>
      woc.ui.banner('Soul Rend', {
        detail: 'the normal size, for a mechanic you react to',
        kind: 'warn',
        timeout: BANNER_MS,
      }),
  ],
  [
    'Big banner',
    () =>
      woc.ui.banner('Deathless Rage', {
        detail: 'the large size, for one that ends the pull',
        kind: 'danger',
        size: 'large',
        timeout: BANNER_MS,
      }),
  ],
];

/** The manual half: the surfaces a check cannot assert, only a person can see. */
function controls() {
  const row = element('div');
  // Built first so the menu can be opened AT it: `ui.menu` takes an element or a
  // point, and anchoring to the control that asked is the ordinary case.
  const menuButton = button('Menu', () => {
    demoMenu(menuButton);
  });
  row.style.display = 'flex';
  row.style.flexWrap = 'wrap';
  row.style.gap = '6px';
  row.style.marginTop = '10px';

  row.append(
    button('Run again', run),
    button('Play cue', () => {
      woc.sound.play(String(woc.settings.cue));
    }),
    ...ANNOUNCEMENTS.map(([label, show]) => button(label, show)),
    button('Bar', demoBar),
    button('Tiles', demoTiles),
    button('Form', demoForm),
    button('Tooltip', demoTooltip),
    button('Anchors', demoAnchors),
    menuButton,
    button('Alert', showAlert),
    button('Capture a key', captureKey),
  );

  woc.ui.tooltip(row, 'Each button drives one surface the automated checks cannot assert.');
  return row;
}

/**
 * Repaint on the next tick rather than on every key that moved. Several of the watched keys
 * change on the same frame constantly: taking a target moves `target`, `casts` and
 * `entities` at once.
 */
let pending = null;

function scheduleRefresh() {
  if (pending !== null) {
    return;
  }
  pending = woc.setTimeout(() => {
    pending = null;
    refresh();
  }, REFRESH_DEBOUNCE_MS);
}

// Subscribed for the whole session rather than only while the window is open. The watcher
// samples a subscribed key once per animation frame, so this does cost something with the
// report hidden; the reason to accept it is that this is a development addon, and the
// alternative is unsubscribing on hide with no way to know the window was closed.
for (const key of LIVE_KEYS) {
  woc.world.on(key, scheduleRefresh);
}

/** Opening the window repaints it: it may have been hidden for a whole fight. */
function openReport() {
  win.show();
  refresh();
}

// Bound by hand rather than through `toggleKey`, on the member's own advice: this key
// does more than toggle. `checkToggleKey` exercises it against `probe` instead.
woc.keys.bind('toggle', () => {
  win.toggle();
  woc.sound.play('ui_click');
  refresh();
});

woc.keys.bind('run', () => {
  win.show();
  run();
});

woc.ui.microButton({
  id: 'harness',
  label: 'Dev Harness',
  onClick: () => {
    win.toggle();
    refresh();
  },
});

woc.ui.menuEntry({
  id: 'harness',
  label: 'Dev Harness',
  onClick: openReport,
});

// A settings change re-runs the checks, which is what makes the manager's
// settings form visibly wired rather than merely persisted.
woc.onSettingsChange(() => {
  woc.log('settings changed, re-running');
  run();
});

woc.onDispose(() => {
  woc.log(`disposed after ${String(uptimeSeconds())}s`);
});

// Appended once, after the containers: a live repaint replaces the report and
// must not take the buttons with it.
win.body.insertBefore(controls(), stage);

run();
