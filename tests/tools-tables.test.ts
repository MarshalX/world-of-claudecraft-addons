// The reading behind `pnpm tables`: whether a regenerated data table moved CONTENT or only
// its version stamp, which decides whether the addon's version must be bumped.

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

  // The generators disagree on the stamp field's name.
  it.each(['game', 'gameVersion'])('recognises the stamp spelled %s', (key) => {
    expect(classifyTable(table(key, '0.37.1', -70), table(key, '0.38.2', -70))).toBe('stamp');
  });

  it('reads a moved row as content', () => {
    const before = table('gameVersion', '0.37.1', -70);
    const after = table('gameVersion', '0.37.1', -63);
    expect(classifyTable(before, after)).toBe('content');
  });

  // The usual release: a row and the stamp both moved.
  it('reads a moved row as content even when the stamp moved too', () => {
    const before = table('gameVersion', '0.37.1', -70);
    const after = table('gameVersion', '0.38.2', -63);
    expect(classifyTable(before, after)).toBe('content');
  });

  it('reads a gained or lost row as content', () => {
    const before = table('gameVersion', '0.37.1', -70);
    expect(classifyTable(before, `${before}\n`)).toBe('content');
  });

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
  // A moved table is the expected result of a game release.
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
