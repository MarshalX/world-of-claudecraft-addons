// @vitest-environment happy-dom

// The square timer.
//
// Most of what a tile is lives in its sheet, and a suite cannot read a sheet under
// vitest, so this pins the two things the module actually decides.
//
// The first is the INVERSION. Every public fraction in this kit means "how much is
// left", and the wedge takes the opposite number: the sheet's gradient is
// transparent as far as the timer has got. Getting that backwards produces a tile
// that is dark when the ability is ready and clear when it is not, which is a
// perfectly plausible-looking overlay that says the opposite of the truth.
//
// The second is the accessible NAME. A tile has no text of its own that names it,
// so the name is composed from parts that move independently, which means it is
// held state and can go stale: a countdown that stops updating the name would
// announce the ability's first second for the whole cooldown.

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
  // Stated as the pair, because either one alone reads as correct under the
  // opposite convention: a full timer covers the art and an expired one gives it
  // all back.
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

  // The same failure a bar's fill has: a NaN assigned to a style property drops the
  // declaration in silence, so the wedge would hold its last angle and read as a
  // timer that has stopped moving.
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

  // The one that goes stale. The name is composed from held state, so a countdown
  // that only moves `value` has to bring the name with it.
  it('follows a figure that moved without the label', () => {
    const tile = createTile(document, { label: 'Fell Shot', value: '4.2s' });

    tile.update({ value: '1.1s' });

    expect(tile.el.getAttribute('aria-label')).toBe('Fell Shot, 1.1s');
  });

  // Art with a wedge over it and no name is not something anyone can act on, and
  // announcing a bare countdown is worse than announcing nothing.
  it('hides an unlabelled tile rather than announcing a bare number', () => {
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
});

describe('the figures', () => {
  it('hides a count it was told nothing about', () => {
    const tile = createTile(document);

    expect(part(tile, '.woc-tile-count').hidden).toBe(true);
  });

  it('takes a count away again rather than leaving the last one up', () => {
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
  // A strip of tiles is rebuilt constantly as auras come and go. One that
  // accumulated its variants would end up bordered by two schools at once, and
  // which one showed would depend on the order the sheet happened to be in.
  it('swaps its school rather than collecting them', () => {
    const tile = createTile(document, { school: 'fire' });

    tile.update({ school: 'frost' });

    expect(tile.el.classList.contains('woc-tile-school-fire')).toBe(false);
    expect(tile.el.classList.contains('woc-tile-school-frost')).toBe(true);
  });

  it('tints nothing for a school the game does not have', () => {
    const tile = createTile(document, { school: 'psychic' as 'fire' });

    expect([...tile.el.classList].some((name) => name.startsWith('woc-tile-school-'))).toBe(false);
  });

  // The art slot hides itself when an image fails, so it has to come back when the
  // tile is pointed at a file that does exist.
  it('gets its art slot back when pointed at something else', () => {
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
  it('is the addon"s when it asked for one', () => {
    const tile = createTile(document, { size: 28 });

    expect(tile.el.style.getPropertyValue('--woc-tile-size')).toBe('28px');
  });

  // A zero-sized tile is invisible and unhittable, and a NaN drops the declaration,
  // so both have to fall through to the sheet's floor rather than being written.
  it.each([
    ['zero', 0],
    ['NaN', Number.NaN],
    ['a string', '40'],
  ])('leaves the sheet"s default in place for %s', (_label, bad) => {
    const tile = createTile(document, { size: bad as number });

    expect(tile.el.style.getPropertyValue('--woc-tile-size')).toBe('');
  });

  // A strip that scales with its frame moves tiles that already exist. Rebuilding
  // them instead would throw away art the browser has already decoded, on every
  // pointer move of a resize.
  it('moves on an update, so a strip can scale without being rebuilt', () => {
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

// A strip of tiles is animated from an addon's frame loop, so `update` runs per tile
// per frame and nearly always says what the tile already says. The accessible name is
// the expensive half of that: it is composed from three parts that move on their own
// schedules, so it was recomposed and rewritten on every call whether or not the
// answer had changed, which put an attribute mutation on the accessibility tree per
// tile per frame.
//
// The second case is what keeps the first from passing vacuously, and the third is
// the one that would break if the guard were written as "write the name once".
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
