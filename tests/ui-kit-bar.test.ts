// @vitest-environment happy-dom

// The timer bar and the centre-screen banner.

import { afterEach, describe, expect, it } from 'vitest';

import { BANNER_ID, createBanner } from '../loader/src/runtime/ui/kit/banner.ts';
import { createBar } from '../loader/src/runtime/ui/kit/bar.ts';
import { clampFraction } from '../loader/src/runtime/ui/kit/readout.ts';

function root(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'woc-addons';
  document.body.appendChild(el);
  return el;
}

function part(bar: { el: HTMLElement }, selector: string): HTMLElement {
  const found = bar.el.querySelector(selector);
  if (!(found instanceof HTMLElement)) {
    throw new Error(`no ${selector} in the bar`);
  }
  return found;
}

function banner() {
  const timers = new Map<number, () => void>();
  let nextId = 1;
  const instance = createBanner({
    doc: document,
    root: root(),
    setTimer: (handler) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, handler);
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id);
    },
  });
  return {
    instance,
    /** Fire every timer still armed, the way a clock reaching them would. */
    elapse: () => {
      for (const handler of [...timers.values()]) {
        handler();
      }
    },
    armed: () => timers.size,
    slot: () => document.getElementById(BANNER_ID),
    cards: () => document.querySelectorAll('.woc-banner-card'),
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('a bar', () => {
  it('draws the label, the figure and the fill', () => {
    const bar = createBar(document, { label: 'Aimed Shot', value: '4.2s', fraction: 0.5 });

    expect(part(bar, '.woc-bar-label').textContent).toBe('Aimed Shot');
    expect(part(bar, '.woc-bar-value').textContent).toBe('4.2s');
    expect(part(bar, '.woc-bar-fill').style.width).toBe('50.00%');
  });

  it('starts empty when told nothing at all', () => {
    const bar = createBar(document);

    expect(part(bar, '.woc-bar-fill').style.width).toBe('0.00%');
    expect(part(bar, '.woc-bar-label').textContent).toBe('');
  });

  it('changes only what an update names', () => {
    const bar = createBar(document, { label: 'Fireball', value: '8.0s' });

    bar.update({ value: '2.0s' });

    expect(part(bar, '.woc-bar-label').textContent).toBe('Fireball');
    expect(part(bar, '.woc-bar-value').textContent).toBe('2.0s');
  });

  it("carries an addon's own class alongside the kit's", () => {
    const bar = createBar(document, { className: 'my-cd-row' });

    expect(bar.el.classList.contains('woc-bar')).toBe(true);
    expect(bar.el.classList.contains('my-cd-row')).toBe(true);
  });

  it('swaps the tone class rather than accumulating them', () => {
    const bar = createBar(document, { tone: 'warn' });

    bar.update({ tone: 'danger' });

    expect(bar.el.classList.contains('woc-bar-warn')).toBe(false);
    expect(bar.el.classList.contains('woc-bar-danger')).toBe(true);
  });

  it('falls back to the default tone for a value it does not know', () => {
    const bar = createBar(document, { tone: 'critical' as 'warn' });

    expect(bar.el.classList.contains('woc-bar-default')).toBe(true);
  });

  it('hides the second line until there is one', () => {
    const bar = createBar(document, { label: 'Fireball' });

    expect((part(bar, '.woc-bar-detail') as HTMLElement).hidden).toBe(true);
  });

  it('shows the second line when given one', () => {
    const bar = createBar(document, { label: 'Fireball', detail: '12 hits, 24% crit' });
    const detail = part(bar, '.woc-bar-detail');

    expect(detail.hidden).toBe(false);
    expect(detail.textContent).toBe('12 hits, 24% crit');
  });

  // Hidden rather than emptied, so switching the detail off does not leave the gap
  // the second line's own spacing would still take.
  it('hides the line again when the detail is cleared', () => {
    const bar = createBar(document, { detail: '12 hits' });

    bar.update({ detail: '' });

    expect((part(bar, '.woc-bar-detail') as HTMLElement).hidden).toBe(true);
  });

  // The fill spans both lines, so a share reads as the whole row's.
  it('puts the fill behind both lines rather than inside the head', () => {
    const bar = createBar(document, { detail: '12 hits', fraction: 0.5 });

    expect(part(bar, '.woc-bar-fill').parentElement).toBe(bar.el);
    expect(part(bar, '.woc-bar-label').closest('.woc-bar-head')).not.toBeNull();
  });

  // Which of school and tone wins is settled in the sheet by source order, so the module only
  // records both.
  it('tints by school without disturbing the tone', () => {
    const bar = createBar(document, { tone: 'warn', school: 'frost' });

    expect(bar.el.classList.contains('woc-bar-warn')).toBe(true);
    expect(bar.el.classList.contains('woc-bar-school-frost')).toBe(true);
  });

  it('swaps the school class rather than accumulating them', () => {
    const bar = createBar(document, { school: 'fire' });

    bar.update({ school: 'shadow' });

    expect(bar.el.classList.contains('woc-bar-school-fire')).toBe(false);
    expect(bar.el.classList.contains('woc-bar-school-shadow')).toBe(true);
  });

  // A heal carries no school, so null is a legitimate value and must tint nothing.
  it.each([
    ['null, which a healing row passes', null],
    ['a school the game does not have', 'chaos' as 'fire'],
  ])('tints nothing for %s', (_label, school) => {
    const bar = createBar(document, { school });

    expect([...bar.el.classList].some((name) => name.startsWith('woc-bar-school-'))).toBe(false);
  });

  it('carries a quality beside a tone and a school rather than instead of one', () => {
    const bar = createBar(document, { tone: 'warn', school: 'shadow', quality: 'epic' });

    expect(bar.el.classList.contains('woc-bar-warn')).toBe(true);
    expect(bar.el.classList.contains('woc-bar-school-shadow')).toBe(true);
    expect(bar.el.classList.contains('woc-bar-quality-epic')).toBe(true);
  });

  it('swaps the quality class rather than accumulating them', () => {
    const bar = createBar(document, { quality: 'poor' });

    bar.update({ quality: 'rare' });

    expect(bar.el.classList.contains('woc-bar-quality-poor')).toBe(false);
    expect(bar.el.classList.contains('woc-bar-quality-rare')).toBe(true);
  });

  it('carries a class beside the other three', () => {
    const bar = createBar(document, {
      tone: 'warn',
      school: 'shadow',
      quality: 'epic',
      unitClass: 'priest',
    });

    expect(bar.el.classList.contains('woc-bar-class-priest')).toBe(true);
    expect(bar.el.classList.contains('woc-bar-warn')).toBe(true);
  });

  it('swaps the class rather than accumulating them', () => {
    const bar = createBar(document, { unitClass: 'mage' });

    bar.update({ unitClass: 'druid' });

    expect(bar.el.classList.contains('woc-bar-class-mage')).toBe(false);
    expect(bar.el.classList.contains('woc-bar-class-druid')).toBe(true);
  });

  // A `templateId` is a mob template on anything but a player, so `boss_wolf` reaches this field.
  it.each([
    ['null, which a caller who checked the kind passes', null],
    ['a mob template, which is what a templateId is off a player', 'boss_wolf' as 'mage'],
  ])('tints nothing for %s', (_label, unitClass) => {
    const bar = createBar(document, { unitClass });

    expect([...bar.el.classList].some((name) => name.startsWith('woc-bar-class-'))).toBe(false);
  });

  // Null means the tier is unknown, which is ordinary for an item id, so nothing is guessed.
  it.each([
    ['null, which an id nobody has looked up passes', null],
    ['a tier the game does not rank', 'mythic' as 'epic'],
  ])('colours nothing for %s', (_label, quality) => {
    const bar = createBar(document, { quality });

    expect([...bar.el.classList].some((name) => name.startsWith('woc-bar-quality-'))).toBe(false);
  });

  it('clears a school it had when told null', () => {
    const bar = createBar(document, { school: 'nature' });

    bar.update({ school: null });

    expect(bar.el.classList.contains('woc-bar-school-nature')).toBe(false);
  });

  it('removes itself on destroy', () => {
    const bar = createBar(document);
    root().appendChild(bar.el);

    bar.destroy();

    expect(document.querySelector('.woc-bar')).toBeNull();
  });
});

describe("a bar's fill fraction", () => {
  // A cooldown the addon has not seen start divides by zero, and Infinity and NaN both drop
  // the style declaration silently, freezing the bar at its last width.
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a string', '0.5'],
    ['undefined dressed as a number', undefined],
  ])('reads %s as empty rather than dropping the declaration', (_label, bad) => {
    expect(clampFraction(bad)).toBe(0);
  });

  it('clamps a fraction past either end', () => {
    expect(clampFraction(1.4)).toBe(1);
    expect(clampFraction(-3)).toBe(0);
  });

  it('never writes a width the browser will ignore', () => {
    const bar = createBar(document, { fraction: 0.8 });

    bar.update({ fraction: Number.NaN });

    expect(part(bar, '.woc-bar-fill').style.width).toBe('0.00%');
  });
});

