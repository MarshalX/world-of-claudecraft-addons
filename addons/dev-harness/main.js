/// <reference types="@woc-addons/types" />

// Dev Harness: run every part of the addon API against the real game and say
// what worked.
//
// This is an ordinary addon. It is fetched over the marketplace path, evaluated
// as a function body with `woc` in scope, and has no access to anything the
// loader does not publish, which is the point: if a surface can be checked from
// here, it can be checked by anyone's addon. Its counterpart, the unit
// suite, tests the loader's modules in isolation, and the two failures it cannot
// see are exactly the ones this catches: something in the live game that is not
// the shape the fakes assume, and a surface that was never wired to the object
// an addon is handed.
//
// It also never touches the game's state. Everything here reads, renders into
// the loader's own root, or plays a sound.

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

/**
 * Every key the published types say `world.on` accepts.
 *
 * Written out rather than read from anywhere, which is the point: the loader owns
 * one list and this is an independent second one. A key added to the published types
 * and not to the runtime's own list would typecheck everywhere and throw here, and a
 * key added to the runtime and never published would pass silently in a unit suite
 * because nothing there reads the published types either.
 */
const WORLD_KEYS = [
  'player',
  'target',
  'entities',
  'party',
  'inventory',
  'equipment',
  'bags',
  'copper',
  'zone',
  'character',
  'talents',
  'professions',
  'group',
  'encounter',
  'quests',
  'cooldowns',
  'auras',
  'casts',
  'targetAuras',
  'hazards',
  'markers',
  'abilities',
  'combat',
];
/** An arbitrary nested value, to show that storage is not flattened to strings. */
const PROBE_VALUE = Object.freeze(['a', ['b'], { c: true }]);
/** Matches --color-text-error, so a failed line reads the way the manager's do. */
const FAIL_COLOR = 'rgb(255 143 133)';

/** Wall-clock is unavailable to an addon on purpose; woc.now() is monotonic. */
const started = woc.now();

/** Frames counted since load, for the net check. */
let framesSeen = 0;
woc.net.onRaw(() => {
  framesSeen += 1;
});

/** Whole seconds since this addon loaded. woc.now() is monotonic, not wall clock. */
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
 * A key that reached the published types without reaching the runtime's own list
 * throws from `world.on`, which is the failure this exists to catch: it is invisible
 * to a unit suite, because nothing there reads the published types.
 *
 * The reads are checked for being PRESENT rather than for a value. Before world entry
 * almost all of them are legitimately null, and a key missing from the object
 * entirely is a different thing from one answering null, which is what `undefined`
 * separates.
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
 * A mob's cast is readable even though no event announces it.
 *
 * `net.onEvent('castStart')` fires for a player cast, a pet, gathering and fishing,
 * and for nothing else, so `world.casts` is the only way to see a boss cast. What
 * this can check without a fight is that the derivation runs over the live roster and
 * agrees with the cast fields on the entities themselves. Anything it finds is a real
 * cast: this environment has no fixtures.
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
 * The icon URL builders answer, and refuse an id they cannot build a name from.
 *
 * Whether any given URL RESOLVES is not checked and cannot be from here: only some
 * abilities ship painted art and the rest are drawn procedurally inside the game.
 * The bar demonstration below is where that shows, since the kit hides a slot whose
 * image fails.
 */
function checkIcons() {
  const { icon } = woc.ui;
  const ability = icon.ability('fireball', 'mage');
  if (ability !== '/ui/skills/mage/fireball.webp') {
    return result('icons', false, `ability() built ${String(ability)}`);
  }
  if (icon.mob('bog_bloat') !== '/ui/mobs/bog_bloat.webp') {
    return result('icons', false, `mob() built ${String(icon.mob('bog_bloat'))}`);
  }
  if (icon.item('baked_bread') !== '/ui/items/baked_bread.webp') {
    return result('icons', false, `item() built ${String(icon.item('baked_bread'))}`);
  }
  // A missing class is the case an addon hits before world entry, and a path with an
  // empty segment in it would be a request that cannot succeed rather than a null.
  if (icon.ability('fireball', '') !== null) {
    return result('icons', false, 'ability() built a path with no class in it');
  }
  return result('icons', true, 'ability, mob and item paths built, empty ids refused');
}

/**
 * The served art manifest, read for the player's own class.
 *
 * This is the half a unit suite cannot reach: whether the game still serves the
 * manifest at all, and whether the ability ids in it line up with what the player
 * actually has. Not every ability ships a file, so the check is that the loader can
 * TELL, not that any given ability has one: an id the manifest omits has an icon in
 * the game and no URL an addon can point at, and reporting that as a pass with a
 * count is the honest reading.
 */
