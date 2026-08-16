// The reading behind `pnpm tables`: given a data table before and after its
// generator ran, say whether the game actually moved anything.
//
// Three states, and the middle one is the one that gets decided wrongly. A table
// records which game version it was read from, so regenerating against a new
// release rewrites that stamp whether or not a single row changed. UNCHANGED and
// STAMP both mean the game moved nothing a player can see; CONTENT means it did.
// The distinction is what decides an addon version bump, and bumping for a stamp
// ships a download that tells the player nothing changed.
//
// Pure on purpose. Spawning the generators and touching the tree is the entry
// point's job, so everything here can be tested against strings.

/**
 * A line recording which game version the table was read from.
 *
 * Field names were never standardised across the generators: `game`,
 * `gameVersion`, and one nested inside a `source` object. Matching the VALUE
 * shape rather than the key covers all of them, and covers a new generator's
 * spelling for free.
 */
const STAMP_LINE = /"(?:game|gameVersion)"\s*:\s*"\d+\.\d+(?:\.\d+)?"/;

const STATE_LABEL: Readonly<Record<TableState, string>> = {
  content: 'CONTENT',
  stamp: 'stamp only',
  unchanged: 'unchanged',
  error: 'FAILED',
};

const EXIT_FAILURE = 1;

function movedLines(before: string, after: string): string[] | null {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  if (beforeLines.length !== afterLines.length) {
    return null;
  }
  return beforeLines.filter((line, i) => line !== afterLines[i]);
}

function rowLine(row: TableRow, width: number): string {
  const cells = [row.table.padEnd(width), STATE_LABEL[row.state], row.note];
  return cells.filter(Boolean).join('  ');
}

function summary(rows: readonly TableRow[]): string[] {
  const changed = rows.filter((row) => row.state === 'content');
  const failed = rows.filter((row) => row.state === 'error');
  const lines: string[] = [];
  if (failed.length > 0) {
    lines.push(
      `${String(failed.length)} generator(s) FAILED. Read the error before trusting the rest.`,
    );
  }
  if (changed.length === 0) {
    lines.push('No table moved. Bump no addon version: a stamp is not an observable change.');
    return lines;
  }
  const ids = [...new Set(changed.map((row) => row.id))].join(', ');
  lines.push(`Content moved in: ${ids}`);
  lines.push('Each of those needs its addon.json version bumped, and needs reading:');
  lines.push('a table that moved is the game having re-sited content a player walks to.');
  return lines;
}

/**
 * Whether a regeneration changed the table, only its stamp, or nothing.
 *
 * A differing line count is content by definition: a stamp is one line replaced
 * in place, so a table that grew or shrank gained or lost rows.
 */
export function classifyTable(before: string, after: string): TableState {
  if (before === after) {
    return 'unchanged';
  }
  const moved = movedLines(before, after);
  if (moved === null) {
    return 'content';
  }
  if (moved.every((line) => STAMP_LINE.test(line))) {
    return 'stamp';
  }
  return 'content';
}

/** The whole report as text, so the caller decides where it goes. */
export function renderReport(rows: readonly TableRow[]): string {
  const width = Math.max(...rows.map((row) => row.table.length));
  const body = rows.map((row) => rowLine(row, width));
  return [...body, '', ...summary(rows)].join('\n');
}

/**
 * Non-zero only when a generator FAILED.
 *
 * A moved table is the expected result of a game release rather than an error,
 * so it must not fail a script somebody wired into a check.
 */
export function exitCodeFor(rows: readonly TableRow[]): number {
  if (rows.some((row) => row.state === 'error')) {
    return EXIT_FAILURE;
  }
  return 0;
}

/** What a regeneration did to one table. */
export type TableState = 'unchanged' | 'stamp' | 'content' | 'error';

/** One table's result, or one generator's failure. */
export interface TableRow {
  /** The addon the table belongs to. */
  readonly id: string;
  /** Display path, `<id>/<file>.json`, or `<id>/*.json` for a failure. */
  readonly table: string;
  readonly state: TableState;
  /** A generator's error text, or a note such as a table being new. */
  readonly note: string;
}
