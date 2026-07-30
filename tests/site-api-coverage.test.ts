import { describe, expect, it } from 'vitest';
import { apiSurface, EXEMPT } from '../tools/site/api-surface.ts';
import { loadDocs } from '../tools/site/docs-source.ts';

/**
 * The guard the docs rest on: a member added to the published API and never
 * written about fails here, in the fast suite, rather than at a deploy.
 *
 * It proves nothing was FORGOTTEN. It cannot prove anything is right: a paragraph
 * describing `world.entities` wrongly passes this test. That limit is real and
 * stated rather than papered over, because the failure it does catch is the one
 * that actually happens.
 *
 * Reading through the tools modules rather than node:fs directly, since
 * noNodejsModules is not exempt in tests/ and AGENTS.md says not to widen it.
 */
const surface = apiSurface();
const prose = loadDocs()
  .map((page) => page.body)
  .join('\n');

describe('the published API surface', () => {
  it('is found at all, so a parser that silently matches nothing cannot pass', () => {
    expect(surface.length).toBeGreaterThan(50);
  });

  it('covers every API domain the woc object exposes', () => {
    const owners = new Set(surface.map((one) => one.owner));
    expect([...owners].sort()).toEqual([
      'KeysApi',
      'NetApi',
      'SoundApi',
      'StorageApi',
      'UiApi',
      'WocApi',
      'WorldApi',
    ]);
  });

  // Each sub-API is reached through a member of the root, so a prefix with no
  // matching member means the qualified names this test searches for are wrong.
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

  it('use the qualified form, because a bare member name matches ordinary prose', () => {
    // `api` matched the word "API" and `set`, `get` and `on` match almost any
    // page, so bare-name matching reported success for members nobody had written
    // about. This pins the qualified form rather than trusting it stays.
    expect(surface.every((one) => one.qualified.includes('.'))).toBe(true);
  });
});

describe('the exemption list', () => {
  it('only exempts members that exist, so a rename cannot leave a dead entry', () => {
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

  // An exemption list that grows without anyone noticing is how a docs section
  // stops covering its subject one member at a time.
  it('stays small relative to the surface', () => {
    expect(Object.keys(EXEMPT).length).toBeLessThan(surface.length / 5);
  });
});
