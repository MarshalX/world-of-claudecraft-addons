// The catalog the site and README share, and the rule that hides author tools from players.

import { describe, expect, it } from 'vitest';
import { AUTHOR_TOOL_TAG, isAuthorTool, readAddons } from '../tools/catalog.ts';
import { FEATURED } from '../tools/featured.ts';
import { addonDirs } from '../tools/manifests.ts';

describe('the catalog', () => {
  it('reads every addon directory', () => {
    // A missing row means an invalid manifest; run `pnpm validate` for the real message.
    expect(readAddons().map((one) => one.id)).toEqual(addonDirs());
  });

  it('carries what a page shows, and nothing an addon keeps to itself', () => {
    const row = readAddons().find((one) => one.id === 'combat-meter');
    expect(row).toBeDefined();
    expect(row?.name).toBe('Combat Meter');
    expect(row?.tags).toContain('combat');
    expect(row).not.toHaveProperty('entry');
  });

  it('marks an author tool by its tag, not its id', () => {
    const tools = readAddons().filter((one) => isAuthorTool(one));
    expect(tools.map((one) => one.id)).toEqual(['dev-harness']);
    for (const tool of tools) {
      expect(tool.tags).toContain(AUTHOR_TOOL_TAG);
    }
  });

  it('keeps author tools out of what a player is shown', () => {
    const listed = readAddons().filter((one) => !isAuthorTool(one));
    expect(listed.map((one) => one.id)).not.toContain('dev-harness');
  });
});

describe('the featured four', () => {
  // Both consumers throw on a bad featured id; this fails first and names it.
  it('names addons that exist and declare a preview', () => {
    const byId = new Map(readAddons().map((one) => [one.id, one]));
    for (const id of FEATURED) {
      const addon = byId.get(id);
      if (!addon) {
        throw new Error(`featured addon ${id} is not in addons/; see tools/featured.ts`);
      }
      expect(addon.preview, `featured addon ${id} declares no preview`).not.toBeNull();
      expect(isAuthorTool(addon)).toBe(false);
    }
  });

  it('names each addon once', () => {
    expect(new Set(FEATURED).size).toBe(FEATURED.length);
  });
});
