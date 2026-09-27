// @vitest-environment happy-dom

// The sheet is unreadable under vitest, so this pins what the module decides: the wedge inverts
// the public "how much is left" fraction, and the accessible name is held state that can go stale.

import { describe, expect, it } from 'vitest';
import { createTile } from '../loader/src/runtime/ui/kit/tile.ts';

function part(tile: { el: HTMLElement }, selector: string): HTMLElement {
  const found = tile.el.querySelector<HTMLElement>(selector);
  if (found === null) {
    throw new Error(`no ${selector} in the tile`);
  }
  return found;
}

function sweep(tile: { el: HTMLElement }): string {
  return part(tile, '.woc-tile-sweep').style.getPropertyValue('--woc-tile-sweep');
}

describe('the sweep', () => {
  // Either half alone reads as correct under the opposite convention.
  it('covers the art when the timer is full and clears when it is done', () => {
    const tile = createTile(document, { fraction: 1 });

    expect(sweep(tile)).toBe('0.00%');

    tile.update({ fraction: 0 });

    expect(sweep(tile)).toBe('100.00%');
  });

  it('reads a half-spent timer as half the square', () => {
    const tile = createTile(document, { fraction: 0.5 });

    expect(sweep(tile)).toBe('50.00%');
  });

  // A NaN style value is dropped silently, so the wedge would freeze at its last angle.
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['past the end', 4],
  ])('never writes an angle the browser will ignore, given %s', (_label, bad) => {
    const tile = createTile(document, { fraction: 0.5 });

    tile.update({ fraction: bad as number });

    expect(sweep(tile)).toMatch(/^\d+\.\d\d%$/);
  });

  it('writes the wedge even when the opts said nothing about a timer', () => {
    expect(sweep(createTile(document))).toBe('100.00%');
  });
});

describe('the accessible name', () => {
  it('says everything the tile shows, in the order it is read', () => {
    const tile = createTile(document, { label: 'Fell Shot', value: '4.2s', count: 2 });

    expect(tile.el.getAttribute('role')).toBe('img');
    expect(tile.el.getAttribute('aria-label')).toBe('Fell Shot, 4.2s, 2');
  });

  it('follows a figure that moved without the label', () => {
    const tile = createTile(document, { label: 'Fell Shot', value: '4.2s' });

    tile.update({ value: '1.1s' });

    expect(tile.el.getAttribute('aria-label')).toBe('Fell Shot, 1.1s');
  });

  it('hides an unlabelled tile instead of announcing a bare number', () => {
    const tile = createTile(document, { value: '4.2s' });

    expect(tile.el.getAttribute('aria-hidden')).toBe('true');
    expect(tile.el.getAttribute('role')).toBeNull();
  });

  it('stops hiding the moment it is given a name', () => {
    const tile = createTile(document, { value: '4.2s' });

    tile.update({ label: 'Fell Shot' });

    expect(tile.el.getAttribute('aria-hidden')).toBeNull();
    expect(tile.el.getAttribute('aria-label')).toBe('Fell Shot, 4.2s');
  });

  // Strips reuse tiles, so a name that is never unset announces what the tile used to hold.
  it('goes back to unnamed when the label is nulled', () => {
    const tile = createTile(document, { label: 'Bone Fragments', value: '' });

    tile.update({ label: null });

    expect(tile.el.getAttribute('aria-hidden')).toBe('true');
    expect(tile.el.getAttribute('aria-label')).toBeNull();
  });

  // Undefined means "leave it alone", as for every other member of an update.
  it('leaves the name alone when the label is simply absent', () => {
    const tile = createTile(document, { label: 'Fell Shot' });

    tile.update({ value: '2.0s' });

    expect(tile.el.getAttribute('aria-label')).toBe('Fell Shot, 2.0s');
  });
});

describe('the figures', () => {
  it('hides a count it was told nothing about', () => {
    const tile = createTile(document);

    expect(part(tile, '.woc-tile-count').hidden).toBe(true);
  });

  it('clears a count set to null', () => {
    const tile = createTile(document, { count: 3 });

    tile.update({ count: null });

    expect(part(tile, '.woc-tile-count').hidden).toBe(true);
    expect(part(tile, '.woc-tile-count').textContent).toBe('');
  });

  it('hides the figure when the countdown is cleared', () => {
    const tile = createTile(document, { value: '4.2s' });

    tile.update({ value: '' });

    expect(part(tile, '.woc-tile-value').hidden).toBe(true);
  });
});

