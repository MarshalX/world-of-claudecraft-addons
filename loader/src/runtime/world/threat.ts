// A mob's hate table, sorted and measured against the player.
//
// The rows are the server's own threat numbers. The table is capped at the top eight, and sent
// only for a MOB in combat, so empty means "not fighting" or "not a mob", never "all at zero".

import type { Entity } from './game-types.ts';

interface ThreatRow {
  entityId: number;
  threat: number;
}

interface ThreatTable {
  /** Highest first. At most eight rows, whatever the group's size. */
  rows: readonly ThreatRow[];
  /** The player's own threat, or null when they are not on the table. */
  mine: number | null;
  /** The top row's threat, or null when the table is empty. */
  top: number | null;
  /**
   * The player's threat as a fraction of the top, or null when either is absent. 1 means they ARE
   * the top row.
   */
  share: number | null;
}

const EMPTY: ThreatTable = Object.freeze({
  rows: Object.freeze([]),
  mine: null,
  top: null,
  share: null,
});

/**
/** The player's own threat, or null when absent from the table, which is not the same as zero. */
function rowFor(table: ReadonlyMap<number, number>, playerId: number | null): number | null {
  if (playerId === null) {
    return null;
  }
  return table.get(playerId) ?? null;
}

/** The highest row, or null for a table with nothing in it. */
function topOf(rows: readonly ThreatRow[]): number | null {
  const [first] = rows;
  if (first === undefined) {
    return null;
  }
  return first.threat;
}

function shareOf(mine: number | null, top: number | null): number | null {
  if (mine === null || top === null || top <= 0) {
    return null;
  }
  return mine / top;
}

/**
 * One entity's hate table, or an empty reading when it has none. With a null `playerId` the rows
 * are still reported, without `mine`.
 */
function readThreat(entity: Entity | null, playerId: number | null): ThreatTable {
  if (entity === null || !(entity.threat instanceof Map) || entity.threat.size === 0) {
    return EMPTY;
  }
  const rows: ThreatRow[] = [];
  for (const [entityId, threat] of entity.threat) {
    rows.push({ entityId, threat });
  }
  rows.sort((a, b) => b.threat - a.threat);

  const mine = rowFor(entity.threat, playerId);
  const top = topOf(rows);
  return { rows, mine, top, share: shareOf(mine, top) };
}

export type { ThreatRow, ThreatTable };
export { EMPTY as NO_THREAT, readThreat };
