// Wayline on the stage. A rate is measured from awards over time, so this plays the session out:
// kills arrive on the wire with `stage.advance` between them. Keep them a minute apart; compressed
// into one minute the rate would be a burst the addon itself refuses to report (MIN_SPAN_MS).
//
// Each award carries its rested half, consistent with the nearly full pool. Two panels, levelling
// and capped, because no one character shows both readings.

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
/** A capped character's lifetime total, standing 44 percent into virtual 23. */
const CAPPED_LIFETIME = 257_579;

/** The eight kills, in experience, oldest first. Uneven, like mobs a level or two apart. */
const KILLS: readonly number[] = [148, 132, 155, 141, 128, 160, 137, 149];

/** How far apart the kills land, which is what makes the rate an hourly one. */
const KILL_GAP_MS = 60 * MS_PER_SECOND;
/** How long ago the last kill was when the picture is taken. */
const SINCE_LAST_MS = 30 * MS_PER_SECOND;
/** Longer than the default window, so the last kill has fallen out of it. */
const QUIET_MS = 11 * 60 * MS_PER_SECOND;

/** Long enough for the frame's stored box and visibility to come back. */
const SETTLE_MS = 60;
/** Longer than the panel's once-a-second repaint, which is what redraws an ageing rate. */
const REDRAW_MS = 1200;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * The character sheet, where the game keeps it: on the world object rather than the entity. It
 * belongs in `world`, because the addon's first paint decides the panel's shape from it.
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

/** The same hunter at the cap, with the rested pool empty: rested stops accruing at the cap. */
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
 * One kill, the way the wire reports one: a death, then the award it paid. The order matters,
 * since the addon infers a kill from a credited death just before the award. The rested half is
 * inside the amount, as the game puts it.
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

const GRIND_ALT = 'a level bar over a rate, kills left and time left.';

const CAPPED_ALT = 'the same panel at the cap, with a derived virtual level added.';

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
    // A player who stopped: the window empties and every rate figure goes to a dash.
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
