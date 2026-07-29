import { describe, expect, it } from 'vitest';
import { API_VERSION } from '../loader/src/shared/api-version.ts';
import { validateIndex, validateManifest } from '../loader/src/shared/schema.ts';

const valid = {
  id: 'dps-meter',
  name: 'DPS Meter',
  version: '1.2.0',
  apiVersion: 1,
  author: 'Marshal',
  description: 'Rolling damage per second.',
  entry: 'main.js',
};

/** The valid manifest with one field replaced, for per-field negative cases. */
const withField = (key: string, value: unknown) => ({ ...valid, [key]: value });

describe('validateManifest', () => {
  it('accepts a minimal manifest', () => {
    const r = validateManifest(valid);
    expect(r.ok).toBe(true);
  });

  it('accepts the full manifest', () => {
    const r = validateManifest({
      ...valid,
      icon: 'sword',
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
    addons: [{ ...valid, path: 'addons/dps-meter' }],
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
