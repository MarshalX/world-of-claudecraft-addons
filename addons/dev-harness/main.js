/// <reference types="@woc-addons/types" />

// Dev Harness: run every part of the addon API against the real game and say what worked.
//
// An ordinary addon using only what the loader publishes, so it catches what a unit suite
// cannot: a live game that is not the shape the fakes assume, and a surface never wired to
// the object an addon is handed. It never touches game state: it reads, renders into the
// loader's root, or plays a sound.

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
 * The scaling probe: 205 split between 8 rows with a 3px gap is 23 each, a kit row's natural
 * height. Stated rather than computed, so the check fails if the division moves.
 */
const SCALE_BOX = 205;
const SCALE_ROWS = 8;
const SCALE_GAP = 3;
const SCALE_MIN = 12;
const SCALE_SHARE = 23;
const SCALE_WIDTH = 240;
/**
 * What the formatting check puts through. 59.5 reads as `60`, not `1m`, since the minute
 * branch is chosen on the raw value before the ceiling; 3720 is an hour and two minutes.
 */
const FMT_INPUT = {
  seconds: 45,
  nearlyAMinute: 59.5,
  minutes: 90,
  anHour: 3720,
  one: 1,
  many: 4,
  pair: 2,
  /** Read as a figure, never as an absence. */
  zero: 0,
};

/** A quarter turn, where the sign convention is either right or backwards. */
const QUARTER_TURN_DEGREES = 90;

/** Straight ahead, a right turn and a left one. */
const COMPASS_CASES = [
  ['ahead', FMT_INPUT.zero, '↑'],
  ['to the right', QUARTER_TURN_DEGREES, '→'],
  ['to the left', -QUARTER_TURN_DEGREES, '←'],
];
/** How far east of the player the geometry probe measures, and what counts as agreement. */
const PROBE_YARDS = 10;
const PROBE_TOLERANCE = 0.01;

/**
 * The tile demonstration's squares, as label, ability, class, school. The last names an
 * ability with no art, so its slot collapses to the wedge and figures alone.
 */
const DEMO_TILES = [
  ['Fireball', 'fireball', 'mage', 'fire'],
  ['Frostbolt', 'frostbolt', 'mage', 'frost'],
  ['Nothing painted', 'not_an_ability', 'mage', 'shadow'],
];

/**
 * Every key the published types say `world.on` accepts, written out as an independent copy
 * of the loader's list: a key in the types and missing from the runtime throws here.
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
  'vault',
  'craftVaultStock',
  'buyback',
];
/**
 * Every way the published types say an attack can land, an independent copy like
 * `WORLD_KEYS`: an unlisted kind reaches an addon as a plain string and is silently wrong.
 */
const DAMAGE_KINDS = ['hit', 'miss', 'dodge', 'parry', 'block', 'resist', 'evade'];
/** An arbitrary nested value, to show that storage is not flattened to strings. */
const PROBE_VALUE = Object.freeze(['a', ['b'], { c: true }]);
/** Matches --color-text-error, so a failed line reads the way the manager's do. */
const FAIL_COLOR = 'rgb(255 143 133)';

/** The declared sibling file and its marker. Deliberately inert: the route is what is checked. */
const DATA_FILE = 'data.json';
const DATA_MARKER = 'dev-harness data file';
/** A name no manifest declares, which is the only reason it is refused. */
const UNDECLARED_FILE = '../../secrets.json';

/** The world reads gated on standing at something, which all share one shape. */
const GATED_READS = ['market', 'mail', 'bank', 'vault'];
/** The three states one of those can be in, and there is no fourth. */
const GATED_STATES = ['near', 'away', 'unknown'];

/** Bag sockets a bank has, whatever it has bought: the index IS the socket number. */
const BANK_SOCKETS = 4;
/** Rungs a vault can buy, after which there is no next price to quote. */
const VAULT_RUNGS = 5;
/** A speed multiplier at one decimal rounds 1.15 to 1.2, which is a different snare. */
const DECIMALS_MULT = 2;

/** Epoch milliseconds at the start of 2020, which any real wall clock is past. */
const EPOCH_FLOOR_MS = 1_577_836_800_000;
/** The ceiling `woc.onFrame` documents for its delta, however long a tab slept. */
const MAX_FRAME_DT_MS = 250;

/**
 * `now()` is monotonic from page load and measures intervals; `wallClock()` is epoch and is
 * the one to store. A stored `now()` reading looks like the future on the next load.
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
// Subscribed for the session: the watcher already samples once per animation frame.
woc.onFrame((dt) => {
  framesTicked += 1;
  lastFrameDt = dt;
});

/**
 * Subscribed and dropped at once, so any count is the loader calling a torn-down handler,
 * which would keep running against a disabled addon.
 */
let strayFrames = 0;
woc.onFrame(() => {
  strayFrames += 1;
})();

/**
 * Whether the game still matches the published types. These records pass through the loader
 * untouched, so only a live session can catch drift. The claims: `evade` lands at 0;
 * `absorbed` is absent rather than 0 (the only thing parting a shielded heal from an
 * overheal); `abilityId` is a string whenever it is set.
 *
 * Not watched: whether a non-null `abilityId` only rides a player's own hit, since its source
 * can have left interest scope and the check would report the roster as the wire.
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
/** The distinct contradictions seen, named, since a count does not say what broke. */
const contradictions = [];

