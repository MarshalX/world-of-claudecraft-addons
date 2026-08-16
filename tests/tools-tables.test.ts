// The reading behind `pnpm tables`: whether a regenerated data table moved
// CONTENT or only its version stamp.
//
// That distinction is the whole reason the tool exists, because it decides an
// addon version bump and both wrong answers cost something. Calling a stamp
// content bumps an addon so every player downloads a body identical to the one
// they have. Calling content a stamp leaves a corrected table bound for nobody:
// no badge, no update row, no error, and fresh installs quietly getting
// different data from everyone already running it.
//
// What this cannot check is whether the tables on disk still match the game.
// That answer lives in a checkout this suite has no path to, and there is no
// endpoint that would 404 to say so. It is a release-time question, answered by
// running the tool.

import { describe, expect, it } from 'vitest';
import { classifyTable, exitCodeFor, renderReport, type TableRow } from '../tools/tables-core.ts';

/** A table with one stamp line and one row, in each generator's spelling. */
function table(stampKey: string, version: string, x: number): string {
  return [
    '{',
    `  "${stampKey}": "${version}",`,
    '  "nodes": [',
    `    { "id": "copper_vein", "x": ${String(x)} }`,
    '  ]',
    '}',
  ].join('\n');
}

function row(state: TableRow['state'], id = 'veinsight'): TableRow {
  return { id, table: `${id}/nodes.json`, state, note: '' };
}

describe('classifyTable', () => {
  it('reads identical bytes as unchanged', () => {
    const before = table('gameVersion', '0.37.1', -70);
    expect(classifyTable(before, before)).toBe('unchanged');
  });

  it('reads a moved stamp alone as a stamp', () => {
    const before = table('gameVersion', '0.37.1', -70);
    const after = table('gameVersion', '0.38.2', -70);
    expect(classifyTable(before, after)).toBe('stamp');
  });

  // The field name was never standardised across the eight generators, so a
  // classifier keyed on one spelling would call another generator's stamp
  // content and bump an addon for nothing.
  it.each(['game', 'gameVersion'])('recognises the stamp spelled %s', (key) => {
    expect(classifyTable(table(key, '0.37.1', -70), table(key, '0.38.2', -70))).toBe('stamp');
  });

  it('reads a moved row as content', () => {
    const before = table('gameVersion', '0.37.1', -70);
    const after = table('gameVersion', '0.37.1', -63);
    expect(classifyTable(before, after)).toBe('content');
  });

  // The case that matters most on a real release: the game moved a node AND the
  // stamp advanced. A classifier that stopped at the first stamp line it
  // recognised would report this as bookkeeping and lose the repair.
  it('reads a moved row as content even when the stamp moved too', () => {
    const before = table('gameVersion', '0.37.1', -70);
    const after = table('gameVersion', '0.38.2', -63);
    expect(classifyTable(before, after)).toBe('content');
  });

  it('reads a gained or lost row as content', () => {
    const before = table('gameVersion', '0.37.1', -70);
    expect(classifyTable(before, `${before}\n`)).toBe('content');
  });

  // A version-shaped string elsewhere in the table is not a stamp. Without the
  // key in the pattern, an item id or a label carrying a number would let a real
  // content change pass as bookkeeping.
  it('does not read an arbitrary version-shaped value as a stamp', () => {
    const before = '{\n  "patch": "0.37.1"\n}';
    const after = '{\n  "patch": "0.38.2"\n}';
    expect(classifyTable(before, after)).toBe('content');
  });
});

describe('renderReport', () => {
  it('names the addons whose content moved and asks for the bump', () => {
    const text = renderReport([row('content'), row('unchanged', 'wayfarer')]);
    expect(text).toContain('Content moved in: veinsight');
    expect(text).toContain('version bumped');
  });

  it('refuses a bump when nothing but stamps moved', () => {
    const text = renderReport([row('stamp'), row('unchanged', 'wayfarer')]);
    expect(text).toContain('Bump no addon version');
    expect(text).not.toContain('Content moved in');
  });

  it('puts a failed generator ahead of the rest of the reading', () => {
    const failed: TableRow = {
      id: 'lorebind',
      table: 'lorebind/*.json',
      state: 'error',
      note: '--game is required',
    };
    const text = renderReport([failed, row('unchanged')]);
    expect(text).toContain('1 generator(s) FAILED');
    expect(text).toContain('--game is required');
  });
});

describe('exitCodeFor', () => {
  // A moved table is the expected result of a game release, not a failure, so it
  // must not break a script somebody wired this into.
  it('succeeds when tables moved', () => {
    expect(exitCodeFor([row('content'), row('stamp')])).toBe(0);
  });

  it('fails only when a generator did', () => {
    const failed: TableRow = {
      id: 'lorebind',
      table: 'lorebind/*.json',
      state: 'error',
      note: 'x',
    };
    expect(exitCodeFor([failed])).toBe(1);
  });
});