describe('a tile reused for something else', () => {
  // An accumulated variant would leave two schools on one tile, decided by sheet order.
  it('swaps its school instead of collecting them', () => {
    const tile = createTile(document, { school: 'fire' });

    tile.update({ school: 'frost' });

    expect(tile.el.classList.contains('woc-tile-school-fire')).toBe(false);
    expect(tile.el.classList.contains('woc-tile-school-frost')).toBe(true);
  });

  it('tints nothing for a school the game does not have', () => {
    const tile = createTile(document, { school: 'psychic' as 'fire' });

    expect([...tile.el.classList].some((name) => name.startsWith('woc-tile-school-'))).toBe(false);
  });

  it('swaps its quality instead of collecting them', () => {
    const tile = createTile(document, { quality: 'rare' });

    tile.update({ quality: 'epic' });

    expect(tile.el.classList.contains('woc-tile-quality-rare')).toBe(false);
    expect(tile.el.classList.contains('woc-tile-quality-epic')).toBe(true);
  });

  // Null means both an unranked item and an unlooked-up id; either keeps the panel's own edge.
  it('drops the tier for a null quality', () => {
    const tile = createTile(document, { quality: 'legendary' });

    tile.update({ quality: null });

    expect([...tile.el.classList].some((name) => name.startsWith('woc-tile-quality-'))).toBe(false);
  });

  it('colours nothing for a tier the game does not rank', () => {
    const tile = createTile(document, { quality: 'mythic' as 'epic' });

    expect([...tile.el.classList].some((name) => name.startsWith('woc-tile-quality-'))).toBe(false);
  });

  // The art slot hides itself on a failed image.
  it('shows its art slot again for a new icon', () => {
    const tile = createTile(document, { icon: '/ui/skills/hunter/aimed_shot.webp' });
    const art = part(tile, '.woc-tile-art');
    art.dispatchEvent(new Event('error'));

    tile.update({ icon: '/ui/skills/mage/fireball.webp' });

    expect(art.hidden).toBe(false);
  });

  it('takes the art away for a null', () => {
    const tile = createTile(document, { icon: '/ui/skills/mage/fireball.webp' });

    tile.update({ icon: null });

    expect(part(tile, '.woc-tile-art').hidden).toBe(true);
  });
});

describe('the size', () => {
  it("is the addon's when it asked for one", () => {
    const tile = createTile(document, { size: 28 });

    expect(tile.el.style.getPropertyValue('--woc-tile-size')).toBe('28px');
  });

  // A zero size is invisible and a NaN drops the declaration, so both fall back to the sheet.
  it.each([
    ['zero', 0],
    ['NaN', Number.NaN],
    ['a string', '40'],
  ])("leaves the sheet's default in place for %s", (_label, bad) => {
    const tile = createTile(document, { size: bad as number });

    expect(tile.el.style.getPropertyValue('--woc-tile-size')).toBe('');
  });

  // Rebuilding tiles on every resize move would discard decoded art.
  it('changes size on an update', () => {
    const tile = createTile(document, { size: 28 });

    tile.update({ size: 64 });

    expect(tile.el.style.getPropertyValue('--woc-tile-size')).toBe('64px');
  });

  it('holds the size it has when an update says nothing about it', () => {
    const tile = createTile(document, { size: 28 });

    tile.update({ value: '4' });

    expect(tile.el.style.getPropertyValue('--woc-tile-size')).toBe('28px');
  });
});

it('removes itself on destroy', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const tile = createTile(document);
  host.appendChild(tile.el);

  tile.destroy();

  expect(host.querySelector('.woc-tile')).toBeNull();
});

// `update` runs per tile per frame, so a repeat must not mutate the DOM or the accessibility tree.
// The second case keeps the first from passing vacuously; the third breaks a "write once" guard.
describe('a tile told what it already says', () => {
  function touches(el: HTMLElement, run: () => void): number {
    const observer = new MutationObserver(() => undefined);
    observer.observe(el, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    run();
    const seen = observer.takeRecords().length;
    observer.disconnect();
    return seen;
  }

  const shown = { label: 'Fireball', value: '4', count: 2, fraction: 0.5, tone: 'warn' } as const;

  it('writes nothing at all when every part repeats', () => {
    const tile = createTile(document, shown);

    expect(touches(tile.el, () => tile.update(shown))).toBe(0);
  });

  it('still writes when one part actually moves', () => {
    const tile = createTile(document, shown);

    expect(touches(tile.el, () => tile.update({ ...shown, value: '3' }))).toBeGreaterThan(0);
  });

  it('recomposes the name when a figure it is made of moves', () => {
    const tile = createTile(document, shown);

    tile.update({ value: '3' });

    expect(tile.el.getAttribute('aria-label')).toBe('Fireball, 3, 2');
  });
});
