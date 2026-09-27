// Several scenarios of one addon, side by side, as one picture, for an addon whose
// layout is a setting.
//
// EACH PANEL IS ITS OWN IFRAME. Mounting one addon twice in one document gives two
// `#woc-addons` elements, two registrations of one keybind, and one fqid shared by
// two storage namespaces and bus identities. Same-origin panes can be measured
// directly, and each reaches its own `data-stage="ready"`.
//
// Captions are drawn in this page, which links the game's faces; compositing them
// later would render through librsvg without Cinzel.

import type { Scenario } from './stage.ts';

const SHEET_ID = 'stage-sheet';

/** The dataset key `main.ts` writes a pane's readiness to. */
const STAGE_KEY = 'stage';

/** Generous so no frame is clamped to the viewport; the pane is cropped afterwards. */
const PANE_VIEWPORT = { w: 1200, h: 900 };

/**
 * Room for the panel's `0 2px 16px` shadow, in CSS pixels. Keep in step with
 * `tools/shots-core.ts` and the caption rule in stage/stage.css.
 */
const PANE_MARGIN = 24;

/** How often to look at a pane that has not finished yet. */
const READY_POLL_MS = 40;

interface SheetDeps {
  doc: Document;
  addon: string;
  /** In the order they are drawn, left to right. */
  panels: readonly Scenario[];
}

/** A rectangle in one pane's own coordinates. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * What a pane is cropped around: frames, world anchors (all some addons draw) and the
 * loader-owned banner slot. A hidden anchor has an empty rect and is filtered out.
 */
const DRAWN = '#woc-addons .woc-addon-frame, #woc-addons .woc-anchor3d';
const BANNER = '#woc-addons .woc-banner-card';

/**
 * How far a banner's scrim reaches past its card. A pseudo-element has no DOM rect, so this
 * transcribes `inset: -70% -20%` from `ui/styles/banner.css`: keep the two in step, or the
 * crop cuts the fade into a hard band.
 */
const SCRIM_REACH = { x: 0.2, y: 0.7 };

function boxOf(rect: DOMRect): Rect {
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}

/** A banner card's box, grown to hold the scrim painted behind it. */
function withScrim(rect: DOMRect): Rect {
  return {
    x: rect.left - rect.width * SCRIM_REACH.x,
    y: rect.top - rect.height * SCRIM_REACH.y,
    w: rect.width * (1 + SCRIM_REACH.x * 2),
    h: rect.height * (1 + SCRIM_REACH.y * 2),
  };
}

function boxesIn(doc: Document, selector: string, grow: (rect: DOMRect) => Rect): Rect[] {
  return [...doc.querySelectorAll(selector)]
    .map((el) => el.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map(grow);
}

/** The union of everything one pane drew, since an addon may show several frames. */
function drawnIn(doc: Document): Rect {
  const rects = [...boxesIn(doc, DRAWN, boxOf), ...boxesIn(doc, BANNER, withScrim)];
  if (rects.length === 0) {
    throw new Error('a sheet pane drew nothing: no frame, no anchor and no banner');
  }
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.w));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.h));
  return {
    x: Math.max(0, left - PANE_MARGIN),
    y: Math.max(0, top - PANE_MARGIN),
    w: right - left + PANE_MARGIN * 2,
    h: bottom - top + PANE_MARGIN * 2,
  };
}

/**
 * One pane's readiness. A computed key, because Biome wants `dataset.stage` and TypeScript
 * forbids dotting into an index signature.
 *
 * The `?.` on `documentElement` is load-bearing: an iframe mid-navigation has a document
 * with no root yet, and a throw here stops the poll and hangs the sheet with no cause.
 */
function stageState(doc: Document | null): string | undefined {
  return doc?.documentElement?.dataset[STAGE_KEY];
}

/** Resolve once one pane has mounted and painted, or reject with its reason. */
function paneReady(frame: HTMLIFrameElement): Promise<Document> {
  return new Promise((resolve, reject) => {
    const look = (): void => {
      // Every read is guarded: a throw here stops the loop and hangs with no report.
      try {
        const doc = frame.contentDocument;
        const state = stageState(doc);
        if (state === 'ready' && doc !== null) {
          resolve(doc);
          return;
        }
        if (state === 'failed') {
          reject(new Error(doc?.getElementById('stage-status')?.textContent ?? 'pane failed'));
          return;
        }
      } catch {
        // A document mid-navigation; look again.
      }
      globalThis.setTimeout(look, READY_POLL_MS);
    };
    look();
  });
}

/**
 * Crop one pane to what it drew by offsetting the iframe inside a window of that size;
 * the inner page is `position: fixed` and cannot be scrolled into place.
 */
function cropPane(view: HTMLElement, frame: HTMLIFrameElement, rect: Rect): void {
  view.style.width = `${String(Math.round(rect.w))}px`;
  view.style.height = `${String(Math.round(rect.h))}px`;
  frame.style.left = `${String(-Math.round(rect.x))}px`;
  frame.style.top = `${String(-Math.round(rect.y))}px`;
}

/** One pane: the addon under one scenario, with its title under it. */
function buildPane(deps: SheetDeps, scenario: Scenario): [HTMLElement, HTMLIFrameElement] {
  const { doc } = deps;
  const figure = doc.createElement('figure');
  figure.className = 'stage-pane';

  const view = doc.createElement('div');
  view.className = 'stage-pane-view';
  const frame = doc.createElement('iframe');
  frame.width = String(PANE_VIEWPORT.w);
  frame.height = String(PANE_VIEWPORT.h);
  frame.src = `/?addon=${deps.addon}&scenario=${scenario.id}&bare=1`;
  view.append(frame);
  figure.append(view);

  if (scenario.caption !== undefined) {
    const caption = doc.createElement('figcaption');
    caption.textContent = scenario.caption;
    figure.append(caption);
  }
  return [figure, frame];
}

/** Draw every panel, loading in parallel, and resolve once all have painted. */
async function buildSheet(deps: SheetDeps): Promise<HTMLElement> {
  const { doc } = deps;
  const sheet = doc.createElement('div');
  sheet.id = SHEET_ID;
  const built = deps.panels.map((scenario) => buildPane(deps, scenario));
  for (const [figure] of built) {
    sheet.append(figure);
  }
  doc.body.append(sheet);

  await Promise.all(
    built.map(async ([figure, frame]) => {
      const paneDoc = await paneReady(frame);
      const view = figure.querySelector('.stage-pane-view');
      cropPane(view as HTMLElement, frame, drawnIn(paneDoc));
    }),
  );
  return sheet;
}

export type { SheetDeps };
export { buildSheet, SHEET_ID };
