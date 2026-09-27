// The README's generated addon section. Do not add a freshness test: the section is
// bot-owned, regenerated on main with the index. The markers are what is pinned.

import { describe, expect, it } from 'vitest';
import { isAuthorTool, readAddons } from '../tools/catalog.ts';
import {
  END,
  firstSentence,
  readReadme,
  renderAddons,
  START,
  spliceReadme,
} from '../tools/readme-core.ts';

describe('README.md', () => {
  it('still carries the markers the generator writes between', () => {
    // Without them `pnpm readme` silently does nothing.
    const readme = readReadme();
    expect(readme, `README.md has lost ${START}; the addon section will stop syncing`).toContain(
      START,
    );
    expect(readme).toContain(END);
    expect(readme.indexOf(START)).toBeLessThan(readme.indexOf(END));
  });

  it('lists every addon a player installs, and links each to its directory', () => {
    const rendered = renderAddons(readAddons());
    for (const addon of readAddons()) {
      expect(rendered, `${addon.id} is missing from the README`).toContain(
        `[${addon.name}](addons/${addon.id})`,
      );
    }
  });

  it('counts what it lists', () => {
    const all = readAddons();
    const listed = all.filter((one) => !isAuthorTool(one)).length;
    expect(renderAddons(all)).toContain(`**${listed} addons ship with the loader**`);
  });

  it('names the author tools it left out', () => {
    const all = readAddons();
    const tools = all.filter((one) => isAuthorTool(one));
    const rendered = renderAddons(all);
    for (const tool of tools) {
      // Dev Harness is in the in-game Browse, so the count must account for it.
      expect(rendered).toContain(`[${tool.name}](addons/${tool.id})`);
    }
  });

  it('refuses to write into a file that has lost its markers', () => {
    expect(() => spliceReadme('# nothing here\n', 'x')).toThrow(/markers/);
  });
});

describe('the summary one line each is cut to', () => {
  it('stops at the first sentence', () => {
    expect(firstSentence('A bar per cooldown. Sorted soonest first.')).toBe('A bar per cooldown.');
  });

  it('keeps a description that is one sentence whole', () => {
    const one = 'What your damage is made of: a row per ability, worst first.';
    expect(firstSentence(one)).toBe(one);
  });

  it('does not cut at a full stop that is not the end of a sentence', () => {
    // Only a capital starts the next sentence.
    expect(firstSentence('A bar reading 4.4s, e.g. a cooldown.')).toBe(
      'A bar reading 4.4s, e.g. a cooldown.',
    );
  });
});
