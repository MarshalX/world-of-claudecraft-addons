// Which instanced run the player is inside, if any.
//
// Deliberately thin: the game's run record is fast-changing delve content, so only which run,
// how far through, and whether it is over are published. The rest is `world.raw`.

import { fieldArray, fieldNumber, fieldString, fieldValue } from '../net/frames.ts';

interface RunInfo {
  delveId: string;
  tierId: string;
  /** How many modules deep, against `moduleCount`. */
  moduleIndex: number;
  moduleCount: number;
  completed: boolean;
  /** The way out is open, which is the run's real end for a player. */
  exitPortalOpen: boolean;
  /** This run rolled the richer reward, which changes what the finish is worth. */
  bountiful: boolean;
}

interface EncounterInfo {
  /** The run in progress, or null out in the world. */
  run: RunInfo | null;
  /** Delve id to how many times it has been finished. */
  clears: ReadonlyMap<string, number>;
}

function runOf(world: unknown): RunInfo | null {
  const run = fieldValue(world, 'delveRun');
  if (run === null) {
    return null;
  }
  return {
    delveId: fieldString(run, 'delveId') ?? '',
    tierId: fieldString(run, 'tierId') ?? '',
    moduleIndex: fieldNumber(run, 'moduleIndex') ?? 0,
    moduleCount: fieldNumber(run, 'moduleCount') ?? fieldArray(run, 'modules').length,
    completed: fieldValue(run, 'completed') === true,
    exitPortalOpen: fieldValue(run, 'exitPortalOpen') === true,
    bountiful: fieldValue(run, 'bountiful') === true,
  };
}

function clearsOf(world: unknown): ReadonlyMap<string, number> {
  const clears = fieldValue(world, 'delveClears');
  const out = new Map<string, number>();
  if (clears === null || typeof clears !== 'object') {
    return out;
  }
  for (const [delveId, count] of Object.entries(clears as Record<string, unknown>)) {
    if (typeof count === 'number') {
      out.set(delveId, count);
    }
  }
  return out;
}

/** The encounter reading, or null before there is a world to read it from. */
function readEncounter(world: unknown): EncounterInfo | null {
  if (world === null) {
    return null;
  }
  return { run: runOf(world), clears: clearsOf(world) };
}

export type { EncounterInfo, RunInfo };
export { readEncounter };
