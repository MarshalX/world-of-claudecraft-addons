// Longwatch on the stage: a roster with time on it.
//
// The state worth photographing belongs to someone who has killed rares across four zones all
// afternoon, since many respawns are hours long. A scenario states that afternoon: a kill is a
// death record with a wall-clock stamp, and `stage.elapse` pushes the stamp into the past.
//
// The roster is the shipped file, imported rather than restated, arriving as `data` as the loader's
// install cache holds it.
//
// The rare that is up is in interest scope before the addon evaluates, so it is found in the first
// walk and no banner covers the shot. The camps the pins would draw over are behind the player,
// since `pnpm shots` crops around world anchors as well as frames.

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
 * Where this hunter stands: inside Eastbrook Vale, since the zone is resolved from position, so
 * every detail line is a real distance; south of every camp in the zone, because the camera looks
 * down world -z and a pin behind it is not drawn.
 */
const PLAYER_POS = { x: -95, y: 5, z: -95 };

/** The rare standing in front of the player, and its camp, from the roster. */
const STANDING_RARE = 'grix_the_tunnelking';
const STANDING_NAME = 'Grix the Tunnelking';
const STANDING_POS = { x: -95, y: 5, z: -78 };

/**
 * What this character killed, and how long ago: all four zones and every respawn length, so the
 * countdowns range from seconds to hours. `old_cragmaw` is past its 180 seconds on purpose: due and
 * not yet seen back is its own state.
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

/**
 * The body this character rode up on rather than watched fall. Wraithbinder, because its long
 * ceiling is still a ceiling by the end of the afternoon; a short one would have run out into
 * another state.
 *
 * `loot` must be stated null: the shared fixture builds a nullable object as `{}`, so the body
 * would carry a loot record and the addon would date the kill from its owner lock.
 */
const FOUND_RARE = 'wraithbinder_maldrec';
const FOUND_NAME = 'Wraithbinder Maldrec';
const FOUND_ID = 790;
const FOUND_POS = { x: 88, y: 5, z: 92 };

/** Long enough for the roster read, the frame restore and the stored reads. */
const SETTLE_MS = 60;
/** Longer than the panel's once-a-second redraw. */
const REDRAW_WAIT_MS = 1200;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * The session before the addon runs. The standing rare must be here rather than in `run`:
 * `announce` is suppressed for the first walk of interest scope, so it draws a row and no banner.
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
 * The corpse exists only for the length of the record, since the addon reads the template off the
 * entity a death names. NEVER POLLED between, so it is not a spawn the addon saw.
 */
function bury(stage: Stage, templateId: string, id: number): void {
  stage.mob(id, { templateId, name: templateId, dead: true });
  stage.inbound(eventsFrame([{ type: 'death', entityId: id, killerId: PLAYER_ID, templateId }]));
  stage.entities.delete(id);
}

/**
 * The wall clock WALKS FORWARD through the kills, since a stamp is taken from the clock as it
 * stands.
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
 * The rare that walks up in the alert scenario, and where the player is. The player stands a few
 * yards south of Mogger's one-mob camp, which puts every camp behind the camera, so no pin is
 * drawn. Mogger also has the shortest name, and a banner in the display serif at around 40px would
 * otherwise dwarf the panel.
 */
const SIGHTED_RARE = 'mogger';
const SIGHTED_NAME = 'Mogger';
const SIGHTED_ID = 780;
const SIGHTED_POS = { x: 120, y: 5, z: -28 };
const CAMP_POS = { x: 118, y: 5, z: -40 };

/**
 * The panel, deliberately not on screen: this pane is the alert, and the roster is the pane beside
 * it. A hidden frame has no box, so the crop closes to the banner. The box is still stated because
 * saved frame state is a box and a visibility.
 */
const ALERT_PANEL = { box: { x: 370, y: 372, w: 460, h: 300 }, visible: false };

/** Nothing standing yet: the sighting has to arrive after the addon has booted. */
function atMoggersCamp(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', 'hunter');
  draft.set(draft.player, 'pos', CAMP_POS);
}

/**
 * Kill everything, then have one more rare walk up. Mogger is absent while the addon boots, because
 * `announce` ignores the first walk of interest scope. The banner stays up: the shared harness
 * gives the kit no timers. The kills are stated even with the panel hidden, so the world is one
 * somebody could be in.
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
    // The other half of the addon: a rare walking into range with the panel shut. A banner and a
    // cue, nothing else.
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
    // One zone, the filter a player on one camp circuit sets. A different panel: five rows fit one
    // column and the grid reflows.
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
    // A body, which is most of a player's evidence: a death record reaches only players close
    // enough to see the fight. The row is a ceiling and says so. Stated in `world` because it was
    // already lying there at login, a body found rather than a kill watched.
    id: 'found-body',
    label: 'A body you rode up on',
    data: { [ROSTER_FILE]: JSON.stringify(ROSTER) },
    world: (draft) => {
      aRareHunter(draft);
      draft.mob(FOUND_ID, {
        templateId: FOUND_RARE,
        name: FOUND_NAME,
        pos: FOUND_POS,
        dead: true,
        loot: null,
      });
    },
    run: async (stage) => {
      await panelUp(stage);
      killEverything(stage);
      await wait(REDRAW_WAIT_MS);
    },
  },
  {
    // Nothing killed and nothing seen: a fresh install, which is how a player first meets the
    // roster.
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
