// The README's generated addon section.
//
// The case that matters is the first one: it fails when an addon lands and
// nobody runs `pnpm readme`, which is the exact way the hand-written section this
// replaced went out of date. It is a Vitest case rather than a step in CI so that
// `pnpm check` catches it locally, before the commit rather than after it.

import { describe, expect, it } from 'vitest';
import { readAddons } from '../tools/catalog.ts';
import { firstSentence, readReadme, renderAddons, spliceReadme } from '../tools/readme-core.ts';

describe('README.md', () => {
  it('is in step with the manifests', () => {
    const current = readReadme();
    expect(
      spliceReadme(current, renderAddons(readAddons())),
      'README.md is out of date; run `pnpm readme`',
    ).toBe(current);
  });

  it('lists every addon a player installs, and links each to its directory', () => {
    const rendered = renderAddons(readAddons());
    for (const addon of readAddons()) {
      expect(rendered, `${addon.id} is missing from the README`).toContain(
        `[${addon.name}](addons/${addon.id})`,
      );
    }
  });

  it('says what it left out of the catalog rather than shortening the count', () => {
    const rendered = renderAddons(readAddons());
    // Dev Harness ships and is in the in-game Browse. A README claiming 31 where
    // the game offers 32 is the report this line exists to prevent.
    expect(rendered).toContain('[Dev Harness](addons/dev-harness)');
    expect(rendered).toContain('**31 addons ship with the loader**');
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
    // Only a capital starts the next sentence, so `4.4s`, `woc.ui.frame` and an
    // abbreviation mid-clause all stay put. A length-based cut would take the
    // first of these mid-number.
    expect(firstSentence('A bar reading 4.4s, e.g. a cooldown.')).toBe(
      'A bar reading 4.4s, e.g. a cooldown.',
    );
  });
});
