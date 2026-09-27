import { describe, expect, it } from 'vitest';
import { apiSurface, EXEMPT } from '../tools/site/api-surface.ts';
import { loadDocs } from '../tools/site/docs-source.ts';

/**
 * A published API member never written about in the docs fails here. It proves nothing
 * was forgotten, not that anything written is right. Files are read through the tools
 * modules, since noNodejsModules is not exempt in tests/.
 */
const surface = apiSurface();
const prose = loadDocs()
  .map((page) => page.body)
  .join('\n');

describe('the published API surface', () => {
  it('is found at all', () => {
    expect(surface.length).toBeGreaterThan(50);
  });

  it('covers every API domain the woc object exposes', () => {
    const owners = new Set(surface.map((one) => one.owner));
    expect([...owners].sort()).toEqual([
      'BusApi',
      'FmtApi',
      'KeysApi',
      'NetApi',
      'SoundApi',
      'StorageApi',
      'UiApi',
      'WocApi',
      'WorldApi',
    ]);
  });

  it('derives a prefix that the root object actually exposes', () => {
    const rootMembers = new Set(
      surface.filter((one) => one.owner === 'WocApi').map((one) => one.member),
    );
    for (const prefix of new Set(surface.map((one) => one.prefix))) {
      if (prefix !== 'woc') {
        expect(rootMembers).toContain(prefix);
      }
    }
  });
});

describe('the authoring docs', () => {
  it('mention every member of the published surface', () => {
    const missing = surface
      .filter((one) => !EXEMPT[one.qualified])
      .filter((one) => !prose.includes(one.qualified))
      .map((one) => one.qualified);
    expect(missing).toEqual([]);
  });

  it('use the qualified form', () => {
    // A bare `set`, `get` or `on` matches almost any page of prose.
    expect(surface.every((one) => one.qualified.includes('.'))).toBe(true);
  });
});

describe('the exemption list', () => {
  it('only exempts members that exist', () => {
    const qualified = new Set(surface.map((one) => one.qualified));
    for (const name of Object.keys(EXEMPT)) {
      expect(qualified).toContain(name);
    }
  });

  it('gives every exemption a reason', () => {
    for (const [name, reason] of Object.entries(EXEMPT)) {
      expect(reason.length, `${name} needs a reason`).toBeGreaterThan(20);
    }
  });

  it('stays small relative to the surface', () => {
    expect(Object.keys(EXEMPT).length).toBeLessThan(surface.length / 5);
  });
});
