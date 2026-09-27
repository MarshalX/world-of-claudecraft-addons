import { describe, expect, it } from 'vitest';
// biome-ignore-start lint/correctness/noUnresolvedImports: Vite's ?raw suffix is a loader directive a static resolver does not model, and an addon file is a function BODY with no exports at all. Same reason as the addon suites.
import combatMeter from '../addons/combat-meter/main.js?raw';
import cooldownBars from '../addons/cooldown-bars/main.js?raw';
// biome-ignore-end lint/correctness/noUnresolvedImports: both addons, and nothing else here is loaded as text
import { extractRegion, regionNames } from '../tools/site/regions.ts';

// The docs quote these regions by name, so a rename in an addon fails here rather than in the
// site build. Each entry names what the region is quoted for; adding a region adds a line.
const QUOTED = [
  {
    file: 'addons/cooldown-bars/main.js',
    source: cooldownBars,
    regions: {
      /** The API page for `woc.ui.frame`. */
      frame: ['woc.ui.frame', 'frame.body.appendChild'],
      /** The API page for `woc.ui.bar`, icons and tooltips, and Patterns "Reuse the kit". */
      bar: ['woc.ui.bar', 'woc.ui.icon.ability', 'woc.ui.tooltip'],
      /** The API page for `woc.ui.tile`, which is the same row as a square. */
      tile: ['woc.ui.tile', 'woc.ui.icon.ability', 'label'],
      /** The API page for a tooltip whose content is asked for when it is shown. */
      tooltip: ['title:', 'tone:', 'woc.ui.icon.ability'],
      /** Patterns: redrawing a list. The page teaches `key` and `shown` by name. */
      list: ['woc.ui.list', 'key:', 'shown:'],
      /** Patterns, "Subscribe for the set, animate from the read". */
      'subscribe-and-animate': ["woc.world.on('cooldowns'", 'woc.requestAnimationFrame'],
    },
  },
  {
    file: 'addons/combat-meter/main.js',
    source: combatMeter,
    regions: {
      /** Patterns, "An event's ability is a name, not an id": heal2 and the cueOnly flag. */
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

  // The cap is arbitrary and loose, to catch a region that swallowed the file.
  it('keeps every region short enough to read in a docs page', () => {
    for (const name of regionNames(source)) {
      expect(extractRegion(source, name, 'addon').split('\n').length).toBeLessThan(40);
    }
  });
});
