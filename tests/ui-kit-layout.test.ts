// @vitest-environment happy-dom

// The layout vocabulary.
//
// This pins the half that lives in JavaScript: which class an element is built
// with, which parent it lands in, and what `show` writes. It cannot read the sheet,
// since every `.css` import resolves to '' under Vitest, so `flex-shrink`, the gap
// and the tap-target floor are checked by running the loader on the stage. Do not
// widen that: reading the file needs node:fs, which is not exempt here.
//
// Three cases carry the design. That a class is written at all, that `gap` goes
// through a custom property rather than `el.style.gap` where no rule could reach
// it, and that hiding sets the class AND the attribute, since the class alone
// leaves the element in the accessibility tree and the attribute alone is a UA rule
// the loader's unlayered sheet beats outright.

import { beforeEach, describe, expect, it } from 'vitest';
import { createColumn, createLine, createRow, show } from '../loader/src/runtime/ui/kit/layout.ts';

let doc: Document;

beforeEach(() => {
  doc = document.implementation.createHTMLDocument('layout');
});

describe('ui.column', () => {
  it('is a div carrying the kit class and nothing else', () => {
    const el = createColumn(doc);

    expect(el.tagName).toBe('DIV');
    expect(el.className).toBe('woc-layout-column');
    expect(el.getAttribute('style')).toBe(null);
  });

  it('appends into the parent it was given, in call order', () => {
    const parent = doc.createElement('div');

    const first = createColumn(doc, { parent });
    const second = createColumn(doc, { parent });

    expect([...parent.children]).toStrictEqual([first, second]);
  });

  it('leaves an element unattached when no parent was given', () => {
    expect(createColumn(doc).parentElement).toBe(null);
  });

  it("adds the addon's own class after the kit's", () => {
    const el = createColumn(doc, { className: 'woc-satchel-pane' });

    expect(el.className).toBe('woc-layout-column woc-satchel-pane');
    expect(el.classList.contains('woc-layout-column')).toBe(true);
  });

  it('writes a gap as a custom property, never as the gap property', () => {
    const el = createColumn(doc, { gap: 12 });

    expect(el.style.getPropertyValue('--woc-gap')).toBe('12px');
    expect(el.style.gap).toBe('');
  });

  it('writes no style at all when no gap was asked for', () => {
    expect(createColumn(doc, { parent: doc.createElement('div') }).getAttribute('style')).toBe(
      null,
    );
  });
});

describe('ui.row', () => {
  it('carries the kit class and an alignment of center by default', () => {
    const el = createRow(doc);

    expect(el.classList.contains('woc-layout-row')).toBe(true);
    expect(el.classList.contains('woc-layout-row-center')).toBe(true);
    expect(el.classList.contains('woc-layout-row-wrap')).toBe(false);
  });

  it('names the alignment it was asked for', () => {
    const el = createRow(doc, { align: 'baseline' });

    expect(el.classList.contains('woc-layout-row-baseline')).toBe(true);
    expect(el.classList.contains('woc-layout-row-center')).toBe(false);
  });

  it('wraps only when asked', () => {
    expect(createRow(doc, { wrap: true }).classList.contains('woc-layout-row-wrap')).toBe(true);
    expect(createRow(doc, { wrap: false }).classList.contains('woc-layout-row-wrap')).toBe(false);
  });

  // Two SEPARATE custom properties, and neither written as a style property, which
  // is what keeps the declaration in the loader's sheet. Whether the pair renders as
  // `gap: 2px 10px` is a stage question.
  it('writes the wrap gap as a second custom property', () => {
    const el = createRow(doc, { wrap: true, gap: 10, wrapGap: 2 });

    expect(el.style.getPropertyValue('--woc-gap')).toBe('10px');
    expect(el.style.getPropertyValue('--woc-wrap-gap')).toBe('2px');
    expect(el.style.gap).toBe('');
    expect(el.style.rowGap).toBe('');
  });

  // The sheet defaults the wrap gap to the gap, so a row naming one number must not
  // carry a second property freezing the other axis.
  it('writes no wrap gap when none was asked for', () => {
    const el = createRow(doc, { gap: 10 });

    expect(el.style.getPropertyValue('--woc-wrap-gap')).toBe('');
  });

  it('takes the same parent, class and gap a column does', () => {
    const parent = doc.createElement('div');

    const el = createRow(doc, { parent, className: 'woc-ledgerline-strip', gap: 10 });

    expect(el.parentElement).toBe(parent);
    expect(el.classList.contains('woc-ledgerline-strip')).toBe(true);
    expect(el.style.getPropertyValue('--woc-gap')).toBe('10px');
  });
});

describe('ui.line', () => {
  it('is plain by default', () => {
    const el = createLine(doc);

    expect(el.className).toBe('woc-layout-line');
  });

  it('names the muted tone, and only that one', () => {
    expect(createLine(doc, { tone: 'muted' }).classList.contains('woc-layout-line-muted')).toBe(
      true,
    );
    expect(createLine(doc, { tone: 'default' }).classList.contains('woc-layout-line-muted')).toBe(
      false,
    );
  });

  it('appends into its parent', () => {
    const parent = doc.createElement('div');

    expect(createLine(doc, { parent }).parentElement).toBe(parent);
  });
});

describe('ui.show', () => {
  it('hides with both the class and the attribute', () => {
    const el = createRow(doc);

    show(el, false);

    expect(el.classList.contains('woc-hidden')).toBe(true);
    expect(el.hasAttribute('hidden')).toBe(true);
    expect(el.hidden).toBe(true);
  });

  it('puts both back on the way in', () => {
    const el = createRow(doc);

    show(el, false);
    show(el, true);

    expect(el.classList.contains('woc-hidden')).toBe(false);
    expect(el.hasAttribute('hidden')).toBe(false);
  });

  // A shown element carries no display of its own, which is what makes the class
  // approach need no memory of what it was displaying before.
  it('writes no inline display in either direction', () => {
    const el = createColumn(doc);

    show(el, false);
    show(el, true);

    expect(el.style.display).toBe('');
    expect(el.getAttribute('style')).toBe(null);
  });

  it('reaches an element the loader did not build', () => {
    const el = doc.createElement('span');

    show(el, false);

    expect(el.classList.contains('woc-hidden')).toBe(true);
    expect(el.hasAttribute('hidden')).toBe(true);
  });

  it('is idempotent, so a paint loop calling it every frame changes nothing', () => {
    const el = createRow(doc);

    show(el, false);
    show(el, false);

    expect(el.className).toBe('woc-layout-row woc-layout-row-center woc-hidden');
  });
});
