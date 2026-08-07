// Longwatch on the stage: a roster with time on it.
//
// The state worth photographing is one no session can be walked into. Half the shipped respawns
// are hours long, so a panel that says anything at all belongs to somebody who has been killing
// rares across four zones for most of an afternoon. A scenario states that afternoon instead: a
// kill is a death record with a wall-clock stamp, and `stage.elapse` is what puts the stamp in
// the past.
//
// The roster is the shipped file, imported rather than restated. It is the whole content of this
// addon, and a fixture that named its own rares would photograph a roster nobody installs. It
// arrives as `data`, which is how the loader's own install-time cache holds it.
//
// Two things are arranged so the picture is the panel and nothing else, and both are honest
// rather than staged. The rare that is up is standing where the player is standing, and it is in
// interest scope before the addon evaluates a line: a rare found in the first walk is one the
// player did not ride up to, so the addon says nothing about it and no banner covers the shot.
// And the camp the pins would be drawn over is behind the player, since `pnpm shots` crops
// around world anchors as well as frames.

import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';
import { eventsFrame, PLAYER_ENTITY } from '../../tests/fakes/frames.ts';
import ROSTER from './rares.json' with { type: 'json' };

const PLAYER_ID = PLAYER_ENTITY.id;
const ROSTER_FILE = 'rares.json';
const MS_PER_SECOND = 1000;

/** Entity ids for the corpses, one per kill, well clear of the player's. */
const FIRST_CORPSE_ID = 800;
/** The one entity that is still standing. */
const STANDING_ID = 799;

/**
 * Where this hunter is standing, and it is chosen rather than arbitrary. Inside Eastbrook Vale,
 * since the zone is resolved from the position rather than from `world.zone`, so the detail line
 * under every row is a real distance from here. South of every camp in the zone, because the
 * stage camera looks down world -z from over the player's shoulder and a pin behind it is not
 * drawn.
 */
const PLAYER_POS = { x: -95, y: 5, z: -95 };

/** The rare standing in front of the player, and its camp, from the roster. */
const STANDING_RARE = 'grix_the_tunnelking';
const STANDING_NAME = 'Grix the Tunnelking';
const STANDING_POS = { x: -95, y: 5, z: -78 };

/**
 * What this character has killed, and how long ago. Spread across all four zones and all five
 * respawn lengths so the countdown column reads from seconds to hours. `old_cragmaw` is past
 * its own 180 seconds on purpose: due back and not yet seen back is a state of its own.
 */
const KILLS: readonly { id: string; ago: number }[] = [
  { id: 'sister_nhalia', ago: 9000 },
  { id: 'brutok_skullsmasher', ago: 3720 },
  { id: 'mirejaw_the_ravenous', ago: 1800 },
  { id: 'ironvein_foreman', ago: 1260 },
  { id: 'voskar_emberwing', ago: 660 },
  { id: 'marrowlord_varkas', ago: 300 },
  { id: 'old_cragmaw', ago: 260 },
  { id: 'old_marrowshell', ago: 62 },
  { id: 'shardlord_kazzix', ago: 56 },
  { id: 'aurelhorn', ago: 40 },
  { id: 'grubjaw', ago: 20 },
];

/** Long enough for the roster read, the frame restore and the stored reads. */
const SETTLE_MS = 60;
/** Longer than the panel's own once-a-second redraw, so it draws where it stands. */
const REDRAW_WAIT_MS = 1200;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * The session before the addon has run a line. The standing rare is here rather than in `run` and
 * that is the load-bearing half: `announce` is suppressed for everything found in the first walk
 * of interest scope, so stated here it draws a row and no banner.
 */
function aRareHunter(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', 'hunter');
  draft.set(draft.player, 'pos', PLAYER_POS);
  draft.mob(STANDING_ID, {
    templateId: STANDING_RARE,
    name: STANDING_NAME,
    pos: STANDING_POS,
    dead: false,
  });
}

/**
 * The corpse exists only for the length of the record, since the addon reads the template off
 * the entity a death names. NEVER POLLED between the two, so this is not a spawn it ever saw.
 */
function bury(stage: Stage, templateId: string, id: number): void {
  stage.mob(id, { templateId, name: templateId, dead: true });
  stage.inbound(eventsFrame([{ type: 'death', entityId: id, killerId: PLAYER_ID, templateId }]));
  stage.entities.delete(id);
}

/** The wall clock WALKS FORWARD through the kills rather than each being stamped and pushed
 * back, since a stamp is taken from the clock as it stands.
 */
function killEverything(stage: Stage): void {
  let at = KILLS[0]?.ago ?? 0;
  for (const [index, kill] of KILLS.entries()) {
    stage.elapse((at - kill.ago) * MS_PER_SECOND);
    at = kill.ago;
    bury(stage, kill.id, FIRST_CORPSE_ID + index);
  }
  stage.elapse(at * MS_PER_SECOND);
}

