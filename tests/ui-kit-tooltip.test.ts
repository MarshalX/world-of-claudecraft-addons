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

import { afterEach, describe, expect, it } from 'vitest';
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
  function open() {
    return createTooltips({ doc: document, root: root(), viewport: () => VIEW });
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
    const tips = createTooltips({ doc: document, root: host, viewport: () => VIEW });
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
