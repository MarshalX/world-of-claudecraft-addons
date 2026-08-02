// Wayline on the stage: a rate, which is a thing that takes time to exist.
//
// EVERY OTHER SCENARIO IN THIS REPOSITORY STATES A WORLD AND PHOTOGRAPHS IT. This
// one has to play a stretch of the session out, because the panel's subject is not
// a number the game carries anywhere: the rate is measured from awards that landed
// at particular moments, so a fixture that sets a field cannot produce one. The
// kills below are delivered on the wire with `stage.advance` between them, and what
// the panel then reads is arithmetic over what actually happened rather than a
// figure typed into a scenario.
//
// SO THE MINUTES ARE LOAD-BEARING. Eight kills a minute apart is 450 seconds of
// span inside a ten minute window, which is a real grind seen from the middle of
// it. Compress the same eight into one minute and the rate is eight times higher
// and the panel is a picture of a claim the addon would never make: the floor under
// the denominator (see MIN_SPAN_MS in main.js) exists exactly so a burst cannot
// report as an hourly pace.
//
// EACH AWARD CARRIES ITS RESTED HALF, and it is the pool below that says why. A
// character sitting on 0.8 of a level of rested earns the bonus on every kill until
// it runs out, so an award with no `rested` beside a pool that is nearly full is two
// halves of a session that never happened. It is also what makes the rate row's
// second setting mean anything: leaving the bonus out is a subtraction of a real
// number here rather than of zero.
//
// TWO PANELS, AND THE GAME DECIDES IT RATHER THAN A SETTING. Below the cap the
// panel counts toward the next level; at the cap that whole reading is gone, since
// `xp` freezes at 0 and the level bar can only say `max` forever, and what takes its
// place is the virtual level worked out from the lifetime total. No one character is
// both, and a shot of the first alone would sell the addon as something that stops
// being useful at level 20, which is the opposite of what it does.

import type { Scenario, Stage, WorldDraft } from '../../stage/src/stage.ts';
import { eventsFrame, PLAYER_ENTITY } from '../../tests/fakes/frames.ts';

const PLAYER_ID = PLAYER_ENTITY.id;
const MS_PER_SECOND = 1000;

/** A hunter mid-grind, and what the game's own table asks of that level. */
const LEVEL = 12;
/** Lifetime earned to reach level 12, which is every requirement below it summed. */
const LEVEL_12_LIFETIME = 44_000;
/** Where this character stands inside the level: 61 percent of the way through. */
const INTO_LEVEL = 6240;
/** Four fifths of a level banked, which is a night logged out in an inn. */
const RESTED = 8080;

/** The level cap, past which the panel counts virtual levels instead. */
const CAP = 20;
/**
 * A capped character's lifetime total, standing 44 percent into virtual 23.
 *
 * Chosen against the addon's own curve rather than picked round, because the
 * interesting part of that bar is that it is a long way past the cap and still
 * moving: 90,379 earned since level 20 is four virtual levels, which is a state
 * nothing in the game itself would show you.
 */
const CAPPED_LIFETIME = 257_579;

/**
 * The eight kills, in experience, oldest first.
 *
 * Uneven on purpose. The Kills left figure divides what is left by the AVERAGE
 * award in the window, so a column of identical numbers would photograph an
 * estimate that is really a division, and the tooltip's "about 144 a kill" would
 * be exact. A camp of mobs a level or two apart is what a grind actually is.
 */
const KILLS: readonly number[] = [148, 132, 155, 141, 128, 160, 137, 149];

/** How far apart the kills land, which is what makes the rate an hourly one. */
const KILL_GAP_MS = 60 * MS_PER_SECOND;
/** How long ago the last kill was when the picture is taken. */
const SINCE_LAST_MS = 30 * MS_PER_SECOND;
/** Longer than the default window, so the last kill has fallen out of it. */
const QUIET_MS = 11 * 60 * MS_PER_SECOND;

/** Long enough for the frame's stored box and visibility to come back. */
const SETTLE_MS = 60;
/**
 * Longer than the panel's own once-a-second repaint, which every shot has to wait.
 *
 * The last thing each scenario does is let time pass, and time passing is exactly
 * what no award reports: the rate ages between kills and only the clock redraws it.
 * A picture taken before that tick is a picture of the panel as it stood at the last
 * kill, which is a different and slightly higher number.
 */
const REDRAW_MS = 1200;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * The character sheet, where the game keeps it: on the world object, not the entity.
 *
 * In `world` rather than in `run` for the usual reason, and here it is the whole
 * shape of the panel: the level row, the rested row and whether the virtual row
 * exists at all are read on the addon's first paint.
 */
