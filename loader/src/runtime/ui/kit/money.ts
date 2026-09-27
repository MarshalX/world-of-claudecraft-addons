// Copper, drawn the way the game draws it.
//
// The game counts money in copper and shows it as coin PARTS: a disc per unit followed by its
// figure, empty units left out, so 780 reads as a silver disc, 7, a copper disc, 80.
//
// THE DISCS ARE OURS, WITH THE GAME'S COLOURS. Do not wear the game's `.coin.g`: the loader
// would then depend on `g`, `s` and `c` as game classes, which `tools/kit-classes.ts` and
// `pnpm theme` would pick up. `styles/kit.css` names where the gradients came from.
//
// IT IS ANNOUNCED AS ONE IMAGE, like `tile-name.ts`, with the units spelled out in words,
// since the discs read as nothing and the figure alone reads as "low 7 80".

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
  /** A word before the coins, e.g. `low` or `asking`, part of the figure and of its spoken form. */
  prefix?: string;
}

/** One unit's share of an amount. */
interface MoneyPart {
  unit: (typeof UNITS)[number];
  amount: number;
}

/**
 * The units an amount is made of, empty ones left out. Copper survives zero, so a free item
 * reads `0c`. A non-finite amount (a NaN from dividing by a missing count) reads as zero.
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
 * What the slot holds, as a string that changes exactly when the drawing would, so a per-frame
 * `update` rebuilds nothing. It carries a space, so it never collides with a `writeText` memo.
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
 * A readout's figure, whichever of the two forms it was given in. Writing text takes back the
 * image role money set, or a reused row would still be announced as the old amount.
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
