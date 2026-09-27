// @vitest-environment happy-dom

// One tooltip element serves every attachment and is refilled on hover, so these cases are
// about that element's lifetime and each attachment's.

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
  // The watched root and the drawing band are one host here; they differ in ui/root.ts.
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

  // The game's own tooltips answer the mouse only; the kit deliberately does better.
  it('shows on focus too', () => {
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

  it('creates nothing until something is hovered', () => {
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

// `pointerleave` never fires on an element removed under the pointer, so the kit, never the
// addon, clears the tooltip and releases the attachment.
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

  // A list that rebuilds rows attaches once per row per rebuild. The sweep runs on the next
  // attach rather than from an always-on observer, so this drives a rebuild.
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

  it('releases it immediately while a tooltip is on screen', async () => {
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

  // An addon attaches before appending, so reaping anything disconnected would kill those.
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

  // An attachment is not reapable until a sweep saw it connected, and none runs here, so the
  // observer also checks the shown anchor directly.
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

// The structured form extends the string one; `ui.tooltip(el, 'text')` must keep working, since
// a published surface changing shape moves the API major.
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

  it('draws a bare string as one line', () => {
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

  it('falls back to the default tone for an unknown one', () => {
    const tip = open({ lines: [{ text: 'nine', tone: 'chartreuse' as 'warn' }] });

    expect(tip.querySelector('.woc-tip-line')?.className).toBe('woc-tip-line woc-tip-default');
  });

  // Ability and player names come off the wire, so nothing may be parsed as markup.
  it('writes content as text, never as markup', () => {
    const tip = open({ title: '<img src=x onerror=alert(1)>', lines: ['<b>bold</b>'] });

    expect(tip.querySelector('img')).toBeNull();
    expect(tip.querySelector('b')).toBeNull();
    expect(tip.textContent).toContain('<b>bold</b>');
  });

  // Not every ability ships art, so a missing file collapses the slot like a bar's icon.
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

  // The element is shared, so nothing from the previous anchor may survive.
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

// Re-appending an element moves it: the browser drops hover state and fires no leave. A list
// re-appends its rows every frame to keep order, so the kit watches pointer moves instead.
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

  it('hides when the pointer moves off a re-appended anchor', () => {
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

  // The move may be over game DOM, whose controls stop propagation.
  it('hides for a move over the game that stops propagating', () => {
    setup();
    const gameEl = document.createElement('div');
    document.body.appendChild(gameEl);
    gameEl.addEventListener('pointermove', (event) => {
      event.stopPropagation();
    });

    gameEl.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));

    expect(shown()).toBe(false);
  });

  // The listener costs a contains() per pointer move, so it must not outlive the tooltip.
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
