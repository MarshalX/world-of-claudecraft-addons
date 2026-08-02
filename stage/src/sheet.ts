// Several scenarios of one addon, side by side, as one picture.
//
// An addon that can be configured two ways has two pictures worth taking, and a
// Browse row has space for one. `cooldown-bars` is the case: bars or a strip of
// swept icons is a SETTING, and a preview showing one of them is a preview of
// half the addon.
//
// EACH PANEL IS ITS OWN IFRAME, and that is the whole design rather than a
// detail. Mounting one addon twice in one document breaks three ways at once:
// two elements carrying `#woc-addons`, two registrations of the same keybind
// fighting over it, and one fqid meaning one storage namespace and one bus
// identity. An iframe is a genuinely separate loader instance with none of that,
// and it costs nothing here because the panes are same-origin, so this page can
// measure straight into `contentDocument` and needs no cooperation from them.
//
// It also composes the readiness contract for free: each pane reaches its own
// `data-stage="ready"`, which already means its fonts are loaded and its icons
// decoded, so the sheet is ready when its panes are.
//
// The captions are drawn HERE rather than composited into the PNG afterwards,
// because this page already has the game's own faces linked. Drawing them later
// would mean rendering text through librsvg against whatever fonts happen to be
// installed, and Cinzel is not one of them.

import type { Scenario } from './stage.ts';

const SHEET_ID = 'stage-sheet';

/** The dataset key `main.ts` writes a pane's readiness to. */
const STAGE_KEY = 'stage';

/**
 * The viewport each pane's iframe lays out in.
 *
 * Generous on purpose, and unrelated to the size the pane ends up: an addon frame
 * clamped to fit a small viewport is a picture of the viewport. The pane is then
 * cropped down to what was actually drawn, so nothing of this reaches the shot.
 */
const PANE_VIEWPORT = { w: 1200, h: 900 };

/**
 * Room around a pane's frame, in CSS pixels.
 *
 * The same 24 `tools/shots-core.ts` leaves around a single-panel capture, for the
 * same reason: the panel's shadow is `0 2px 16px` and paints past its own box.
 * Stated in both places because they are two programs; a sheet pane is cropped
 * here, in the browser, and a whole sheet is cropped there.
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
 * Where everything one pane drew sits, together.
 *
 * The union rather than the first frame: an addon may put up more than one frame,
 * and a pane around the first would cut the others out of their own preview.
 *
 * WORLD ANCHORS COUNT AS DRAWING, which is the whole picture for an addon that
 * puts nothing in a frame at all. Facemark is one: its plates are anchors over
 * units, so a crop that looked only for frames would report that a working addon
 * had drawn nothing. A hidden anchor is excluded for free, since the loader hides
 * one by `display: none` and a rect of no size is already filtered out below.
 */
function drawnIn(doc: Document): Rect {
  const rects = [...doc.querySelectorAll('#woc-addons .woc-addon-frame, #woc-addons .woc-anchor3d')]
    .map((el) => el.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0);
  if (rects.length === 0) {
    throw new Error('a sheet pane drew nothing: no frame and no anchor');
  }
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return {
    x: Math.max(0, left - PANE_MARGIN),
    y: Math.max(0, top - PANE_MARGIN),
    w: right - left + PANE_MARGIN * 2,
    h: bottom - top + PANE_MARGIN * 2,
  };
}

/**
 * What one pane's root element says about itself.
 *
 * A helper doing the computed read, which is STYLE.md's resolution for the pair
 * of rules that disagree here: Biome wants `dataset.stage` and TypeScript forbids
 * dotting into an index signature.
 */
function stageState(doc: Document | null): string | undefined {
  return doc?.documentElement.dataset[STAGE_KEY];
}

/** Resolve once one pane has mounted and painted, or reject with its reason. */
function paneReady(frame: HTMLIFrameElement): Promise<Document> {
  return new Promise((resolve, reject) => {
    const look = (): void => {
      const doc = frame.contentDocument;
      const state = stageState(doc);
      if (state === 'ready' && doc !== null) {
        resolve(doc);
      } else if (state === 'failed') {
        reject(new Error(doc?.getElementById('stage-status')?.textContent ?? 'pane failed'));
      } else {
        globalThis.setTimeout(look, READY_POLL_MS);
      }
    };
    look();
  });
}

/**
 * Crop one pane to what it drew.
 *
 * The iframe keeps its full layout viewport and is pushed up and left inside a
 * window sized to the frame, which is the one way to crop an iframe from outside
 * it: the inner page is `position: fixed`, so it cannot be scrolled to the right
 * place instead.
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

  // Only when there is one to draw. A single-panel preview has nothing to
  // distinguish itself from, so a title there would be a label on a picture of
  // the only thing it could be.
  if (scenario.caption !== undefined) {
    const caption = doc.createElement('figcaption');
    caption.textContent = scenario.caption;
    figure.append(caption);
  }
  return [figure, frame];
}

/**
 * Draw every panel and resolve once all of them have.
 *
 * The panes load together rather than one after another: they are independent
 * documents and the slow part is each one's own fetches, so waiting for the
 * first before starting the second would add up for nothing.
 */
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
