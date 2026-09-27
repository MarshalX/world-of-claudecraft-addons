// What the two timer readouts share: the variant vocabulary, the fill arithmetic,
// the decorative art element, and the rule that a write changing nothing does not
// reach the DOM.
//
// `kit/bar.ts` (a row) and `kit/tile.ts` (a square) share one school list, so there is one
// claim about the game's palette. The class PREFIX is a parameter, since each surface tints a
// different part of itself; setting a variant SWAPS rather than accumulates.
//
// THE SLOTS: an addon calls `update` per row per frame, nearly always repeating what is on
// screen, so a slot holds what it last wrote and a repeat costs one string comparison.

/** An element whose text is written only when it moved. */
interface TextSlot {
  readonly el: HTMLElement;
  written: string;
}

/** An element property written only when it moved. Custom properties included. */
interface StyleSlot {
  readonly el: HTMLElement;
  readonly property: string;
  written: string;
}

/** The decorative art element, and the URL it was last pointed at. */
interface ArtSlot {
  readonly el: HTMLImageElement;
  written: string | null;
}

/** A fresh slot over an empty element, which is what both builders hand it. */
function textSlot(el: HTMLElement): TextSlot {
  return { el, written: '' };
}

/** Returns whether the DOM was touched, so a derived readout knows to recompose. */
function writeText(slot: TextSlot, text: string): boolean {
  if (slot.written === text) {
    return false;
  }
  slot.written = text;
  // textContent, never innerHTML: an ability name reaches this from the wire.
  slot.el.textContent = text;
  return true;
}

/**
 * The same, for a slot that hides itself while empty, so its spacing goes too. `hidden` is
 * written only when the emptiness FLIPS, not on every text change.
 */
function writeTextHiding(slot: TextSlot, text: string): boolean {
  const wasEmpty = slot.written.length === 0;
  if (!writeText(slot, text)) {
    return false;
  }
  const isEmpty = text.length === 0;
  if (wasEmpty !== isEmpty) {
    slot.el.hidden = isEmpty;
  }
  return true;
}

function styleSlot(el: HTMLElement, property: string): StyleSlot {
  return { el, property, written: '' };
}

function writeStyle(slot: StyleSlot, value: string): void {
  if (slot.written === value) {
    return;
  }
  slot.written = value;
  slot.el.style.setProperty(slot.property, value);
}

/**
 * The art slot, decorative in both shapes: no alt text, since the readout is already named.
 * A URL that does not resolve is ordinary, so the slot hides on error, and it starts hidden.
 */
function buildArt(doc: Document, className: string): ArtSlot {
  const el = doc.createElement('img');
  el.className = className;
  el.alt = '';
  el.hidden = true;
  el.setAttribute('aria-hidden', 'true');
  el.addEventListener('error', () => {
    el.hidden = true;
  });
  return { el, written: null };
}

/**
 * Point the slot at a URL, or at nothing. Re-shown only when the URL CHANGES; a repeated
 * failed URL stays hidden rather than costing a request per frame.
 */
function writeArt(slot: ArtSlot, url: string | null): void {
  if (slot.written === url) {
    return;
  }
  slot.written = url;
  slot.el.hidden = url === null;
  slot.el.src = url ?? '';
}

/** 0 through 1, with anything unusable read as empty rather than as a dropped rule. */
function clampFraction(fraction: unknown): number {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction)) {
    return 0;
  }
  return Math.min(Math.max(fraction, 0), 1);
}

export type { ArtSlot, StyleSlot, TextSlot };
export {
  buildArt,
  clampFraction,
  styleSlot,
  textSlot,
  writeArt,
  writeStyle,
  writeText,
  writeTextHiding,
};