function sheet(draft: WorldDraft, fields: Record<string, number>): void {
  for (const [field, value] of Object.entries(fields)) {
    draft.set(draft.world, field, value);
  }
}

/** A hunter four fifths rested, most of the way through level 12. */
function aLevellingHunter(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', 'hunter');
  draft.set(draft.player, 'level', LEVEL);
  sheet(draft, {
    xp: INTO_LEVEL,
    lifetimeXp: LEVEL_12_LIFETIME + INTO_LEVEL,
    restedXp: RESTED,
    prestigeRank: 0,
  });
}

/**
 * The same hunter at the cap, with the rested pool empty.
 *
 * Empty because that is the truth rather than a simplification: rested stops
 * accruing entirely at level 20, so a capped character with a pool is a character
 * who has not killed anything since they dinged. The row says 0.0 levels and its
 * tooltip says why, which is a state worth having a picture of.
 */
function aCappedHunter(draft: WorldDraft): void {
  draft.set(draft.player, 'templateId', 'hunter');
  draft.set(draft.player, 'level', CAP);
  sheet(draft, {
    xp: 0,
    lifetimeXp: CAPPED_LIFETIME,
    restedXp: 0,
    prestigeRank: 1,
  });
}

/**
 * One kill, the way the wire reports one: a death, then the award it paid.
 *
 * Both, and in that order, because an award does not say what earned it. The addon
 * counts an award as a kill's only when a death credited to this player landed
 * within a couple of seconds of it, so a scenario that skipped the death would draw
 * a rate with no Kills left figure beside it.
 *
 * The rested half is inside the amount rather than on top of it, which is where the
 * game puts it.
 */
function killOne(stage: Stage, amount: number): void {
  stage.inbound(eventsFrame([{ type: 'death', entityId: 900, killerId: PLAYER_ID }]));
  stage.inbound(eventsFrame([{ type: 'xp', amount, rested: Math.round(amount / 2) }]));
}

/** Play the last eight minutes out, ending half a minute after the last kill. */
function grind(stage: Stage): void {
  for (const [index, amount] of KILLS.entries()) {
    if (index > 0) {
      stage.advance(KILL_GAP_MS);
    }
    killOne(stage, amount);
  }
  stage.advance(SINCE_LAST_MS);
}

/** Let the panel up, play the grind, and let its once-a-second paint land. */
async function eightMinutes(stage: Stage): Promise<void> {
  stage.poll();
  await wait(SETTLE_MS);
  grind(stage);
  await wait(REDRAW_MS);
}

const GRIND_ALT =
  'a Level 12 row filled to 61 percent, reading 6,240 of the 10,100 the game asks for. Under it three figures: a rate of 9,200 xp/hr measured over the last ten minutes of play, 27 kills left at the average award of the eight in that window, and 25m to go at that pace. A Rested row below them holds 0.8 levels, 16 bubbles, banked against a cap of one and a half levels.';

const CAPPED_ALT =
  "the same panel on a character at the cap. The level row is full and reads max, with 90,379 earned past level 20 underneath, because the experience bar the game draws is frozen at 0 for the rest of that character's life. The three figures now count toward virtual 24 instead, and a Virtual 23 row at the bottom holds 13,587 of the 30,879 that level asks for, worked out here from the lifetime total the game does publish. The Rested row reads 0.0 levels, which is not an oversight: the pool stops filling at the cap.";

const SCENARIOS: readonly Scenario[] = [
  {
    id: 'grind',
    label: 'Eight kills over eight minutes',
    preview: true,
    caption: 'Levelling',
    alt: GRIND_ALT,
    world: aLevellingHunter,
    run: eightMinutes,
  },
  {
    id: 'capped',
    label: 'At the cap, on the virtual curve',
    preview: true,
    caption: 'Past the cap',
    alt: CAPPED_ALT,
    world: aCappedHunter,
    run: eightMinutes,
  },
  {
    // The state the whole addon is built around and the one nobody would think to
    // photograph: a player who stopped. The window empties, and the panel says so
    // rather than dividing what was earned by a stretch that keeps growing. Every
    // figure derived from a rate goes to a dash instead of decaying toward zero.
    id: 'quiet',
    label: 'Nothing earned in the window',
    world: aLevellingHunter,
    run: async (stage) => {
      stage.poll();
      await wait(SETTLE_MS);
      grind(stage);
      stage.advance(QUIET_MS);
      await wait(REDRAW_MS);
    },
  },
];

export { SCENARIOS };