function contradiction(note) {
  if (contradictions.length < MAX_CONTRADICTIONS && !contradictions.includes(note)) {
    contradictions.push(note);
  }
}

/**
 * Counts a damage record's `abilityId` and whether the spellbook resolves it. Null is the
 * common answer: the game fills it only on a player's primary direct hit.
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
  // Absent, never 0 or null: both a shielded heal and an overheal land at `amount: 0`.
  if (event.absorbed === 0 || event.absorbed === null) {
    contradiction(`a heal carried absorbed ${String(event.absorbed)}, which is meant to be absent`);
  }
  noteOverheal(event);
});

/**
 * Overheal is published as absent-or-positive, and partial only. The partial rule cannot be
 * checked here: a fully overhealing tick emits no record at all.
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
 * Aura attribution, the only route to a mob ability's id. `sourceId` and `abilityId` ride
 * one emit path, so they arrive together or not at all. `refresh` marks a re-application with
 * no fade, so one on a non-gain would silently break gain-versus-fade counting.
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
    // Not a failure: the game writes the footer after document-start.
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
  // Settings live in their own namespace, so an addon's keys() must not report them.
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
 * The store refusing a write for a character the world can name, or null. Read together
 * with `world.characterKey` so a login cannot land between the two. Only this direction
 * fails: the other is what this addon's suite arranges on purpose.
 */
function refusedWhileKnown(accepted) {
  const key = woc.world.characterKey;
  if (accepted || key === null) {
    return null;
  }
  return `a per-character write was refused while characterKey is "${key}"`;
}

/**
 * The per-character store. The first write decides which half runs, not `world.player`, so
 * the check still fails when the coupling between them is what broke. Which half ran is
 * reported, not asserted.
 */
async function checkCharacterStorage() {
  const store = woc.storage.character;
  if (typeof store?.set !== 'function') {
    return result('character storage', false, 'storage.character is not on the object');
  }
  const key = 'harness-probe';
  // Not a read: a read before world entry is contracted not to settle, and would hang.
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
  // The listing must strip the realm and character from each key.
  if (!keys.includes(key)) {
    return result('character storage', false, `keys() did not list it: ${keys.join(', ')}`);
  }
  if (gone !== 'absent') {
    return result('character storage', false, 'delete left the value behind');
  }
  // Separate stores, not one with a prefix. Written last so checkStorage cleans up the key.
  await woc.storage.set(key, 'account-wide');
  const stillMine = await store.get(key, 'absent');
  await woc.storage.delete(key);
  if (stillMine !== 'absent') {
    return result('character storage', false, 'an account-wide key was visible as this character');
  }
  // Named so a store answering before the world names a character reads as "null" here.
  return result(
    'character storage',
    true,
    `round trip over ${String(keys.length)} key(s), world names ${String(woc.world.characterKey)}`,
  );
}

/**
 * The declared file: parsed by the loader, and the same object every call. It is answered
 * from the install cache, so a document with no marketplace behind it rejects, and that is
 * reported rather than failed.
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
 * The declared file, and an undeclared one. `woc.data` checks membership in the manifest's
 * `data` list and never joins its argument onto a URL, so a traversing name is refused for
 * being undeclared.
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
  // The message names what is declared: the usual cause is a file missing from the manifest.
  if (!refusal.includes(DATA_FILE)) {
    return result('data', false, `the refusal did not say what is declared: ${refusal}`);
  }
  return await readDataFile();
}

/**
 * One addon cannot prove two reach each other, so this checks that the bus is callable,
 * that `anySender` is a real value, and that an addon never hears its own messages.
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
 * The cue list is empty until the SFX pack is fetched, so preloading nothing waits for it
 * before `cues()` is read.
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
  // A cue is not a file: the pack collapses a numbered family into one cue.
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
  // A 'stored' source means only saved bindings were read, so empty does not mean free.
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
 * Every published key is watchable and every read answers. Reads are checked for presence,
 * not value: before world entry most are legitimately null, while a missing key is undefined.
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
 * `castStart` never fires for a mob, so `world.casts` is the only way to see a boss cast.
 * Without a fight, this checks it agrees with the cast fields on the live roster.
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
 * Whether the loader's stylesheet is in this document. Headless runs carry no CSS, and that
 * has to be told apart from a rule missing because its class was renamed.
 */
function sheetLive() {
  return getComputedStyle(win.el).position === 'absolute';
}

/**
 * Measures that the sheet reaches a kit class, which no suite can: a class renamed on one
 * side passes every test and draws nothing. Attached briefly, since kit rules are scoped
 * under the loader's root and a detached element has no computed style.
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

  // The fraction is what remains and the wedge covers what has elapsed.
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
 * The field and tab builders reached `woc.ui`, and `set` moves a control without calling
 * back, or a pane that saves on change writes the value straight back.
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
 * A row that survives a sync must be the same row, since an addon holds measured state on
 * it. A row past the budget leaves the parent and stays alive, so `size` counts it.
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
  // The walk includes rows not drawn: a fade needs the pin off the list too.
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
 * Every builder writes a class, never an inline style: an inline style outranks every
 * selector and would silently drop the coarse-pointer floor.
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
  // Visibility is the camera's business: the player can be behind it.
  return result('anchor', true, `anchored to you, ${onScreenWord(visible)}`);
}

/** Whether the first frame had placed it yet. */
function onScreenWord(visible) {
  if (visible) {
    return 'on screen';
  }
  return 'off screen or not yet placed';
}

