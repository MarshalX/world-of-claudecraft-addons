// @vitest-environment happy-dom

// The timer bar and the centre-screen banner.
//
// Both exist because addons had already written them. The bar is the row Cooldown
// Bars and Combat Meter each hand-rolled, and the two had drifted in the ways that
// are easy to get wrong: which part shrinks, whether the figure reserves its width,
// whether a bad fraction is clamped. Those are what this suite pins.
//
// The fraction cases are the ones that come from a real failure mode rather than
// from tidiness. A NaN assigned to a style property drops the declaration SILENTLY,
// so a bar that divides by a total it does not have yet does not throw and does not
// blank: it holds its last width, which reads as a timer that has stopped.
//
// For the banner the claim under test is the replacement rule. There is one slot
// for the whole loader, so the interesting case is the timer of a banner that has
// already been replaced: if it still fired against the slot it would take the NEWER
// warning down, which is the one the player has not read yet.

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

  it('carries an addon"s own class alongside the kit"s', () => {
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

  // The second line is what makes this a shared row rather than a timer-only one:
  // Cooldown Bars uses the head alone, Combat Meter puts its hit count underneath.
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

  // The fill is a sibling of both lines rather than of the head, which is what makes
  // a share read as the whole row's rather than as a bar on the top line of it.
  it('puts the fill behind both lines rather than inside the head', () => {
    const bar = createBar(document, { detail: '12 hits', fraction: 0.5 });

    expect(part(bar, '.woc-bar-fill').parentElement).toBe(bar.el);
    expect(part(bar, '.woc-bar-label').closest('.woc-bar-head')).not.toBeNull();
  });

  // School is a SEPARATE axis from tone, not more values on it: tone is urgency and a
  // school is what kind of damage a row is made of. Which wins where both are set is
  // settled in the sheet by source order, so the module's job is only to record both.
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

  // A heal carries no school, so a caller reading one off an event legitimately has
  // null. It must tint nothing rather than fall back to a school the event never named.
  it.each([
    ['null, which a healing row passes', null],
    ['a school the game does not have', 'chaos' as 'fire'],
  ])('tints nothing for %s', (_label, school) => {
    const bar = createBar(document, { school });

    expect([...bar.el.classList].some((name) => name.startsWith('woc-bar-school-'))).toBe(false);
  });

  // The third axis, for a row that is an ITEM. It takes none of the other two's properties,
  // so a market row can be an epic, made of shadow damage and about to expire at once.
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

  // The fourth axis, for a row that is a PERSON. It takes none of the others' properties
  // either, so a party row can be a priest, about to expire, and made of shadow at once.
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

  // A `templateId` is a class on a player and a mob template everywhere else, so the id an
  // addon holds reaches this field as `boss_wolf` about as often as it does as `mage`.
  it.each([
    ['null, which a caller who checked the kind passes', null],
    ['a mob template, which is what a templateId is off a player', 'boss_wolf' as 'mage'],
  ])('tints nothing for %s', (_label, unitClass) => {
    const bar = createBar(document, { unitClass });

    expect([...bar.el.classList].some((name) => name.startsWith('woc-bar-class-'))).toBe(false);
  });

  // Null is an addon saying it does not know the tier, which is the ordinary state of an
  // item id anywhere on this API, and it must colour nothing rather than guess at one.
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

describe('a bar"s fill fraction', () => {
  // The reason this is clamped rather than passed through. A timer fraction is a
  // division by a total, and an addon reading a cooldown it has not seen start
  // divides by zero: Infinity and NaN both drop the style declaration in silence.
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

// An addon animates a readout from its own frame loop, so `update` runs per row per
// frame and nearly always says what the row already says. Every one of those used to
// write anyway: three textContent assignments, ten classList calls to swap one tone,
// and a style property, each of which dirties style recalc for the loader's subtree.
//
// The COST is invisible to a suite, so what is pinned is the only thing that is
// visible: a repeat must touch nothing at all. The second case is what keeps the
// first from passing vacuously, since an observer that was never wired up correctly
// would report no records for a real change too.
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

// Money is drawn rather than spelled out, which is the one value that is not a
// string, so what these pin is the two things a coin row can get wrong: an empty
// unit drawn anyway, and the discs leaving a screen reader with bare numbers.
describe('a bar"s figure as money', () => {
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

  // A price divided by a count the caller does not have yet is how a NaN reaches a
  // readout, and `NaNg NaNs NaNc` is worse than a zero.
  it('reads an amount that is not a number as nothing', () => {
    const bar = createBar(document, { value: { copper: Number.NaN } });

    expect(coins(bar)).toEqual(['woc-coin woc-coin-copper=0']);
  });

  // The discs carry the units and a disc reads as nothing at all, so a figure left
  // to be read child by child announces "low 7 80".
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

describe('a bar"s icon', () => {
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

  // Not every ability ships painted art, so a URL that does not resolve is an
  // ordinary outcome. Collapsing the slot is better than a broken-image glyph.
  it('hides itself when the art does not exist', () => {
    const bar = createBar(document, { icon: '/ui/skills/mage/no_such_art.webp' });
    const icon = part(bar, '.woc-bar-icon') as HTMLImageElement;

    icon.dispatchEvent(new Event('error'));

    expect(icon.hidden).toBe(true);
  });

  // A list of rows is reused as its contents change, so a row whose icon failed
  // once has to get its slot back when it is pointed at art that does exist.
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

  // The label beside it already names the ability. An alt repeating that would
  // have a screen reader read every row in the frame twice.
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

  // Assertive, unlike the toast stack, and the difference is the point: a warning
  // whose whole value expires in two seconds has to interrupt.
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

  // Size is an enum carrying the weight and both lines with it, because the game's
  // display face has no lowercase and only loads 400 to 700: a huge light setting of
  // it reads worse than a medium heavy one, so the axes are not independent.
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

  // Unlike frame density, where the fallback exists to stop a typo dropping the
  // tap-target floor, both banner sizes are loud, so landing on either is safe.
  it.each([
    ['size', { size: 'huge' as 'large' }, 'woc-banner-normal'],
    ['kind', { kind: 'critical' as 'danger' }, 'woc-banner-warn'],
  ])('falls back for a %s the sheet does not draw', (_axis, opts, expected) => {
    const b = banner();

    b.instance.show('Move', opts);

    expect(document.querySelector('.woc-banner-card')?.classList).toContain(expected);
  });

  // One slot for the whole loader. Stacking these would cover the fight the
  // warning is about, and two at once is the moment that matters most.
  it('replaces rather than stacks', () => {
    const b = banner();

    b.instance.show('First');
    b.instance.show('Second');

    expect(b.cards()).toHaveLength(1);
    expect(b.slot()?.textContent).toContain('Second');
  });

  it('drops the replaced banner"s timer with it', () => {
    const b = banner();

    b.instance.show('First', { timeout: 2000 });
    b.instance.show('Second', { timeout: 2000 });

    expect(b.armed()).toBe(1);
  });

  // The case a naive implementation gets wrong. The first banner's dismiss must
  // not reach the slot once a second one is up, or the newer warning is taken
  // down by a timer belonging to a message nobody is looking at any more.
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

  // A banner arrives unasked for, over the middle of the world. Text, never
  // markup: a mechanic name reaches this straight off the wire.
  it('never treats its text as markup', () => {
    const b = banner();

    b.instance.show('<img src=x onerror="alert(1)">');

    expect(b.slot()?.querySelector('img')).toBeNull();
  });
});

describe('the banner and toasts together', () => {
  // Both are transient overlays and neither is a window, so they share a z-index
  // band. They cannot collide, because the toast stack is pinned to the top edge
  // and the banner sits in the middle of the view.
  it('keeps its own element rather than sharing the toast stack', () => {
    const b = banner();
    b.instance.show('Move');

    expect(document.getElementById('woc-toasts')).toBeNull();
    expect(document.getElementById(BANNER_ID)).not.toBeNull();
  });
});
