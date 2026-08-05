import { describe, expect, it } from 'vitest';
import { API_VERSION } from '../loader/src/shared/api-version.ts';
import { validateIndex, validateManifest } from '../loader/src/shared/schema.ts';

const valid = {
  id: 'combat-meter',
  name: 'Combat Meter',
  version: '1.2.0',
  apiVersion: 1,
  author: 'Marshal',
  description: 'Rolling damage per second.',
  entry: 'main.js',
};

/** The valid manifest with one field replaced, for per-field negative cases. */
const withField = (key: string, value: unknown) => ({ ...valid, [key]: value });

describe('validateManifest', () => {
  // The path is appended to a marketplace base URL, so it carries the same risk
  // `entry` does and is validated by the same shape. A preview that escaped the
  // addon directory would fetch, and show, somebody else's file.
  it('refuses a preview that traverses out of the addon directory', () => {
    const r = validateManifest({ ...valid, preview: { file: '../other/shot.png', alt: 'x' } });
    expect(r.ok).toBe(false);
  });

  it('refuses a preview with no alt text', () => {
    const r = validateManifest({ ...valid, preview: { file: 'preview.png', alt: '' } });
    expect(r.ok).toBe(false);
  });

  // Both halves are required together: a file with no description is a picture a
  // screen reader announces as nothing, and a description with no file is nothing
  // at all.
  it('refuses a preview missing either half', () => {
    expect(validateManifest({ ...valid, preview: { file: 'preview.png' } }).ok).toBe(false);
    expect(validateManifest({ ...valid, preview: { alt: 'x' } }).ok).toBe(false);
  });

  it('accepts a minimal manifest', () => {
    const r = validateManifest(valid);
    expect(r.ok).toBe(true);
  });

  it('accepts the full manifest', () => {
    const r = validateManifest({
      ...valid,
      preview: { file: 'preview.png', alt: 'The panel, mid-fight.' },
      homepage: 'https://github.com/MarshalX/world-of-claudecraft-addons',
      gameVersion: '>=0.31.0',
      channels: ['live', 'pbe'],
      permissions: ['net.read', 'ui'],
      keybinds: [{ id: 'toggle', label: 'Toggle', default: 'Alt+KeyD' }],
      settings: [
        { id: 'window', type: 'number', label: 'Window', default: 5, min: 1, max: 60 },
        { id: 'pet', type: 'boolean', label: 'Pet', default: true },
        { id: 'mode', type: 'select', label: 'Mode', default: 'a', options: ['a', 'b'] },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it('reports every issue in one pass, not just the first', () => {
    const r = validateManifest({ ...valid, id: 'Bad Id', version: 'nope', apiVersion: 'x' });
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    const paths = r.issues.map((i) => i.path);
    expect(paths).toContain('id');
    expect(paths).toContain('version');
    expect(paths).toContain('apiVersion');
  });

  it.each([
    ['id', 'Bad Id'],
    ['id', 'trailing-'],
    ['id', ''],
    ['name', ''],
    ['version', '1.2'],
    ['version', 'v1.2.0'],
    ['apiVersion', 1.5],
    ['apiVersion', '1'],
    ['author', ''],
    ['description', ''],
    ['entry', ''],
    ['homepage', 'not-a-url'],
    ['gameVersion', 'not a range'],
    ['channels', []],
    ['channels', ['nope']],
    ['permissions', ['filesystem']],
  ])('rejects %s = %j', (key, value) => {
    expect(validateManifest(withField(key, value)).ok).toBe(false);
  });

  // entry is fetched and evaluated, so path traversal is a real escape.
  it.each(['../outside.js', 'a/../../b.js', '/absolute.js', 'https://evil.example/x.js'])(
    'rejects entry %j',
    (entry) => {
      expect(validateManifest(withField('entry', entry)).ok).toBe(false);
    },
  );

  it('accepts a nested entry path inside the addon directory', () => {
    expect(validateManifest(withField('entry', 'src/main.js')).ok).toBe(true);
  });

  it('accepts real semver ranges, not just bare comparators', () => {
    for (const range of ['>=0.31.0', '^0.31.0', '~0.31.0', '>=0.31.0 <0.33.0', '0.31.x']) {
      expect(validateManifest(withField('gameVersion', range)).ok).toBe(true);
    }
  });

  it('rejects duplicate keybind ids', () => {
    const r = validateManifest({
      ...valid,
      keybinds: [
        { id: 'toggle', label: 'A', default: 'Alt+KeyA' },
        { id: 'toggle', label: 'B', default: 'Alt+KeyB' },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects duplicate setting ids', () => {
    const r = validateManifest({
      ...valid,
      settings: [
        { id: 'x', type: 'boolean', label: 'A', default: true },
        { id: 'x', type: 'boolean', label: 'B', default: false },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a number setting whose min exceeds max', () => {
    const r = validateManifest({
      ...valid,
      settings: [{ id: 'w', type: 'number', label: 'W', default: 5, min: 10, max: 1 }],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a select whose default is not among its options', () => {
    const r = validateManifest({
      ...valid,
      settings: [{ id: 'm', type: 'select', label: 'M', default: 'z', options: ['a', 'b'] }],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a setting with an unknown type', () => {
    const r = validateManifest({
      ...valid,
      settings: [{ id: 'm', type: 'color', label: 'M', default: '#fff' }],
    });
    expect(r.ok).toBe(false);
  });

  // The surface hands back a PARSED value, so a declared .txt would be a file
  // woc.data could only ever fail on.
  it('refuses a data file that is not .json', () => {
    expect(validateManifest(withField('data', ['items.txt'])).ok).toBe(false);
  });

  it('accepts a declared data file', () => {
    expect(validateManifest(withField('data', ['items.json'])).ok).toBe(true);
  });

  // Same base shape as `entry` and `preview.file`, so the same traversal risk is
  // refused by the same rule: whatever this accepts is appended to a raw base.
  it('refuses a data file that traverses out of the addon directory', () => {
    expect(validateManifest(withField('data', ['../other/items.json'])).ok).toBe(false);
  });

  // A duplicate would be fetched twice at install and stored once, so the
  // manifest and the cache would disagree about how many files there are.
  it('refuses a duplicate data file', () => {
    expect(validateManifest(withField('data', ['a.json', 'a.json'])).ok).toBe(false);
  });

  it('refuses more than eight data files', () => {
    const files = Array.from({ length: 9 }, (_unused, at) => `f${at}.json`);
    expect(validateManifest(withField('data', files)).ok).toBe(false);
    expect(validateManifest(withField('data', files.slice(0, 8))).ok).toBe(true);
  });

  // Bare addon ids, never fqids: the same addon installed from a fork is a
  // different fqid and is still the companion the author meant.
  it('accepts companions as bare addon ids', () => {
    expect(validateManifest(withField('companions', ['lorebind'])).ok).toBe(true);
  });

  it.each(['official/lorebind', 'Lorebind'])('refuses the companion %j', (id) => {
    expect(validateManifest(withField('companions', [id])).ok).toBe(false);
  });

  it('refuses more than four companions', () => {
    expect(validateManifest(withField('companions', ['a', 'b', 'c', 'd', 'e'])).ok).toBe(false);
  });

  // The compatibility this key exists in the shape it does for. A manifest naming bare ids and
  // nothing else is every manifest published before the reasons landed, and it has to keep
  // validating unchanged: a marketplace index is one array parse, so an entry this rejected
  // would take the whole source down rather than one addon.
  it('accepts companions with no reasons at all', () => {
    expect(validateManifest(withField('companions', ['lorebind'])).ok).toBe(true);
  });

  it('accepts a reason for a companion it names', () => {
    const manifest = {
      ...valid,
      companions: ['lorebind'],
      companionReasons: { lorebind: 'publishes item prices' },
    };

    expect(validateManifest(manifest).ok).toBe(true);
  });

  // Two keys describing one relationship is the shape that drifts, so the tie between them is
  // enforced rather than trusted: a reason for an addon nobody named is the drift, and it is a
  // CI failure rather than a line the manager silently never draws.
  it('refuses a reason for an addon it does not name', () => {
    const manifest = {
      ...valid,
      companions: ['lorebind'],
      companionReasons: { satchel: 'publishes item prices' },
    };

    expect(validateManifest(manifest).ok).toBe(false);
  });

  it('refuses a reason with no companions list at all', () => {
    expect(validateManifest(withField('companionReasons', { lorebind: 'why' })).ok).toBe(false);
  });

  it.each([
    ['an empty reason', ''],
    ['a reason past the length cap', 'x'.repeat(141)],
  ])('refuses %s', (_case, reason) => {
    const manifest = { ...valid, companions: ['lorebind'], companionReasons: { lorebind: reason } };

    expect(validateManifest(manifest).ok).toBe(false);
  });

  it.each([null, 'string', 42, []])('rejects non-object input %j', (input) => {
    expect(validateManifest(input).ok).toBe(false);
  });

  it('pins the current API version', () => {
    expect(API_VERSION).toBe(1);
  });
});

describe('validateIndex', () => {
  const index = {
    schema: 1,
    name: 'Official Marketplace',
    generated: '2026-07-29T00:00:00Z',
    addons: [{ ...valid, path: 'addons/combat-meter' }],
  };

  it('accepts a well-formed index', () => {
    expect(validateIndex(index).ok).toBe(true);
  });

  it('accepts an empty addon list', () => {
    expect(validateIndex({ ...index, addons: [] }).ok).toBe(true);
  });

  it('rejects an unknown schema version', () => {
    expect(validateIndex({ ...index, schema: 2 }).ok).toBe(false);
  });

  it('rejects an entry missing its path', () => {
    expect(validateIndex({ ...index, addons: [valid] }).ok).toBe(false);
  });

  it('rejects an entry whose manifest is invalid', () => {
    const bad = { ...valid, version: 'nope', path: 'addons/x' };
    expect(validateIndex({ ...index, addons: [bad] }).ok).toBe(false);
  });
});