/**
 * Where a world point lands on screen. A point behind the camera answers null, never
 * coordinates, which would put a marker on the wrong side of the player.
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

/** Which of the two answers came back. */
function artWord(built) {
  if (built === null) {
    return 'withheld, the manifest says there is no file';
  }
  return 'built';
}

/**
 * The icon URL builders answer, and refuse an id they cannot build a name from. `ability`
 * and `item` have a served manifest, so each is the optimistic URL until it lands and null
 * for an id with no file after; either is accepted here. `mob` has no manifest.
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
  // The art source name, never the item's name. A name at all means there is a file.
  if (icon.itemArtName('baked_bread') !== null && item === null) {
    return result('icons', false, 'itemArtName named art for an item with no icon');
  }
  // A missing class is what an addon hits before world entry, and must answer null.
  if (icon.ability('fireball', '') !== null) {
    return result('icons', false, 'ability() built a path with no class in it');
  }
  // `aura` is not optimistic: it answers null until its manifest lands, so only the
  // refusal of an unusable id is checkable here.
  if (icon.aura('') !== null) {
    return result('icons', false, 'aura() built a path from an empty id');
  }
  return result('icons', true, `empty ids refused, baked_bread ${artWord(item)}`);
}

/**
 * Whether the game still serves the aura art manifest: the read resolves and a known member
 * comes back with a URL. The family covers only auras no ability names, so which ones a
 * session sees is content and is not checked.
 */
async function checkAuraArt() {
  await woc.ui.icon.preloadAuras();

  // Neither an encounter's nor a battleground's, so any session can resolve it.
  const known = woc.ui.icon.aura('resurrection_sickness');
  if (known === null) {
    return result('aura art', false, 'manifest read but resurrection_sickness has no URL');
  }
  if (!known.startsWith('/ui/')) {
    return result('aura art', false, `aura() built ${known}`);
  }
  // An ability-applied aura belongs to `ability()`, as in the game's own resolver, so a
  // URL here means the two families overlap.
  if (woc.ui.icon.aura('rejuvenation') !== null) {
    return result('aura art', false, 'an ability-applied aura resolved in the aura family too');
  }
  return result('aura art', true, `manifest read, resurrection_sickness ${known}`);
}

/**
 * The skill art manifest for the player's class: that the game serves it and its ids line up
 * with the spellbook. Not every ability ships a file, so this only counts them.
 */