/** Let the panel's saved state come back, which is what un-hides it. */
async function panelUp(stage: Stage): Promise<void> {
  stage.poll();
  await wait(SETTLE_MS);
}

/**
 * The rare that walks up in the alert scenario, and where the player is when it does.
 *
 * Mogger's camp is the one this scenario stands at, since an entity is only ever seen in interest
 * scope and a rare is authored as a one-mob camp. The player is a few yards south of it, which
 * puts the mob behind the stage camera along with every other camp in the zone, so no pin is
 * drawn.
 *
 * Mogger is also the shortest name on the roster, and a banner is set in the game's display serif
 * at around 40px across the whole view: a longer one photographs as a headline several times
 * wider than the panel it belongs beside.
 */
const SIGHTED_RARE = 'mogger';
const SIGHTED_NAME = 'Mogger';
const SIGHTED_ID = 780;
const SIGHTED_POS = { x: 120, y: 5, z: -28 };
const CAMP_POS = { x: 118, y: 5, z: -40 };

/**
 * The panel, deliberately not on screen. This pane is the alert and nothing else, because the
 * roster is already the pane beside it: drawing the panel twice would say the preview is two
 * states of one window rather than the two halves of what the addon does. A hidden frame has no
 * box on screen at all, so the crop closes to the banner alone.
 *
 * The box is still stated because a frame's saved state is a box and a visibility.
 */
const ALERT_PANEL = { box: { x: 370, y: 372, w: 460, h: 300 }, visible: false };

/** Nothing standing yet: the sighting has to arrive after the addon has booted. */
function atMoggersCamp(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', 'hunter');
  draft.set(draft.player, 'pos', CAMP_POS);
}

/**
 * Kill everything, then have one more rare walk up.
 *
 * The order is the whole scenario. `announce` says nothing about a rare found in the first walk
 * of interest scope, so a sighting has to arrive later than that walk to be one. Mogger is
 * therefore absent while the addon boots and spawns afterwards.
 *
 * The banner then stays up rather than expiring under the capture: the shared harness hands the
 * kit no timers, so the three seconds a real one lasts never pass.
 *
 * The kills are here even though this pane's panel is hidden, because the world a scenario states
 * has to be one somebody could be in.
 */
async function sighting(stage: Stage): Promise<void> {
  await panelUp(stage);
  killEverything(stage);
  stage.mob(SIGHTED_ID, {
    templateId: SIGHTED_RARE,
    name: SIGHTED_NAME,
    pos: SIGHTED_POS,
    dead: false,
  });
  stage.poll();
  await wait(REDRAW_WAIT_MS);
}

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'roster',
    label: 'An afternoon of rares',
    preview: true,
    caption: 'Rares list',
    alt: 'a two-column list of rare spawns, a timer bar on every row',
    data: { [ROSTER_FILE]: JSON.stringify(ROSTER) },
    world: aRareHunter,
    run: async (stage) => {
      await panelUp(stage);
      killEverything(stage);
      await wait(REDRAW_WAIT_MS);
    },
  },
  {
    // The other half of the addon: it is a watch rather than a table, so the moment it exists for
    // is a rare walking into range while the player is doing something else, with the panel shut.
    // A banner and a cue, and nothing else on screen.
    id: 'alert',
    label: 'A rare walks into range',
    preview: true,
    caption: 'An alert',
    alt: 'a banner over an empty screen announcing that a rare is up',
    data: { [ROSTER_FILE]: JSON.stringify(ROSTER) },
    frames: { rares: ALERT_PANEL },
    world: atMoggersCamp,
    run: sighting,
  },
  {
    // One zone, which is the filter a player watching a single camp circuit sets. Worth its own
    // scenario because it is a different panel rather than the same one shortened: five rows fit
    // one column, and the grid reflows to it.
    id: 'one-zone',
    label: 'Filtered to the zone you are in',
    settings: { zones: 'The zone I am in' },
    data: { [ROSTER_FILE]: JSON.stringify(ROSTER) },
    world: aRareHunter,
    run: async (stage) => {
      await panelUp(stage);
      killEverything(stage);
      await wait(REDRAW_WAIT_MS);
    },
  },
  {
    // Nothing killed and nothing seen, which is what a fresh install looks like. A roster that
    // reads well full and reads as broken empty is one a player meets empty first.
    id: 'unseen',
    label: 'Before you have killed anything',
    data: { [ROSTER_FILE]: JSON.stringify(ROSTER) },
    world: (draft) => {
      draft.set(draft.player, 'templateId', 'hunter');
      draft.set(draft.player, 'pos', PLAYER_POS);
    },
    run: async (stage) => {
      await panelUp(stage);
      await wait(REDRAW_WAIT_MS);
    },
  },
];

export { SCENARIOS };
