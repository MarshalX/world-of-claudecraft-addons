import { describe, expect, it } from 'vitest';
// biome-ignore-start lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all. Same reason as the addon suites.
import combatMeter from '../addons/combat-meter/main.js?raw';
import cooldownBars from '../addons/cooldown-bars/main.js?raw';
// biome-ignore-end lint/correctness/noUnresolvedImports: both addons, and nothing else here is loaded as text
import { extractRegion, regionNames } from '../tools/site/regions.ts';

// The docs quote these passages by name. A rename or a delete in an addon has to
// fail HERE, in the fast suite, rather than in the site build: the addons are
// edited far more often than the docs are, and `pnpm check` is what an addon
// change actually runs.
//
// Each entry names what the region is quoted FOR, because that is the thing that
// decides whether a future edit still belongs inside the markers. Adding a region
// means adding a line here.
const QUOTED = [
  {
    file: 'addons/cooldown-bars/main.js',
    source: cooldownBars,
    regions: {
      /** The API page for `woc.ui.frame`. */
      frame: ['woc.ui.frame', 'frame.body.appendChild'],
      /**
       * The API page for `woc.ui.bar`, icons and tooltips, AND Patterns under
       * "Reuse the kit before styling your own". Two pages, so an edit inside
       * these markers has to suit both.
       */
      bar: ['woc.ui.bar', 'woc.ui.icon.ability', 'woc.ui.tooltip'],
      /** The API page for `woc.ui.tile`, which is the same row as a square. */
      tile: ['woc.ui.tile', 'woc.ui.icon.ability', 'label'],
      /** The API page for a tooltip whose content is asked for when it is shown. */
      tooltip: ['title:', 'tone:', 'woc.ui.icon.ability'],
      /**
       * Patterns: redrawing a list moves every row, and what that costs.
       *
       * It was `place`, the hand-rolled reconcile pass, until `woc.ui.list`
       * absorbed it. The page teaches `key` and `shown` by name, so both have to
       * stay inside the markers: `shown` is the whole reason this addon holds
       * more rows than it draws rather than slicing before it syncs.
       */
      list: ['woc.ui.list', 'key:', 'shown:'],
      /**
       * Patterns, "Subscribe for the set, animate from the read", which opens the
       * page and is the single most important example in the docs.
       */
      'subscribe-and-animate': ["woc.world.on('cooldowns'", 'woc.requestAnimationFrame'],
    },
  },
  {
    file: 'addons/combat-meter/main.js',
    source: combatMeter,
    regions: {
      /**
       * Patterns, "An event's ability is a name, not an id": a heal is attributed
       * from heal2, and cueOnly is a FLAG rather than an amount of zero.
       */
      'heal-attribution': ["woc.net.onEvent('heal2'", 'event.sourceId', 'cueOnly'],
      /** The API page for a bar's school tinting. */
      'school-tint': ['woc.ui.bar', 'school'],
    },
  },
] as const;

describe.each(QUOTED)('$file', ({ source, regions }) => {
  it.each(Object.entries(regions))('has region %s carrying what the docs quote', (name, must) => {
    const body = extractRegion(source, name, 'addon');
    for (const fragment of must) {
      expect(body).toContain(fragment);
    }
  });

  it('declares each region exactly once', () => {
    const names = regionNames(source);
    expect(names).toHaveLength(new Set(names).size);
  });

  it('opens and closes every region it declares', () => {
    for (const name of regionNames(source)) {
      expect(() => extractRegion(source, name, 'addon')).not.toThrow();
    }
  });

  // A region that grew to swallow the file is a region nobody curated, and the
  // docs would quote a wall. Any real cap is arbitrary; this one is loose enough
  // that only a genuine mistake reaches it.
  it('keeps every region short enough to read in a docs page', () => {
    for (const name of regionNames(source)) {
      expect(extractRegion(source, name, 'addon').split('\n').length).toBeLessThan(40);
    }
  });
});