async function checkSkillArt() {
  const cls = woc.world.player?.templateId ?? '';
  if (cls === '') {
    return result('skill art', true, 'no player yet, so no class to read a manifest for');
  }
  await woc.ui.icon.preload(cls);

  // The whole kit; the cooldown map's keys would see only abilities already on cooldown.
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
 * `woc.now()` counts from page load and `woc.wallClock()` is epoch milliseconds. A wall
 * reading below 2020 is not an epoch stamp, and a monotonic one at or above it means `now()`
 * is wired to the wrong source.
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
 * Zero frames is not a failure, since this document may have no animation loop. There is no
 * callable check: a missing `onFrame` throws at load, before any check runs.
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
 * Each shadowed global, touched by a property read only: if the shadow were absent these must
 * be harmless, and `new WebSocket(...)` would open a real socket.
 */
const SHADOW_PROBES = [
  ['localStorage', () => localStorage.length],
  ['sessionStorage', () => sessionStorage.length],
  ['indexedDB', () => indexedDB.databases],
  ['XMLHttpRequest', () => XMLHttpRequest.prototype],
  ['WebSocket', () => WebSocket.prototype],
];

/**
 * The loader shadows the riskiest globals so reaching for one throws and names the API to
 * use. It is a guardrail against accidents, not a sandbox.
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

/** What a display could guess from an id alone. */
function titleCase(id) {
  return id
    .split('_')
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * `titleCase` above is the oracle: the published member must agree with it, or a migrated
 * addon draws different words. Durations round up, so a running timer never reads 0.
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
  // Absent is empty and zero is a reading; a falsy test passes one and breaks the other.
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
 * The spellbook's id-to-name bridge: every ability round-trips through both lookups, and a
 * name that is not the player's (every mob ability, to a meter) answers null.
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
  // How many names a title-cased id would get wrong.
  const diverged = book.known.filter((info) => info.name !== titleCase(info.id));
  return result(
    'abilities',
    true,
    `${String(book.known.length)} known, ${String(diverged.length)} unguessable from the id`,
  );
}

/**
 * `describe` answers with no world: an unknown id comes back title-cased under
 * `known: false`. Drawing the mark is the addon's job, so only the fact is checked.
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
 * One ability's optional shape fields, which are absent rather than false or zero when they do
 * not apply. `offGcd` is published only when true, so it has nothing to check.
 */
function abilityShapeFault(info) {
  const { empowerStages: stages, channel } = info;
  if (stages !== undefined && (!Number.isInteger(stages) || stages < 1)) {
    return `${info.id} claims ${String(stages)} empower stages`;
  }
  if (channel === undefined) {
    return null;
  }
  if (
    !(Number.isFinite(channel.duration) && Number.isInteger(channel.ticks)) ||
    channel.ticks < 1
  ) {
    return `${info.id} channels ${String(channel.duration)}s over ${String(channel.ticks)} ticks`;
  }
  // A channel's length lives here, so a channel with a cast time contradicts the types.
  if (info.castTime !== 0) {
    return `${info.id} is a channel and still carries a ${String(info.castTime)}s cast time`;
  }
  return null;
}

/**
 * The optional ability shape fields across the player's spellbook. A class with none is an
 * ordinary reading. `empowerStages` is the count; the live stage is on no wire.
 */
function checkAbilityShapes() {
  const known = woc.world.abilities?.known ?? [];
  if (known.length === 0) {
    return result('ability shapes', true, 'no spellbook yet, so there is nothing to shape-check');
  }
  const faults = known.map(abilityShapeFault).filter((one) => one !== null);
  if (faults.length > 0) {
    return result('ability shapes', false, faults.slice(0, MAX_CONTRADICTIONS).join('; '));
  }
  const empower = known.filter((info) => info.empowerStages !== undefined).length;
  const channels = known.filter((info) => info.channel !== undefined).length;
  const instant = known.filter((info) => info.offGcd !== undefined).length;
  return result(
    'ability shapes',
    true,
    `of ${String(known.length)} known: ${String(empower)} empower, ` +
      `${String(channels)} channel, ${String(instant)} off the global cooldown`,
  );
}

/**
 * Only "no world" is separable here; a renamed member would also answer null with a live
 * player, looking like an offline session.
 */
function noMultWord() {
  if (woc.world.player === null) {
    return 'no world yet, so the server has sent no multiplier';
  }
  return 'a live player and still no answer: offline, spectating, or the older movement wire';
}

/**
 * The server's movement multiplier. Null before world entry, offline, spectating and on the
 * older movement wire, none a failure. Null must never read as 1, which is a real reading.
 */
function checkMoveSpeed() {
  const mult = woc.world.moveSpeedMult;
  if (mult === undefined) {
    return result('move speed', false, 'world.moveSpeedMult never reached the object');
  }
  if (mult === null) {
    return result('move speed', true, noMultWord());
  }
  if (!Number.isFinite(mult) || mult <= 0) {
    return result('move speed', false, `the server sent a multiplier of ${String(mult)}`);
  }
  return result('move speed', true, `moving at ${mult.toFixed(DECIMALS_MULT)}x your base speed`);
}

/**
 * Checked against the player's own position, where the answers are known. A null with a live
 * player means the surface reads a position the loader does not have.
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
 * Nobody receives their own messages, so only these are checkable: both halves callable, the
 * two controls handed back, and following your own topic hearing nothing.
 */
function checkPublish() {
  const { bus } = woc;
  if (typeof bus?.publish !== 'function' || typeof bus.follow !== 'function') {
    return result('publish', false, 'bus.publish or bus.follow is not callable');
  }
  let heard = 0;
  let asked = 0;
  // Reads no addon state: a producer runs inside `publish`, while the body is still evaluating.
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
 * Two `woc.paint` requests before a frame must produce one paint. It waits on `onFrame`, not
 * `requestAnimationFrame`: a repaint rides the loader's loop, which rAF does not drive when
 * something else ticks it. A loop that never ticked is a stated skip.
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
    // Before the watch, so the paint runs first within a frame.
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
 * Nothing else claims `probe`, so a registration under it came from the frame. Destroying the
 * frame must release the bind, or a rebuild leaves a key pointing at a panel that is gone.
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
 * The sizing surfaces: `frame.box()`, `ui.units`, a row's size, and `ui.itemCell`. The row is
 * measured, since the sheet derives its height and no suite can see that. The item cell is
 * only reported: it is a transcription of the game's bag grid with nothing to compare to.
 */
function checkScaling() {
  const { units, bar, itemCell } = woc.ui;
  if (typeof units !== 'function' || typeof bar !== 'function') {
    return result('scaling', false, 'ui.units or ui.bar is not callable');
  }
  // Unwired, it reads as `undefined` and a grid sized off it lays out at NaN without throwing.
  if (typeof itemCell !== 'number' || !Number.isFinite(itemCell) || itemCell <= 0) {
    return result('scaling', false, `ui.itemCell is ${String(itemCell)} rather than a size`);
  }
  const share = units(SCALE_BOX, { count: SCALE_ROWS, gap: SCALE_GAP, min: SCALE_MIN });
  const probe = woc.ui.frame({ id: 'scale-probe', title: 'Probe', width: SCALE_WIDTH });
  // Called defensively: an unwired member would throw.
  let box = null;
  if (typeof probe.box === 'function') {
    box = probe.box();
  }
  const row = bar({ label: 'Probe', size: share });
  stage.appendChild(row.el);
  const tall = Math.round(row.el.getBoundingClientRect().height);
  const written = row.el.style.getPropertyValue('--woc-bar-size');
  row.destroy();
  probe.destroy();

  if (share !== SCALE_SHARE) {
    return result('scaling', false, `units divided ${String(SCALE_BOX)} into ${String(share)}`);
  }
  if (box === null || box.w !== SCALE_WIDTH) {
    return result(
      'scaling',
      false,
      `frame.box() answered ${String(box?.w)} for a ${String(SCALE_WIDTH)} frame`,
    );
  }
  if (written !== String(share)) {
    return result(
      'scaling',
      false,
      `a sized row carries "${written}" rather than ${String(share)}`,
    );
  }
  const cell = `item cell ${String(itemCell)}px`;
  if (!sheetLive()) {
    return result(
      'scaling',
      true,
      `units and frame.box() agree, no sheet here to size a row, ${cell}`,
    );
  }
  if (tall !== share) {
    return result('scaling', false, `a row asked for ${String(share)} drew ${String(tall)} tall`);
  }
  return result('scaling', true, `box, units and a ${String(tall)}px row all agree, ${cell}`);
}

/**
 * The checks that describe the live world, in report order. They are cheap and re-run from
 * `world.on`, so a skipped line becomes a real check once, say, a target is picked.
 */
const LIVE_CHECKS = [
  checkWorld,
  checkAbilities,
  checkDescribe,
  checkAbilityShapes,
  checkGeometry,
  checkMoveSpeed,
  checkCombat,
  checkCombatRecords,
  checkMobTargeting,
  checkEntityStats,
  checkSwings,
  checkUnits,
  checkReaction,
  checkAuraQueries,
  checkAuraPolarity,
  checkAuraToggle,
  checkHoldings,
  checkProvenance,
  checkCharacter,
  checkCharacterKey,
  checkContent,
  checkCounters,
  checkVault,
  checkCraftVault,
  checkBankBudget,
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
  checkScaling,
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
 * The world keys a live check reads, so a change repaints. Only these: every key would wake
 * the harness on traffic no line reports.
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
 * The slow half: storage round trips, fetches and timers. Never re-run on a world change,
 * since the answers cannot move and storage writes through to the userscript manager.
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
    checkAuraArt(),
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

/** Its own container, so a live repaint cannot take the controls or a running demo with it. */
const report = document.createElement('div');
/** Where a demo puts something to look at, kept outside the repainting half. */
const stage = document.createElement('div');
win.body.append(report, stage);

/** The slow half's last answer, held so a live repaint can show it unchanged. */
let slowResults = [];

/** Copper as the game writes it, with bare copper when there is nothing above it. */
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
 * The two `HeldSlot`-only fields in your bags: the player's lock, and the party-trade window
 * on soulbound boss loot. Only bags and bank carry them; a market row or letter attachment is
 * projected to the public allowlist, so `undefined` there means "not sent".
 *
 * Counts are reported and only the shape is asserted: a non-numeric `untilMs` makes every
 * comparison false, so the window silently reads as expired. The count uses the wall clock,
 * since the game retires an expired marker only on load or save, never on a tick.
 */
function readHeldMarks(inventory) {
  const badLock = inventory.find((slot) => {
    const held = slot.instance?.locked;
    return held !== undefined && typeof held !== 'boolean';
  });
  if (badLock !== undefined) {
    return { fault: `${badLock.itemId} carries a lock that is not a boolean` };
  }
  const badWindow = inventory.find((slot) => {
    const trade = slot.instance?.partyTrade;
    if (trade === undefined) {
      return false;
    }
    return !(Number.isFinite(trade.untilMs) && Array.isArray(trade.eligible));
  });
  if (badWindow !== undefined) {
    return { fault: `${badWindow.itemId} carries a malformed partyTrade window` };
  }
  const now = Date.now();
  return {
    locked: inventory.filter((slot) => slot.instance?.locked === true).length,
    tradeable: inventory.filter((slot) => (slot.instance?.partyTrade?.untilMs ?? 0) > now).length,
  };
}

/**
 * Gear, bags, money and zone. `bagCapacity` is the game's own number, so the only checkable
 * fault is a capacity below what is carried. The zone is read from the game's DOM, so a
 * renamed element leaves it silently null.
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
  const marks = readHeldMarks(inventory);
  if (marks.fault !== undefined) {
    return result('holdings', false, marks.fault);
  }
  return result(
    'holdings',
    true,
    `in ${zone}: ${String(worn)} worn, ${String(inventory.length)}/${String(bagCapacity)} bags,` +
      ` ${String(marks.locked)} locked, ${String(marks.tradeable)} in a party-trade window,` +
      ` ${money(copper)}`,
  );
}

/**
 * The character sheet: its shape, and that lifetime totals are not below their live
 * counterparts. The values themselves have nothing to check against.
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
  // Empty is ordinary: the game omits the key for anyone who never slotted a tool effect.
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
 * The character key is opaque, so only its shape is checked here; `checkCharacterStorage`
 * checks it agrees with the store. An empty key would file every record under nothing.
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
 * The static content tables: never null, empty before a client carries one, and never a
 * watch key since authored content does not change in a session. All are frozen copies.
 */
function checkContent() {
  const { recipes, stations, civicServices } = woc.world;
  if (!(Array.isArray(recipes) && Array.isArray(stations) && Array.isArray(civicServices))) {
    return result(
      'content',
      false,
      `recipes is ${typeOf(recipes)}, stations is ${typeOf(stations)}, ` +
        `civicServices is ${typeOf(civicServices)}`,
    );
  }
  if (!(refusesWrite(recipes) && refusesWrite(stations) && refusesWrite(civicServices))) {
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
  const kinds = new Set(civicServices.map((service) => service.kind));
  return result(
    'content',
    true,
    `${String(recipes.length)} recipes (${String(gated)} need a station), ` +
      `${String(stations.length)} stations, ` +
      `${String(civicServices.length)} civic services (${[...kinds].sort().join(', ') || 'none'})`,
  );
}

/**
 * The counters a player has to stand at. Never null (`unknown` means no world), so the check
 * is that status and payload agree: `away` carries nothing and `near` carries a reading.
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

/** A stock record, which the vault and the crafting draw both answer with. */
function stockFault(stock) {
  if (stock === null || typeof stock !== 'object' || Array.isArray(stock)) {
    return `the stock came back as ${typeOf(stock)} rather than a record`;
  }
  for (const [itemId, count] of Object.entries(stock)) {
    if (!Number.isFinite(count) || count < 0) {
      return `${itemId} is held at ${String(count)}`;
    }
  }
  return null;
}

/** The upgrade ladder: locked caps every material at nothing, fully bought quotes no next price. */
function vaultRungFault(upgrades, cap, next) {
  if (!Number.isInteger(upgrades) || upgrades < 0 || upgrades > VAULT_RUNGS) {
    return `upgrades is ${String(upgrades)}, outside 0 to ${String(VAULT_RUNGS)}`;
  }
  if (upgrades === 0 && cap !== 0) {
    return `a locked vault caps every material at ${String(cap)} rather than at nothing`;
  }
  if (upgrades === VAULT_RUNGS && next !== null) {
    return `every rung is bought and the next still costs ${String(next)}`;
  }
  if (next !== null && !Number.isFinite(next)) {
    return `nextUpgradeCost is ${String(next)}`;
  }
  return null;
}

/**
 * The Materials Vault: one count per material against a shared cap, a missing key meaning
 * zero. Only the payload is checked here; key order in `stock` means nothing.
 */
function checkVault() {
  const { vault } = woc.world;
  if (vault === undefined) {
    return result('vault', false, 'world.vault never reached the object an addon is handed');
  }
  if (vault.status !== 'near') {
    return result('vault', true, `no banker in reach, so the vault reads "${vault.status}"`);
  }
  const { stock, special, upgrades, perMaterialCap, nextUpgradeCost } = vault.info;
  const fault = stockFault(stock) ?? vaultRungFault(upgrades, perMaterialCap, nextUpgradeCost);
  if (fault !== null) {
    return result('vault', false, fault);
  }
  // Crafted or signed stacks, which cannot collapse into a count. Empty is the ordinary state.
  if (!Array.isArray(special)) {
    return result('vault', false, `special is ${typeOf(special)} rather than a list of stacks`);
  }
  return result(
    'vault',
    true,
    `${String(Object.keys(stock).length)} materials stocked and ` +
      `${String(special.length)} identity rows, ${String(upgrades)} rungs ` +
      `at ${String(perMaterialCap)} each`,
  );
}

/**
 * What crafting may draw from the vault here: a root read, not a gated one, since every
 * instance refuses it. Empty means allowed with nothing to draw, null means refused here,
 * and undefined means unwired.
 */
function checkCraftVault() {
  const stock = woc.world.craftVaultStock;
  if (stock === undefined) {
    return result('craft vault', false, 'world.craftVaultStock never reached the object');
  }
  if (stock === null) {
    return result(
      'craft vault',
      true,
      'no draw here: inside an instance, or before the first snapshot',
    );
  }
  // A status would be advice that cannot be taken: "walk to a banker" is wrong in a dungeon.
  if (stock.status !== undefined) {
    return result('craft vault', false, `it came back gated, carrying "${String(stock.status)}"`);
  }
  const fault = stockFault(stock);
  if (fault !== null) {
    return result('craft vault', false, fault);
  }
  const held = Object.keys(stock).length;
  if (held === 0) {
    return result('craft vault', true, 'the draw is allowed and the vault holds nothing');
  }
  return result('craft vault', true, `${String(held)} materials drawable from where you stand`);
}

/** The bag sockets: always four entries, since the index is the socket number. */
function socketFault(info) {
  const bags = info.socketBags;
  const open = info.socketsUnlocked;
  if (!Array.isArray(bags) || bags.length !== BANK_SOCKETS) {
    return `socketBags holds ${String(bags?.length)} entries rather than ${String(BANK_SOCKETS)}`;
  }
  if (!Number.isInteger(open) || open < 0 || open > BANK_SOCKETS) {
    return `socketsUnlocked is ${String(open)}, outside 0 to ${String(BANK_SOCKETS)}`;
  }
  const beyond = bags.slice(open).filter((bag) => bag !== null).length;
  if (beyond > 0) {
    return `${String(beyond)} bags sit past the ${String(open)} sockets that are open`;
  }
  if (open === BANK_SOCKETS && info.nextSocketCost !== null) {
    return `every socket is open and the next still costs ${String(info.nextSocketCost)}`;
  }
  return null;
}

/**
 * The two sums the published types say a consumer may RELY on; the game's own decoder refuses
 * a snapshot where either fails.
 */
function budgetFault(info) {
  const { capacity, generalCapacity, materialsCapacity, generalUsed, materialsUsed } = info;
  if (generalCapacity + materialsCapacity !== capacity) {
    return (
      `${String(generalCapacity)} general and ${String(materialsCapacity)} materials ` +
      `is not the ${String(capacity)} the bank reports`
    );
  }
  if (generalUsed + materialsUsed !== info.slots.length) {
    return (
      `${String(generalUsed)} and ${String(materialsUsed)} charged ` +
      `against ${String(info.slots.length)} stacks`
    );
  }
  return null;
}

/** The Claudium rung price, which is ABSENT rather than null when there is not one. */
function claudiumWord(price) {
  if (price === undefined) {
    return 'no Claudium price';
  }
  return `${String(price)} Claudium for the next rung`;
}

/**
 * The split bank budget and the bag sockets. `capacity` is a display total, never a fit
 * answer. A used count is not bounded by its capacity: unsocketing a bag shrinks a pool
 * without destroying its contents.
 */
function checkBankBudget() {
  const { bank } = woc.world;
  if (bank.status !== 'near') {
    return result('bank budget', true, `no banker in reach, so the bank reads "${bank.status}"`);
  }
  const { info } = bank;
  const fault = socketFault(info) ?? budgetFault(info);
  if (fault !== null) {
    return result('bank budget', false, fault);
  }
  const claudium = info.nextRungClaudiumPrice;
  if (claudium !== undefined && !Number.isFinite(claudium)) {
    return result('bank budget', false, `nextRungClaudiumPrice arrived as ${String(claudium)}`);
  }
  const filled = info.socketBags.filter((bag) => bag !== null).length;
  return result(
    'bank budget',
    true,
    `${String(info.generalUsed)}/${String(info.generalCapacity)} general, ` +
      `${String(info.materialsUsed)}/${String(info.materialsCapacity)} materials, ` +
      `${String(filled)} of ${String(info.socketsUnlocked)} open sockets filled, ` +
      claudiumWord(claudium),
  );
}

/** Every stack of the player's OWN the session can currently reach, in one list. */
function heldStacks() {
  const { inventory, bank, vault } = woc.world;
  const held = [...(inventory ?? [])];
  if (bank.status === 'near') {
    held.push(...bank.info.slots);
  }
  if (vault?.status === 'near') {
    held.push(...vault.info.special);
  }
  return held;
}

/**
 * `craftedRecipeId` rides only the player's own stacks; public rows are built without it.
 * Absent is ordinary, so the count is reported, never required.
 */
function checkProvenance() {
  if (woc.world.inventory === null) {
    return result('provenance', true, 'no world yet, so there are no stacks of your own to read');
  }
  const held = heldStacks();
  const wrong = held.filter((slot) => {
    const made = slot.craftedRecipeId;
    return made !== undefined && (typeof made !== 'string' || made.length === 0);
  });
  if (wrong.length > 0) {
    return result(
      'provenance',
      false,
      `${String(wrong.length)} stacks carry a recipe id that is not one`,
    );
  }
  const made = held.filter((slot) => slot.craftedRecipeId !== undefined).length;
  return result(
    'provenance',
    true,
    `${String(made)} of ${String(held.length)} stacks in reach record what minted them`,
  );
}

/** Whether a published table is the frozen copy it claims to be. */
function refusesWrite(table) {
  try {
    table.push(null);
  } catch {
    return true;
  }
  // Put it back, or the next addon to read the table finds a null row.
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
 * The group, the run, and the target's hate table. Threat rows must be sorted and the
 * player's row must match the raw entity table. A roll with a null `remaining` while the
 * world is up means the loader never read the sim's clock.
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
 * Unit tokens against the reads they resolve from: an unknown token is null, not a throw, and
 * `targettarget` on a mob reads `aggroTargetId`, since a mob's `targetId` is always null.
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
 * `world.reaction` rests on the game setting `hostile` only on mobs, never on players, so a
 * flagged player means PvP reaction must be re-derived. A hostile mob is checked the other
 * way, since that is the one case where the flag is the answer.
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

/** The aura filters, compared by count against a hand-rolled filter over the full list. */
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
 * The `harmful` predicate and the `{ harmful: true }` query must agree. `dispellable` is
 * checked as an implication: what comes off an ally is harmful and what is stripped off an
 * enemy is a benefit, which needs no fight.
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

/**
 * The toggle rule reads only `id` and `kind`, so it must answer the same for that pair as
 * for the whole aura, or it would break on a party row.
 */
function checkAuraToggle() {
  const { world } = woc;
  if (typeof world.toggle !== 'function') {
    return result('aura toggle', false, 'world.toggle is not callable');
  }
  const all = world.aurasOn('player');
  const disagreed = all.filter(
    (aura) => world.toggle(aura) !== world.toggle({ id: aura.id, kind: aura.kind }),
  );
  if (disagreed.length > 0) {
    return result('aura toggle', false, `${String(disagreed.length)} read more than id and kind`);
  }
  const modes = all.filter((aura) => world.toggle(aura));
  if (modes.length === 0) {
    return result('aura toggle', true, 'nothing on you is a mode');
  }
  return result('aura toggle', true, `${String(modes.length)} of ${String(all.length)} are modes`);
}

function combatWord(active) {
  if (active) {
    return 'in combat';
  }
  return 'idle';
}

/**
 * The combat reading's shape and source; the answer has nothing to check against. `recent`
 * means no server-backed branch answered and a five second timer did.
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
 * The combat records against the published types. Vacuous until something lands, and the
 * note says so rather than reporting a pass with nothing seen.
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
 * A mob's `targetId` is present and permanently null, since a mob does not select; what it
 * fights rides `aggroTargetId`. This fails if the game starts filling `targetId` on mobs.
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
 * `helmHidden` and `rangedPower` ride every entity record. The count of others carrying a
 * ranged power is what the shape walk, which visits only the local player, cannot see.
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
 * A shape fault, or a swing timer on an entity not auto-attacking, which would be a bar
 * counting down to nothing.
 */
function swingFault(entity) {
  if (typeof entity.autoAttack !== 'boolean' || typeof entity.swingTimer !== 'number') {
    return `autoAttack is ${typeOf(entity.autoAttack)}, swingTimer ${typeOf(entity.swingTimer)}`;
  }
  if (!entity.autoAttack && entity.swingTimer !== 0) {
    return `a swing timer of ${String(entity.swingTimer)} on an entity that is not attacking`;
  }
  return null;
}

/**
 * `autoAttack` and `swingTimer` ride every entity record; an older server answers false and 0
 * for everyone but you, which is not failed. `offhandSwingTimer` is self-only, so a non-zero
 * one on anyone else means the wire moved.
 */
function checkSwings() {
  const { player } = woc.world;
  if (player === null) {
    return result('swings', true, 'no player yet, so there is nothing swinging');
  }
  if (typeof player.offhandSwingTimer !== 'number') {
    return result('swings', false, `offhandSwingTimer is ${typeOf(player.offhandSwingTimer)}`);
  }
  const all = [...woc.world.entities.values()];
  const faulted = all.map(swingFault).filter((one) => one !== null);
  if (faulted.length > 0) {
    return result('swings', false, faulted.slice(0, MAX_CONTRADICTIONS).join('; '));
  }
  const others = all.filter((entity) => entity !== player);
  const offhanded = others.filter((entity) => entity.offhandSwingTimer !== 0);
  if (offhanded.length > 0) {
    return result(
      'swings',
      false,
      `${String(offhanded.length)} others carry an offhand timer, which rides your record alone`,
    );
  }
  const swinging = others.filter((entity) => entity.autoAttack).length;
  return result(
    'swings',
    true,
    `${String(swinging)} of ${String(others.length)} others swinging, ` +
      `your offhand ${player.offhandSwingTimer.toFixed(DECIMALS_YARDS)}s out`,
  );
}

/**
 * The sold-price ledger, readable only at the Merchant. Rows are capped, so with nothing
 * omitted they must add up to `collectionCopper`.
 */
function checkSaleLedger() {
  const { market } = woc.world;
  if (market.status !== 'near') {
    return result('sale ledger', true, 'not at the Merchant, so there is no page to read');
  }
  // Either order is valid: it is the player's own choice in the game's window.
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
 * Re-run the live half and repaint, keeping the slow half's last answer. Skipped while hidden,
 * so no DOM work happens at snapshot rate during a fight.
 */
function refresh() {
  if (!win.visible) {
    return;
  }
  renderResults([...runLiveChecks(), ...slowResults]);
}

/** The full pass, holding the slow results so a live repaint does not redo them. */
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
 * A timer bar drained by a frame loop. Manual, since a suite cannot see legibility, icon
 * alignment, or digits shuffling as they change.
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
 * A row of tiles drained beside the bar, since tile faults show only against neighbours.
 * One points at missing art, so the kit hides its slot and leaves the timer on a bare square.
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

/** Warm as it runs out. */
function barTone(fraction) {
  if (fraction <= DEMO_WARN) {
    return 'warn';
  }
  return 'default';
}

/** A settings pane from the kit fields, manual for the reason the bar demo is. */
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
 * A context menu at the button. Watch the dismissal: Escape, a click anywhere else (even one
 * the game swallows), and choosing something.
 */
function demoMenu(at) {
  woc.ui.menu(at, [
    { label: 'Reset the meter', onSelect: () => woc.log('menu: reset') },
    { label: 'Nothing to report', onSelect: () => undefined, disabled: true },
    { label: 'Close this addon', onSelect: () => woc.log('menu: close'), separator: true },
  ]);
}

/** The structured tooltip form, on a row that names an ability. */
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
 * A badge for a world anchor, which has no look of its own. Styled from the game's custom
 * properties so it follows the player's theme.
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
 * A copy of a position. The game mutates `pos` in place, so holding the object tracks the
 * unit and a distance against it reads 0.0 yd.
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

/** What the following plate says. Plating yourself shows no distance, since it is zero. */
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
 * A following anchor and one pinned where you stood, which is how to watch culling. Only
 * the labels are rewritten on a timer; positioning is the loader's frame loop.
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

/** Toggle the anchors, so you can walk around and watch them. */
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
 * A toast (queued at the top) and both banner sizes (over the middle of the view), side by
 * side because loudness is only judged comparatively.
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
  // Built first so the menu can be anchored to it.
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

/** One debounced repaint, since taking a target moves several watched keys at once. */
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

// Subscribed for the session, which costs a sample per frame even while hidden: acceptable
// for a development addon, and there is no signal for the window closing.
for (const key of LIVE_KEYS) {
  woc.world.on(key, scheduleRefresh);
}

/** Opening the window repaints it: it may have been hidden for a whole fight. */
function openReport() {
  win.show();
  refresh();
}

// Bound by hand, not through `toggleKey`, since this key does more than toggle.
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

// Re-running on a settings change shows the manager's form is wired, not merely persisted.
woc.onSettingsChange(() => {
  woc.log('settings changed, re-running');
  run();
});

woc.onDispose(() => {
  woc.log(`disposed after ${String(uptimeSeconds())}s`);
});

// Outside the report, so a live repaint does not take the buttons with it.
win.body.insertBefore(controls(), stage);

run();
