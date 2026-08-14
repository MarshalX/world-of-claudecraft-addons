// What the two timer readouts share: the variant vocabulary, the fill arithmetic,
// the decorative art element, and the rule that a write changing nothing does not
// reach the DOM.
//
// `kit/bar.ts` and `kit/tile.ts` are the same information in two shapes, a row and
// a square, and they have to agree about three things. The school list is the one
// that matters: it is a claim about the game's own palette, and a second copy of it
// in the other module would be a second claim, free to drift from the first while
// both still looked right on their own.
//
// The class PREFIX is a parameter rather than the class names being written out
// here, because each surface tints a different part of itself (a bar's fill, a
// tile's border) and so needs its own rules in its own sheet. What is shared is
// which variants exist and that setting one SWAPS rather than accumulates.
//
// THE SLOTS ARE THE OTHER SHARED THING, and they exist for a measured reason. An
// addon animates a readout from its own frame loop, which is the pattern this project
// documents and Cooldown Bars is written to, so `update` runs per row per frame and
// nearly always says what the row already says. Every one of those used to write
// anyway: eight rows at 60 Hz is about 480 updates a second, each dirtying style
// recalc for the loader's subtree, and swapping one tone ran ten `classList` calls
// and allocated two arrays to do it. A slot holds what it last wrote, so a repeat
// costs a string comparison and touches nothing.
//
// That is the rule `kit/anchor3d.ts` already states for a position, reached the same
// way, and it belongs HERE rather than in each addon for the reason the kit rests on:
// an addon is one file, and everything the kit does not carry comes out of it.

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
 * The same, for a slot that hides itself while it has nothing to say.
 *
 * Hidden rather than emptied, so a cleared slot cannot take a shadow or a background
 * with it, and so the spacing it was holding goes with it.
 *
 * `hidden` is written only when the emptiness FLIPS, not whenever the text moves. A
 * countdown changes its figure on every frame and is non-empty throughout, so writing
 * the flag beside it would put a second attribute mutation on the element for a value
 * that has not changed since the slot was built.
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
 * The art slot, which is decorative in both shapes.
 *
 * No alt text: a bar's label already names the ability beside it, and a tile carries
 * its name on the element as a whole, so an alt here would have a screen reader read
 * every readout twice.
 *
 * Not every ability ships painted art, so a URL that does not resolve is an ordinary
 * outcome rather than a fault. Hiding the slot collapses the layout around it instead
 * of leaving a broken-image glyph where the icon would be. It starts hidden because
 * no art is the state every builder hands it over in.
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
 * Point the slot at a URL, or at nothing.
 *
 * Re-shown when the URL CHANGES rather than on every call, which is what a row
 * reused for another ability does. A repeat of a URL that already failed stays
 * hidden: it fails the same way twice, and re-setting it from a frame loop would be
 * a request per frame for a file the game does not ship.
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
