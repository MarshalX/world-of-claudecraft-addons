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
  'quests',
  'cooldowns',
  'auras',
  'casts',
  'targetAuras',
  'hazards',
  'markers',
  'abilities',
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

async function runChecks() {
  const immediate = [
    checkIdentity(),
    checkGame(),
    checkSettings(),
    checkKeys(),
    checkWorld(),
    checkWorldKeys(),
    checkAbilities(),
    checkCasts(),
    checkIcons(),
    checkNet(),
    checkShadowedGlobals(),
  ];
  const awaited = await Promise.all([checkStorage(), checkSound(), checkTimers(), checkSkillArt()]);
  return [...immediate, ...awaited];
}

const win = woc.ui.window({
  id: 'report',
  title: 'Dev Harness',
  width: 460,
  height: 420,
  save: true,
  visible: woc.settings['open-on-load'] === true,
});

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

  win.body.replaceChildren(
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

function run() {
  win.body.replaceChildren(element('p', undefined, 'Running the checks...'));
  runChecks()
    .then((results) => {
      const allPassed = renderResults(results);
      win.body.append(controls());
      if (allPassed) {
        woc.log('every check passed');
      } else {
        woc.warn(
          'some checks failed',
          results.filter((entry) => !entry.ok).map((e) => e.name),
        );
      }
    })
    .catch((err) => {
      woc.error('the harness itself threw', err);
      win.body.replaceChildren(element('p', undefined, `The harness threw: ${String(err)}`));
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
  win.body.appendChild(bar.el);

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

woc.keys.bind('toggle', () => {
  win.toggle();
  woc.sound.play('ui_click');
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
  },
});

woc.ui.menuEntry({
  id: 'harness',
  label: 'Dev Harness',
  onClick: () => {
    win.show();
  },
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

run();
