// A flex box down, a flex box across, a sentence, and a way to take one off screen.
//
// EVERYTHING HERE WRITES A CLASS: an inline style would outrank the sheet, the touch
// tap-target floor included. Even `gap` goes through a custom property (ui/styles/layout.css).

import { HIDDEN_CLASS } from './frame-visibility.ts';

/** `woc-layout-` and not the bare words: `.woc-row` is the manager's own row in panes.css. */
const COLUMN_CLASS = 'woc-layout-column';
const ROW_CLASS = 'woc-layout-row';
const LINE_CLASS = 'woc-layout-line';
const WRAP_CLASS = 'woc-layout-row-wrap';
const MUTED_CLASS = 'woc-layout-line-muted';

/**
 * An input to the `gap` declaration in layout.css, re-declared per element there so it does not
 * inherit.
 */
const GAP_PROPERTY = '--woc-gap';

/** The down axis. Defaults to `--woc-gap` in the sheet, so one number still does both. */
const WRAP_GAP_PROPERTY = '--woc-wrap-gap';

/** Where a row's items sit against each other. `center` unless asked. */
type RowAlign = 'baseline' | 'center' | 'end' | 'start';

/** `muted` is the smaller, dimmer note every panel puts under its figures. */
type LineTone = 'default' | 'muted';

/** Published flat on each of the three, since an author reads one. */
interface BoxOpts {
  /** Appended here when given. */
  parent?: Element;
  /** Added alongside the kit's own class, so your own CSS still reaches it. */
  className?: string;
}

interface StackOpts extends BoxOpts {
  /** Pixels. Defaults to the spacing of the density the element is drawn in. */
  gap?: number;
}

interface RowOpts extends StackOpts {
  /** Wrap onto more lines. Default false. */
  wrap?: boolean;
  align?: RowAlign;
  /** Pixels between WRAPPED LINES. Defaults to `gap`, and means nothing without `wrap`. */
  wrapGap?: number;
}

interface LineOpts extends BoxOpts {
  tone?: LineTone;
}

/** The kit's class first, so an addon's own is the one that reads as an addition. */
function classes(own: string, extra: string | undefined): string {
  if (extra === undefined) {
    return own;
  }
  return `${own} ${extra}`;
}

function build(doc: Document, own: string, opts: BoxOpts): HTMLElement {
  const el = doc.createElement('div');
  el.className = classes(own, opts.className);
  opts.parent?.appendChild(el);
  return el;
}

function spaced(el: HTMLElement, property: string, gap: number | undefined): void {
  if (gap === undefined) {
    return;
  }
  el.style.setProperty(property, `${String(gap)}px`);
}

/** A flex column: the shape of a pane, and of most of what is inside one. */
function createColumn(doc: Document, opts: StackOpts = {}): HTMLElement {
  const el = build(doc, COLUMN_CLASS, opts);
  spaced(el, GAP_PROPERTY, opts.gap);
  return el;
}

/** A flex row: a strip of chips, figures or controls. */
function createRow(doc: Document, opts: RowOpts = {}): HTMLElement {
  const el = build(doc, ROW_CLASS, opts);
  spaced(el, GAP_PROPERTY, opts.gap);
  spaced(el, WRAP_GAP_PROPERTY, opts.wrapGap);
  el.classList.add(`${ROW_CLASS}-${opts.align ?? 'center'}`);
  if (opts.wrap === true) {
    el.classList.add(WRAP_CLASS);
  }
  return el;
}

/** A sentence the panel says on its own line. */
function createLine(doc: Document, opts: LineOpts = {}): HTMLElement {
  const el = build(doc, LINE_CLASS, opts);
  if (opts.tone === 'muted') {
    el.classList.add(MUTED_CLASS);
  }
  return el;
}

/**
 * The attribute takes it out of the accessibility tree; the `!important` class takes it off
 * screen, since the user-agent `[hidden]` rule loses to this unlayered sheet and inline styles.
 */
function show(el: Element, shown: boolean): void {
  el.classList.toggle(HIDDEN_CLASS, !shown);
  el.toggleAttribute('hidden', !shown);
}

export type { BoxOpts, LineOpts, LineTone, RowAlign, RowOpts, StackOpts };
export { createColumn, createLine, createRow, show };
