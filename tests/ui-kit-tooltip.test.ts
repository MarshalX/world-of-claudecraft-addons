// @vitest-environment happy-dom

// Tooltips: the third shared kit surface, split out from ui-kit-overlays.test.ts
// because attachment lifetime is a topic of its own rather than a variation on
// how a toast or a modal goes away.
//
// One element serves every attachment and is refilled on hover, so the cases
// that matter are the ones about that element's lifetime: it is not built until
// something is hovered, a detached anchor stops reaching it, and dispose takes
// it away along with every listener. The alternative, a node per attachment,
// means a hundred hidden divs for a hundred rows in an addon's list.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTooltips, TOOLTIP_ID } from '../loader/src/runtime/ui/kit/tooltip.ts';

const VIEW = { w: 1280, h: 800 };

function root(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'woc-addons';
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('tooltips', () => {
  // The watcher's scope and the band the tip is drawn in are the same element
  // here. They differ in the loader (ui/root.ts), and nothing in this suite is
  // about that difference: every case is about the hover, so one host keeps the
  // cases readable rather than hiding a decision they could get wrong.
  function open() {
    const host = root();
    return createTooltips({ doc: document, root: host, layer: host, viewport: () => VIEW });
  }

  function anchor(): HTMLElement {
    const el = document.createElement('button');
    document.body.appendChild(el);
    return el;
  }

  it('shows on hover and hides on leave', () => {
    const el = anchor();
    open().attach(el, 'Toggle the meter');

    el.dispatchEvent(new Event('pointerenter'));
    expect(document.getElementById(TOOLTIP_ID)?.textContent).toBe('Toggle the meter');
    expect(document.getElementById(TOOLTIP_ID)?.hidden).toBe(false);

    el.dispatchEvent(new Event('pointerleave'));
    expect(document.getElementById(TOOLTIP_ID)?.hidden).toBe(true);
  });

  // The game's own tooltips answer the mouse only. Shipping that gap to every
  // addon is the one place the kit is deliberately better than what it matches.
  it('shows on focus too, so a keyboard reaches it', () => {
    const el = anchor();
    open().attach(el, 'Toggle the meter');

    el.dispatchEvent(new Event('focusin'));

    expect(document.getElementById(TOOLTIP_ID)?.hidden).toBe(false);
  });

  it('reuses one element across every attachment', () => {
    const tips = open();
    const first = anchor();
    const second = anchor();
    tips.attach(first, 'one');
    tips.attach(second, 'two');

    first.dispatchEvent(new Event('pointerenter'));
    second.dispatchEvent(new Event('pointerenter'));

    expect(document.querySelectorAll(`#${TOOLTIP_ID}`)).toHaveLength(1);
    expect(document.getElementById(TOOLTIP_ID)?.textContent).toBe('two');
  });

  it('creates nothing until something is actually hovered', () => {
    open().attach(anchor(), 'one');

    expect(document.getElementById(TOOLTIP_ID)).toBeNull();
  });

  it('stops answering once detached', () => {
    const el = anchor();
    const detach = open().attach(el, 'one');

    detach();
    el.dispatchEvent(new Event('pointerenter'));

    expect(document.getElementById(TOOLTIP_ID)?.hidden ?? true).toBe(true);
  });

  it('detaches everything and removes the element on dispose', () => {
    const tips = open();
    const el = anchor();
    tips.attach(el, 'one');
    el.dispatchEvent(new Event('pointerenter'));

    tips.dispose();
    el.dispatchEvent(new Event('pointerenter'));

    expect(document.getElementById(TOOLTIP_ID)).toBeNull();
  });
});

// An anchor that leaves the document while it has a tooltip.
//
// Reported from a live session: cooldown-bars drops a row the moment its cooldown
// ends, and a tooltip for a finished ability floated in the middle of the frame
// indefinitely. `pointerleave` never fires on an element removed while the pointer
// is over it, and the pointer had not moved, so nothing could clear it.
//
// Both halves are the KIT's, never the addon's. An API where every author has to
// pair an attach with a detach on a lifecycle the loader owns is an API whose
// leaks belong to whoever forgot.
describe('an anchor that leaves the document', () => {
  /** MutationObserver callbacks are microtasks, so a tick settles them. */
  async function settle(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
  }

  function setup() {
    const host = root();
    const tips = createTooltips({ doc: document, root: host, layer: host, viewport: () => VIEW });
    return { host, tips };
  }

  /** A row inside the loader's root, which is where addon DOM actually lives. */
  function row(host: HTMLElement): HTMLElement {
    const el = document.createElement('div');
    host.appendChild(el);
    return el;
  }

  function tip(): HTMLElement | null {
    return document.getElementById(TOOLTIP_ID);
  }

  it('hides the tooltip when the hovered anchor is removed', async () => {
    const { host, tips } = setup();
    const el = row(host);
    tips.attach(el, 'Arcane Shot');
    el.dispatchEvent(new Event('pointerenter'));
    expect(tip()?.hidden).toBe(false);

    el.remove();
    await settle();

    expect(tip()?.hidden).toBe(true);
  });

  // The attachment goes too, not just the tooltip. A list that rebuilds rows
  // attaches once per row per rebuild, and every one of those would otherwise sit
  // in the addon's disposal bag until the addon was disabled.
  //
  // The sweep runs on the next attach, which is the moment a rebuild is
  // definitely happening, and inside the removal observer while a tooltip is up.
  // Not continuously: an always-on observer would be a standing cost against a
  // set that only grows when rows are created. So the rebuild is what this drives.
  it('releases the attachment on the next attach, leaving the old row inert', () => {
    const { host, tips } = setup();
    const gone = row(host);
    tips.attach(gone, 'Arcane Shot');
    gone.remove();

    // The rebuild: one row went, another arrives.
    tips.attach(row(host), 'Cold Focus');
    host.appendChild(gone);
    gone.dispatchEvent(new Event('pointerenter'));

    expect(tip()?.hidden).not.toBe(false);
  });

  // While a tooltip IS up the observer is running, so the release is immediate
  // rather than waiting for a rebuild that may never come.
  it('releases it immediately when a tooltip is on screen', async () => {
    const { host, tips } = setup();
    const shown = row(host);
    const gone = row(host);
    tips.attach(shown, 'Cold Focus');
    tips.attach(gone, 'Arcane Shot');
    shown.dispatchEvent(new Event('pointerenter'));

    gone.remove();
    await settle();
    host.appendChild(gone);
    gone.dispatchEvent(new Event('pointerenter'));

    // Still the first row's text: the removed row's listener is gone.
    expect(tip()?.textContent).toBe('Cold Focus');
  });

  // The subtle one. An addon builds a row by creating it, describing it, and THEN
  // appending it, so an attachment is legitimately disconnected at birth. Reaping
  // anything disconnected would kill exactly those.
  it('keeps an attachment made before the element was inserted', () => {
    const { host, tips } = setup();
    const pending = document.createElement('div');
    tips.attach(pending, 'Cold Focus');

    // A second attach is what sweeps, and it must not take the first one with it.
    tips.attach(row(host), 'Arcane Shot');
    host.appendChild(pending);
    tips.attach(row(host), 'Volley');
    pending.dispatchEvent(new Event('pointerenter'));

    expect(tip()?.textContent).toBe('Cold Focus');
  });

  // The narrow case the reap alone does NOT cover, which is why the observer also
  // checks the shown anchor directly. An attachment made before its element was
  // inserted is not reapable until a sweep has seen it connected, and no sweep
  // happens between the insert and the hover here. Without the direct check the
  // tooltip would stay on screen exactly as reported.
  it('hides even when the anchor was never swept while connected', async () => {
    const { host, tips } = setup();
    const pending = document.createElement('div');
    tips.attach(pending, 'Cold Focus');
    host.appendChild(pending);
    pending.dispatchEvent(new Event('pointerenter'));
    expect(tip()?.hidden).toBe(false);

    pending.remove();
    await settle();

    expect(tip()?.hidden).toBe(true);
  });

  // Detaching one row while a DIFFERENT row's tooltip is up must leave it alone.
  it(`does not blank another anchor's tooltip`, () => {
    const { host, tips } = setup();
    const first = row(host);
    const second = row(host);
    const detachFirst = tips.attach(first, 'Arcane Shot');
    tips.attach(second, 'Cold Focus');
    second.dispatchEvent(new Event('pointerenter'));

    detachFirst();

    expect(tip()?.hidden).toBe(false);
    expect(tip()?.textContent).toBe('Cold Focus');
  });

  // The observer exists only while a tooltip is visible, so nothing is watching
  // once it is hidden. This is the case that would spin if it were always on.
  it('stops watching once the tooltip is hidden', async () => {
    const { host, tips } = setup();
    const el = row(host);
    tips.attach(el, 'Arcane Shot');
    el.dispatchEvent(new Event('pointerenter'));
    el.dispatchEvent(new Event('pointerleave'));

    row(host);
    await settle();

    expect(tip()?.hidden).toBe(true);
  });
});

// The structured form, which the plain string one grew into rather than away
// from: `ui.tooltip(el, 'text')` is the same call it always was, because a
// published surface changing shape is what moves the API major.
describe('what a tooltip says', () => {
  function open(content: Parameters<ReturnType<typeof createTooltips>['attach']>[1]) {
    const host = root();
    const tips = createTooltips({ doc: document, root: host, layer: host, viewport: () => VIEW });
    const anchor = document.createElement('div');
    host.appendChild(anchor);
    tips.attach(anchor, content);
    anchor.dispatchEvent(new Event('pointerenter'));
    return document.getElementById(TOOLTIP_ID) as HTMLElement;
  }

  it('draws a bare string as one line, the way it always did', () => {
    const tip = open('Toggle the meter');

    expect(tip.textContent).toBe('Toggle the meter');
    expect(tip.querySelectorAll('.woc-tip-line')).toHaveLength(1);
  });

  it('draws a title, an icon and a line for each entry', () => {
    const tip = open({
      title: 'Fell Shot',
      icon: '/ui/skills/hunter/arcane_shot.webp',
      lines: ['55 mana', { text: 'Requires a ranged weapon', tone: 'danger' }],
    });

    expect(tip.querySelector('.woc-tip-title')?.textContent).toBe('Fell Shot');
    expect(tip.querySelector('.woc-tip-icon')?.getAttribute('src')).toBe(
      '/ui/skills/hunter/arcane_shot.webp',
    );
    expect(tip.querySelectorAll('.woc-tip-line')).toHaveLength(2);
    expect(tip.querySelector('.woc-tip-danger')?.textContent).toBe('Requires a ranged weapon');
  });

  it('falls back to the default tone rather than inventing a class', () => {
    const tip = open({ lines: [{ text: 'nine', tone: 'chartreuse' as 'warn' }] });

    expect(tip.querySelector('.woc-tip-line')?.className).toBe('woc-tip-line woc-tip-default');
  });

  // An ability name and a player name both reach this from the wire, so the one
  // thing that must never happen is markup being parsed.
  it('writes content as text, never as markup', () => {
    const tip = open({ title: '<img src=x onerror=alert(1)>', lines: ['<b>bold</b>'] });

    expect(tip.querySelector('img')).toBeNull();
    expect(tip.querySelector('b')).toBeNull();
    expect(tip.textContent).toContain('<b>bold</b>');
  });

  // The same slot a bar has: not every ability ships painted art, so a URL that
  // does not resolve has to collapse rather than leave a broken-image glyph.
  it('hides an icon whose art does not exist', () => {
    const tip = open({ title: 'Tame Beast', icon: '/ui/skills/hunter/tame_beast.webp' });
    const icon = tip.querySelector<HTMLImageElement>('.woc-tip-icon');

    icon?.dispatchEvent(new Event('error'));

    expect(icon?.hidden).toBe(true);
  });

  it('draws no head at all when there is neither title nor icon', () => {
    const tip = open({ lines: ['just a line'] });

    expect(tip.querySelector('.woc-tip-head')).toBeNull();
  });

  // The element is shared, so what the last anchor said must not survive into
  // the next one: a row with no title after a row with one would keep the title.
  it('replaces what the previous anchor put there', () => {
    const host = root();
    const tips = createTooltips({ doc: document, root: host, layer: host, viewport: () => VIEW });
    const first = document.createElement('div');
    const second = document.createElement('div');
    host.append(first, second);
    tips.attach(first, { title: 'Fell Shot', lines: ['55 mana'] });
    tips.attach(second, 'Toggle the meter');

    first.dispatchEvent(new Event('pointerenter'));
    second.dispatchEvent(new Event('pointerenter'));

    const tip = document.getElementById(TOOLTIP_ID) as HTMLElement;
    expect(tip.querySelector('.woc-tip-title')).toBeNull();
    expect(tip.textContent).toBe('Toggle the meter');
  });
});

// The second stuck tooltip reported from a live session, both times from Cooldown
// Bars, and this one with the anchor still on screen.
//
// Re-appending an element that is already in the DOM MOVES it, which is a removal
// and an insertion. The browser drops the hover state on the removal and fires no
// leave, so nothing the kit was listening for was ever coming again. The list
// re-appends its rows every animation frame to keep them in order, which made this
// near-certain within a frame or two of showing a tooltip.
describe('an anchor the browser has stopped considering hovered', () => {
  function shown(): boolean {
    const tip = document.getElementById(TOOLTIP_ID);
    return tip !== null && !tip.hidden;
  }

  function setup() {
    const host = root();
    const tips = createTooltips({ doc: document, root: host, layer: host, viewport: () => VIEW });
    const list = document.createElement('div');
    const anchor = document.createElement('div');
    const elsewhere = document.createElement('div');
    list.append(anchor, elsewhere);
    host.appendChild(list);
    tips.attach(anchor, 'Fell Shot');
    anchor.dispatchEvent(new Event('pointerenter'));
    return { list, anchor, elsewhere };
  }

  it('goes away when the pointer moves off it, even after it was re-appended', () => {
    const { list, anchor, elsewhere } = setup();
    expect(shown()).toBe(true);

    // What a list that keeps its rows in order does on every frame.
    list.appendChild(anchor);
    elsewhere.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));

    expect(shown()).toBe(false);
  });

  it('stays up while the pointer is still inside the anchor', () => {
    const { anchor } = setup();
    const child = document.createElement('span');
    anchor.appendChild(child);

    child.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));

    expect(shown()).toBe(true);
  });

  // The move that matters may be over the game's own DOM rather than over
  // anything the loader owns, and the game's controls stop propagation.
  it('goes away for a move over the game, and one that stops propagating', () => {
    setup();
    const gameEl = document.createElement('div');
    document.body.appendChild(gameEl);
    gameEl.addEventListener('pointermove', (event) => {
      event.stopPropagation();
    });

    gameEl.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));

    expect(shown()).toBe(false);
  });

  // The listener costs a contains() per pointer move, so it must not outlive the
  // tooltip that needed it.
  it('stops listening once nothing is shown', () => {
    const { anchor, elsewhere } = setup();
    anchor.dispatchEvent(new Event('pointerleave'));
    const after = new PointerEvent('pointermove', { bubbles: true });
    const stopped = vi.spyOn(after, 'stopPropagation');

    elsewhere.dispatchEvent(after);

    expect(stopped).not.toHaveBeenCalled();
    expect(shown()).toBe(false);
  });
});