// `update` runs per row per frame and nearly always repeats itself, and every write dirties
// style recalc. The second case keeps the first from passing on a mis-wired observer.
describe('a readout told what it already says', () => {
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

  const shown = {
    label: 'Fireball',
    value: '4.2s',
    detail: '12 hits, 24% crit',
    fraction: 0.5,
    school: 'fire',
    tone: 'warn',
  } as const;

  it('writes nothing at all when every part repeats', () => {
    const bar = createBar(document, shown);

    expect(touches(bar.el, () => bar.update(shown))).toBe(0);
  });

  it('still writes when one part actually moves', () => {
    const bar = createBar(document, shown);

    expect(touches(bar.el, () => bar.update({ ...shown, value: '4.1s' }))).toBeGreaterThan(0);
    expect(part(bar, '.woc-bar-value').textContent).toBe('4.1s');
  });
});

describe("a bar's figure as money", () => {
  function coins(bar: { el: HTMLElement }): string[] {
    return [...bar.el.querySelectorAll('.woc-coin-part')].map(
      (el) => `${el.querySelector('.woc-coin')?.className ?? ''}=${el.textContent ?? ''}`,
    );
  }

  it('draws a coin per unit and leaves the empty ones out', () => {
    const bar = createBar(document, { value: { copper: 780 } });

    expect(coins(bar)).toEqual(['woc-coin woc-coin-silver=7', 'woc-coin woc-coin-copper=80']);
  });

  it('keeps copper when the whole amount is nothing', () => {
    const bar = createBar(document, { value: { copper: 0 } });

    expect(coins(bar)).toEqual(['woc-coin woc-coin-copper=0']);
  });

  // A price divided by a missing count is NaN, and `NaNg NaNs NaNc` is worse than a zero.
  it('reads an amount that is not a number as nothing', () => {
    const bar = createBar(document, { value: { copper: Number.NaN } });

    expect(coins(bar)).toEqual(['woc-coin woc-coin-copper=0']);
  });

  // A disc reads as nothing, so a figure read child by child announces "low 7 80".
  it('is announced as one figure with its units in words', () => {
    const bar = createBar(document, { value: { copper: 10_780, prefix: 'low' } });
    const value = part(bar, '.woc-bar-value');

    expect(value.getAttribute('role')).toBe('img');
    expect(value.getAttribute('aria-label')).toBe('low 1 gold, 7 silver, 80 copper');
  });

  it('takes that announcement back when the row is reused for a plain figure', () => {
    const bar = createBar(document, { value: { copper: 780 } });
    bar.update({ value: '4.2s' });
    const value = part(bar, '.woc-bar-value');

    expect(value.textContent).toBe('4.2s');
    expect(value.hasAttribute('aria-label')).toBe(false);
    expect(value.hasAttribute('role')).toBe(false);
  });

  it('redraws nothing when the same amount is written again', () => {
    const bar = createBar(document, { value: { copper: 780 } });
    const observer = new MutationObserver(() => undefined);
    observer.observe(bar.el, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    bar.update({ value: { copper: 780 } });
    const seen = observer.takeRecords().length;
    observer.disconnect();

    expect(seen).toBe(0);
  });
});

describe("a bar's icon", () => {
  it('is hidden until there is a URL for it', () => {
    const bar = createBar(document, { label: 'Melee' });

    expect((part(bar, '.woc-bar-icon') as HTMLImageElement).hidden).toBe(true);
  });

  it('is shown when given one', () => {
    const bar = createBar(document, { icon: '/ui/skills/hunter/aimed_shot.webp' });
    const icon = part(bar, '.woc-bar-icon') as HTMLImageElement;

    expect(icon.hidden).toBe(false);
    expect(icon.getAttribute('src')).toBe('/ui/skills/hunter/aimed_shot.webp');
  });

  // Not every ability ships painted art, so a 404 is ordinary and collapses the slot.
  it('hides itself when the art does not exist', () => {
    const bar = createBar(document, { icon: '/ui/skills/mage/no_such_art.webp' });
    const icon = part(bar, '.woc-bar-icon') as HTMLImageElement;

    icon.dispatchEvent(new Event('error'));

    expect(icon.hidden).toBe(true);
  });

  it('comes back when the row is reused for something that has art', () => {
    const bar = createBar(document, { icon: '/ui/skills/mage/no_such_art.webp' });
    const icon = part(bar, '.woc-bar-icon') as HTMLImageElement;
    icon.dispatchEvent(new Event('error'));

    bar.update({ icon: '/ui/skills/mage/fireball.webp' });

    expect(icon.hidden).toBe(false);
  });

  it('hides the slot again for an explicit null', () => {
    const bar = createBar(document, { icon: '/ui/skills/mage/fireball.webp' });

    bar.update({ icon: null });

    expect((part(bar, '.woc-bar-icon') as HTMLImageElement).hidden).toBe(true);
  });

  // An alt repeating the label would have a screen reader read every row twice.
  it('is marked decorative, because the label is the accessible name', () => {
    const bar = createBar(document, { label: 'Fireball', icon: '/x.webp' });
    const icon = part(bar, '.woc-bar-icon');

    expect(icon.getAttribute('alt')).toBe('');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('the banner', () => {
  it('shows a warning in its own slot', () => {
    const b = banner();

    b.instance.show('Deathless Rage incoming');

    expect(b.slot()?.textContent).toContain('Deathless Rage incoming');
  });

  it('carries a second line when given one', () => {
    const b = banner();

    b.instance.show('Soul Rend', { detail: 'on Marshal' });

    expect(document.querySelector('.woc-banner-detail')?.textContent).toBe('on Marshal');
  });

  // Assertive, unlike the toast stack: a warning that expires in two seconds has to interrupt.
  it('announces itself assertively', () => {
    const b = banner();
    b.instance.show('Move');

    expect(b.slot()?.getAttribute('role')).toBe('alert');
  });

  it('defaults to the warn kind, which is what a banner is nearly always for', () => {
    const b = banner();

    b.instance.show('Move');

    expect(document.querySelector('.woc-banner-card')?.classList).toContain('woc-banner-warn');
  });

  // Size is an enum that carries the weight too: the game's display face has no lowercase and
  // loads only 400 to 700, so size and weight are not independent axes.
  it('defaults to the normal size, which is already sized to be read in a fight', () => {
    const b = banner();

    b.instance.show('Soul Rend');

    expect(document.querySelector('.woc-banner-card')?.classList).toContain('woc-banner-normal');
  });

  it('takes the loud step when asked for it', () => {
    const b = banner();

    b.instance.show('Deathless Rage', { size: 'large' });

    expect(document.querySelector('.woc-banner-card')?.classList).toContain('woc-banner-large');
  });

  it.each([
    ['size', { size: 'huge' as 'large' }, 'woc-banner-normal'],
    ['kind', { kind: 'critical' as 'danger' }, 'woc-banner-warn'],
  ])('falls back for a %s the sheet does not draw', (_axis, opts, expected) => {
    const b = banner();

    b.instance.show('Move', opts);

    expect(document.querySelector('.woc-banner-card')?.classList).toContain(expected);
  });

  // One slot for the whole loader: stacking would cover the fight the warning is about.
  it('replaces rather than stacks', () => {
    const b = banner();

    b.instance.show('First');
    b.instance.show('Second');

    expect(b.cards()).toHaveLength(1);
    expect(b.slot()?.textContent).toContain('Second');
  });

  it("drops the replaced banner's timer with it", () => {
    const b = banner();

    b.instance.show('First', { timeout: 2000 });
    b.instance.show('Second', { timeout: 2000 });

    expect(b.armed()).toBe(1);
  });

  // A replaced banner's timer must not take down the newer warning.
  it('does not let a stale dismiss take the current banner down', () => {
    const b = banner();
    const dismissFirst = b.instance.show('First', { timeout: 0 });
    b.instance.show('Second', { timeout: 0 });

    dismissFirst();

    expect(b.slot()?.textContent).toContain('Second');
  });

  it('clears itself when its timer elapses', () => {
    const b = banner();
    b.instance.show('Move', { timeout: 2000 });

    b.elapse();

    expect(b.cards()).toHaveLength(0);
  });

  it('stays up for a zero timeout until something takes it away', () => {
    const b = banner();
    b.instance.show('Phase two', { timeout: 0 });

    b.elapse();

    expect(b.cards()).toHaveLength(1);
  });

  it('is dismissable by hand', () => {
    const b = banner();
    const dismiss = b.instance.show('Move', { timeout: 0 });

    dismiss();

    expect(b.cards()).toHaveLength(0);
  });

  it('takes its slot with it on dispose', () => {
    const b = banner();
    b.instance.show('Move');

    b.instance.dispose();

    expect(b.slot()).toBeNull();
  });

  it('rebuilds the slot after a dispose rather than throwing', () => {
    const b = banner();
    b.instance.show('First');
    b.instance.dispose();

    expect(() => b.instance.show('Again')).not.toThrow();
    expect(b.slot()?.textContent).toContain('Again');
  });

  // A mechanic name reaches this straight off the wire.
  it('never treats its text as markup', () => {
    const b = banner();

    b.instance.show('<img src=x onerror="alert(1)">');

    expect(b.slot()?.querySelector('img')).toBeNull();
  });
});

describe('the banner and toasts together', () => {
  // They share a z-index band and cannot collide: toasts pin to the top edge, the banner centres.
  it('keeps its own element rather than sharing the toast stack', () => {
    const b = banner();
    b.instance.show('Move');

    expect(document.getElementById('woc-toasts')).toBeNull();
    expect(document.getElementById(BANNER_ID)).not.toBeNull();
  });
});

// The height a caller decided, which the sheet turns into a row, its text and its art.
describe('the size', () => {
  it("is the addon's when it asked for one", () => {
    const bar = createBar(document, { size: 28 });

    expect(bar.el.style.getPropertyValue('--woc-bar-size')).toBe('28');
    expect(bar.el.classList.contains('woc-bar-sized')).toBe(true);
  });

  // Unitless, because the sheet derives the text from it as an em and calc cannot divide a
  // length by a length.
  it('is written as a plain number rather than a length', () => {
    expect(createBar(document, { size: 40 }).el.style.getPropertyValue('--woc-bar-size')).toBe(
      '40',
    );
  });

  // A NaN drops the declaration silently, so a bad size leaves the row sized by its line box.
  it.each([
    ['zero', 0],
    ['NaN', Number.NaN],
    ['a string', '40'],
  ])('leaves a row sized by its content for %s', (_label, bad) => {
    const bar = createBar(document, { size: bad as number });

    expect(bar.el.style.getPropertyValue('--woc-bar-size')).toBe('');
    expect(bar.el.classList.contains('woc-bar-sized')).toBe(false);
  });

  // A scaling column resizes on every drag move, and rebuilding would discard decoded art.
  it('moves on an update, so a column can scale without being rebuilt', () => {
    const bar = createBar(document, { size: 23 });

    bar.update({ size: 46 });

    expect(bar.el.style.getPropertyValue('--woc-bar-size')).toBe('46');
  });

  it('holds the size it has when an update says nothing about it', () => {
    const bar = createBar(document, { size: 23 });

    bar.update({ value: '4s' });

    expect(bar.el.style.getPropertyValue('--woc-bar-size')).toBe('23');
  });
});