async function checkSkillArt() {
  const cls = woc.world.player?.templateId ?? '';
  if (cls === '') {
    return result('skill art', true, 'no player yet, so no class to read a manifest for');
  }
  await woc.ui.icon.preload(cls);

  // Cooldown map KEYS are real ability ids, which makes them the one list of the
  // player's own abilities an addon can get without deriving anything.
  const ids = [...(woc.world.cooldowns?.keys() ?? [])];
  if (ids.length === 0) {
    return result('skill art', true, `manifest read for ${cls}, nothing on cooldown to check`);
  }
  const withArt = ids.filter((id) => woc.ui.icon.ability(id, cls) !== null);
  return result(
    'skill art',
    true,
    `${cls}: ${String(withArt.length)} of ${String(ids.length)} running cooldowns have a file`,
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
 * Each shadowed global, touched in a way that fires the proxy's `get` trap.
 *
 * Property reads only, never a call or a construction. If the shadow were ever
 * absent these have to be harmless: `new WebSocket(...)` in an unshadowed
 * closure would open a real socket, which is the one thing a read-only addon
 * platform must not do by accident while testing that it cannot.
 */
const SHADOW_PROBES = [
  ['localStorage', () => localStorage.length],
  ['sessionStorage', () => sessionStorage.length],
  ['indexedDB', () => indexedDB.databases],
  ['XMLHttpRequest', () => XMLHttpRequest.prototype],
  ['WebSocket', () => WebSocket.prototype],
];

/**
 * The loader shadows the riskiest globals inside an addon closure, so reaching
 * for one fails loudly and names the API to use instead.
 *
 * It is not a sandbox and the loader says so plainly. This checks it is doing
 * the job it does claim, which is to stop the accident.
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
 * The spellbook, and the id-to-name bridge it exists for.
 *
 * The round trip is the whole point, so that is what is asserted: every ability
 * has to come back as ITSELF through both lookups. An index that answered a
 * plausible-looking neighbour would pass a spot check on one ability and be
 * wrong everywhere else.
 *
 * The lookups are also checked for rejecting a name that is not the player's,
 * because that is the case a meter hits constantly: every mob ability reaches it
 * as a display name with no id behind it, and a null is the honest answer.
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
  if (book.byName('  not an ability') !== null) {
    return result('abilities', false, 'byName answered for a name nobody has');
  }
  // How many names a title-cased id would have got WRONG, which is what a display
  // had to fall back on before this surface existed. A count of zero here would
  // mean the bridge is not earning its place on this character.
  const diverged = book.known.filter((info) => info.name !== titleCase(info.id));
  return result(
    'abilities',
    true,
    `${String(book.known.length)} known, ${String(diverged.length)} unguessable from the id`,
  );
}

/**
 * The checks that describe the LIVE world, in report order.
 *
 * Separated from the rest because they are the ones whose answer changes while
 * the player plays, and because they are cheap: reading state the loader already
 * holds. They are re-run from `world.on` as things move, so a line that says
 * "no target, so target-of-target went unchecked" becomes a real check the
 * moment a target is picked, rather than staying vacuous until someone presses
 * a button. That matters more than it sounds: most of the world surface can only
 * be verified while something is actually happening.
 */
const LIVE_CHECKS = [
  checkWorld,
  checkAbilities,
  checkCombat,
  checkMobTargeting,
  checkUnits,
  checkAuraQueries,
  checkHoldings,
  checkCharacter,
  checkGroup,
  checkCasts,
];

/** Everything else, which answers the same way all session and is run on demand. */
const STATIC_CHECKS = [
  checkIdentity,
  checkGame,
  checkSettings,
  checkKeys,
  checkWorldKeys,
  checkIcons,
  checkNet,
  checkShadowedGlobals,
];

/**
 * The world keys a live check reads, so a change to any of them repaints.
 *
 * Deliberately the keys the checks CONSUME rather than every key that exists:
 * subscribing to all of them would wake the harness on traffic no line here
 * reports, and the point is that a repaint means a reported value moved.
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
  'talents',
  'abilities',
  'casts',
  'group',
  'encounter',
];

/**
 * The slow half: a storage round trip, a pack fetch, a timer, an image load.
 *
 * These are never re-run on a world change. A storage round trip writes through
 * the bridge to the userscript manager, so repeating it every time a target
 * changes would be real waste to answer a question whose answer cannot move.
 */
async function runSlowChecks() {
  return await Promise.all([checkStorage(), checkSound(), checkTimers(), checkSkillArt()]);
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
 * `bagCapacity` is checked against `inventory.length` rather than against a
 * number: it is derived on the client from the equipped bags, so a capacity
 * below what is already carried means the derivation broke, and that is the only
 * thing about it a check can know without the game's own bag table.
 *
 * The zone is the interesting one. It is the single read whose source is the
 * game's DOM rather than its world object, so a game update that renames the
 * element leaves it silently null. In game, null is a failure worth reporting.
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
  return result(
    'holdings',
    true,
    `in ${zone}: ${String(worn)} worn, ${String(inventory.length)}/${String(bagCapacity)} bags, ${money(copper)}`,
  );
}

/**
 * The character sheet.
 *
 *
 * The numbers themselves cannot be checked against anything: only the live game
 * knows how much experience the player has. What is checked is the shape, and
 * that lifetime totals are not BELOW their live counterparts, which is the one
 * invariant these fields have with each other.
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
  return result(
    'character',
    true,
    `${String(character.deeds.size)} deeds, renown ${String(character.renown)}, ` +
      `${String(Object.keys(talents.rows).length)} talent rows`,
  );
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
 * The threat half is checked against the entity it came from rather than against
 * a number: the rows must be sorted, and the player's own row must agree with
 * the raw table. A projection that quietly stopped sorting would still look
 * plausible on screen, and a pull warning built on it would fire at the wrong
 * moment.
 *
 * The loot roll half watches the clock conversion. A roll whose `remaining` is
 * null while the world is up means the loader never got the sim's clock off the
 * snapshot, which is silent everywhere else.
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
 * Unit tokens, against the state they are resolved from.
 *
 * Every assertion here is one an addon would otherwise trust silently: that
 * `player` and `target` agree with the plain reads, that an unknown token is a
 * null rather than a throw, and that `targettarget` on a MOB target is not the
 * permanently-null field. The last one cannot be checked without a mob target,
 * so it reports what it could see rather than passing quietly.
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
 * The aura filters, checked against the unfiltered list they narrow.
 *
 * A filter that returned everything would pass any spot check on a player with
 * one aura, so this compares counts against a hand-rolled filter over the same
 * list: the surface has to agree with what the caller would have written.
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

function combatWord(active) {
  if (active) {
    return 'in combat';
  }
  return 'idle';
}

/**
 * The combat reading, and the honesty of the source it travels with.
 *
 * There is no combat flag on the wire, so this cannot check the ANSWER against
 * anything: only the live game knows whether the player is fighting. What it can
 * check is that the shape holds and that the source is one the loader claims to
 * produce, which is what catches the reading degrading to a bare boolean or to a
 * source string nothing documents.
 *
 * The interesting line is the last one. A `recent` reading means every branch
 * backed by server state declined and a five second timer answered instead,
 * which is the one case an addon may want to treat differently, so the harness
 * reports which branch replied rather than just that one did.
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
 * A mob's target, which is NOT on the field that looks like it.
 *
 * `targetId` is filled from a selection and a mob does not select, so on every
 * mob it is present, correctly typed, and permanently null; what a mob is
 * fighting rides `aggroTargetId`, and its hate table rides `threat`. This is the
 * `inCombat` trap one level down, so the harness watches for the day the game
 * starts filling `targetId` on mobs, which would make the published note wrong.
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
 * Re-run the live half and repaint, keeping the slow half's last answer.
 *
 * Skipped while the window is hidden: the checks are cheap, but painting a
 * report nobody is looking at is not, and the harness has no business doing DOM
 * work at snapshot rate in the background of somebody's fight.
 */
function refresh() {
  if (!win.visible) {
    return;
  }
  renderResults([...runLiveChecks(), ...slowResults]);
}

/**
 * The full pass: the slow half as well, which is what a button press is for.
 *
 * The slow results are then held so a live repaint can show them without
 * redoing a storage round trip on every target change.
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
 * A timer bar, drained by a frame loop so the fill can be watched moving.
 *
 * The whole reason a bar is a manual trigger rather than a check: a suite can assert
 * the width string the addon wrote, and cannot see whether the row is legible, whether
 * the icon lines up with the label, or whether the countdown's digits shuffle as they
 * change. Its icon deliberately points at a real ability, so a missing-art case shows
 * as a collapsed slot rather than as a broken image.
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

/** Warm as it runs out, which is the tone change the kit draws. */
function barTone(fraction) {
  if (fraction <= DEMO_WARN) {
    return 'warn';
  }
  return 'default';
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
 * The two announcement surfaces, and the two steps of the louder one.
 *
 * A toast and a banner are easy to confuse in a description and impossible to
 * confuse once both have been seen: one waits its turn at the top of the screen, the
 * other lands over the middle of the view and interrupts.
 *
 * Both banner sizes get a button because the judgement they need is comparative. A
 * warning is loud enough only relative to what else is on screen during a fight, and
 * if every warning is the large one then none of them is.
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
    button('Alert', showAlert),
    button('Capture a key', captureKey),
  );

  woc.ui.tooltip(row, 'Each button drives one surface the automated checks cannot assert.');
  return row;
}

/**
 * Repaint on the next tick rather than on every key that moved.
 *
 * Several of the watched keys change on the same frame constantly: taking a
 * target moves `target`, `casts` and `entities` at once. Without this the
 * harness would run its live half three times to paint one answer.
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

// Subscribed for the whole session rather than only while the window is open.
// The watcher samples a subscribed key once per animation frame, so this does
// cost something with the report hidden, and the honest reason to accept it is
// that this is a development addon: the alternative is unsubscribing on hide,
// and the window's own close button gives no way to know it happened.
for (const key of LIVE_KEYS) {
  woc.world.on(key, scheduleRefresh);
}

/** Opening the window repaints it: it may have been hidden for a whole fight. */
function openReport() {
  win.show();
  refresh();
}

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
