// Copper, drawn the way the game draws it.
//
// The game counts money in copper and shows it as coin PARTS: a small disc per unit
// followed by its figure, empty units left out entirely, so 780 reads as a silver
// disc, 7, a copper disc, 80. Four addons already print money and every one of them
// wrote its own `${gold}g ${silver}s ${copper}c`, which is the same arithmetic four
// times and a readout that looks like nothing else on screen.
//
// It lives in the kit for the reason the kit exists at all: an addon is one file,
// and everything the kit does not carry comes out of it. It sits beside `readout.ts`
// rather than inside it because money is a subject of its own, unrelated to the tone
// and school vocabulary that file is about.
//
// THE DISCS ARE OURS, WITH THE GAME'S COLOURS, which is the opposite of what a frame
// does with `panel`. A frame WEARS the game's class so it inherits a border, a
// background and a shadow it would otherwise keep a drifting copy of. A coin is three
// gradients, and the game files them under a bare `.coin` with single-letter
// modifiers (`.coin.g`), so wearing them would have the loader declaring `g`, `s` and
// `c` as game classes it depends on: `tools/kit-classes.ts` reads what the kit wears
// and `pnpm theme` copies the rules for every one of them. `styles/kit.css` names
// where the three gradients came from.
//
// IT IS ANNOUNCED AS ONE IMAGE, the way `tile-name.ts` announces a tile, and for the
// same reason: the discs carry the units and a disc reads as nothing at all, so a
// figure left to be read child by child says "low 7 80". The spoken form spells the
// units out in words rather than repeating the `7s 80c` a sighted reader gets, since
// a screen reader saying "seven ess" is not what the row means.

import { type TextSlot, writeText } from './readout.ts';

const COPPER_PER_SILVER = 100;
const SILVER_PER_GOLD = 100;

/** The three units, biggest first: how much one is worth, and how it is said. */
const UNITS = Object.freeze([
  {
    className: 'woc-coin-gold',
    suffix: 'g',
    spoken: 'gold',
    per: COPPER_PER_SILVER * SILVER_PER_GOLD,
  },
  { className: 'woc-coin-silver', suffix: 's', spoken: 'silver', per: COPPER_PER_SILVER },
  { className: 'woc-coin-copper', suffix: 'c', spoken: 'copper', per: 1 },
]);

const COPPER_UNIT = UNITS[2] as (typeof UNITS)[number];

/** A figure in copper, with an optional word in front of it. */
interface MoneyValue {
  /** Copper, which is what every amount the game sends is counted in. */
  copper: number;
  /**
   * A word before the coins, e.g. `low` or `asking`.
   *
   * Part of the figure rather than of the caller's own label, because it belongs
   * where the number is: a bare amount at the end of a row reads as the price, and a
   * row whose figure is the cheapest ever seen rather than today's has to say so.
   */
  prefix?: string;
}

/** One unit's share of an amount. */
interface MoneyPart {
  unit: (typeof UNITS)[number];
  amount: number;
}

/**
 * The units an amount is made of, empty ones left out.
 *
 * Copper survives an amount of nothing, so a free item reads as `0c` rather than as
 * an empty row. Anything that is not a finite number is nothing rather than a guess:
 * a price divided by a count the caller does not have yet is exactly how a NaN gets
 * this far, and `NaNg NaNs NaNc` is worse than a zero.
 */
function wholeCopper(copper: number): number {
  if (!Number.isFinite(copper)) {
    return 0;
  }
  return Math.max(0, Math.round(copper));
}

function moneyParts(copper: number): MoneyPart[] {
  const whole = wholeCopper(copper);
  const parts: MoneyPart[] = [];
  let left = whole;
  for (const unit of UNITS) {
    const amount = Math.floor(left / unit.per);
    left -= amount * unit.per;
    if (amount > 0) {
      parts.push({ unit, amount });
    }
  }
  if (parts.length === 0) {
    parts.push({ unit: COPPER_UNIT, amount: 0 });
  }
  return parts;
}

/** `7s 80c`, for a tooltip line or anywhere else that takes text. */
function moneyText(copper: number): string {
  return moneyParts(copper)
    .map((part) => `${String(part.amount)}${part.unit.suffix}`)
    .join(' ');
}

/** The same figure in words, which is what the discs are standing in for. */
function spokenMoney(value: MoneyValue): string {
  const said = moneyParts(value.copper)
    .map((part) => `${String(part.amount)} ${part.unit.spoken}`)
    .join(', ');
  if (value.prefix === undefined || value.prefix === '') {
    return said;
  }
  return `${value.prefix} ${said}`;
}

/** One unit: its disc, then its figure. */
function buildPart(doc: Document, part: MoneyPart): HTMLElement {
  const el = doc.createElement('span');
  el.className = 'woc-coin-part';
  const coin = doc.createElement('span');
  coin.className = `woc-coin ${part.unit.className}`;
  const figure = doc.createElement('span');
  figure.textContent = String(part.amount);
  el.append(coin, figure);
  return el;
}

/**
 * What the slot holds, as a string that changes exactly when the drawing would.
 *
 * The memo `writeText` keeps, and it matters more here: an addon animating a readout
 * from its own frame loop calls `update` per row per frame, and rebuilding five
 * elements each time to draw the figure that is already there is the allocation the
 * slots exist to avoid. It carries a space, which no class name does, so a money
 * signature can never collide with a string somebody wrote through `writeText`.
 */
function moneySignature(value: MoneyValue): string {
  return `money ${value.prefix ?? ''} ${String(value.copper)}`;
}

function drawParts(doc: Document, value: MoneyValue): HTMLElement[] {
  const drawn: HTMLElement[] = [];
  if (value.prefix !== undefined && value.prefix !== '') {
    const word = doc.createElement('span');
    word.className = 'woc-coin-prefix';
    word.textContent = value.prefix;
    drawn.push(word);
  }
  for (const part of moneyParts(value.copper)) {
    drawn.push(buildPart(doc, part));
  }
  return drawn;
}

/** Draw an amount into a slot, announced as one image. */
function writeMoney(slot: TextSlot, value: MoneyValue): boolean {
  const signature = moneySignature(value);
  if (slot.written === signature) {
    return false;
  }
  slot.written = signature;
  slot.el.setAttribute('role', 'img');
  slot.el.setAttribute('aria-label', spokenMoney(value));
  slot.el.replaceChildren(...drawParts(slot.el.ownerDocument, value));
  return true;
}

/** Whether what an addon passed is an amount of money rather than a string. */
function isMoney(value: unknown): value is MoneyValue {
  return typeof value === 'object' && value !== null && 'copper' in value;
}

/**
 * A readout's figure, whichever of the two forms it was given in.
 *
 * The two share one slot, so writing text has to take back what money put on the
 * element: a row reused for a plain countdown would otherwise still be announced as
 * the amount it used to hold, which is the kind of stale label nobody ever sees.
 */
function writeValue(slot: TextSlot, value: string | MoneyValue): boolean {
  if (isMoney(value)) {
    return writeMoney(slot, value);
  }
  if (!writeText(slot, value)) {
    return false;
  }
  slot.el.removeAttribute('role');
  slot.el.removeAttribute('aria-label');
  return true;
}

export type { MoneyValue };
export { isMoney, moneyParts, moneyText, spokenMoney, writeMoney, writeValue };
