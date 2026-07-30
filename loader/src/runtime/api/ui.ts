// The woc.ui surface handed to addons. Mirrors packages/types/ui.d.ts.
//
// A thin per-addon binding over the ONE kit built in ui/mount.ts: one toast
// stack, one tooltip element, one HUD watcher. What is per-addon is the
// disposal bag, so everything an addon creates here is released when it is
// disabled, and the fqid, which namespaces the ids it puts in the game's DOM.
//
// Every addon element lands under #woc-addons, a sibling of the game's #ui, so a
// HUD re-render cannot take it away. The two surfaces that go INSIDE game DOM,
// micro buttons and menu entries, are the exception by definition and are
// re-attached by the shared watcher rather than by the addon.

import type { DisposalBag, Teardown } from '../disposal.ts';
import type { AlertOpts } from '../ui/kit/alert.ts';
import { openAlert } from '../ui/kit/alert.ts';
import type { BannerOpts } from '../ui/kit/banner.ts';
import type { Bar, BarOpts } from '../ui/kit/bar.ts';
import { createBar } from '../ui/kit/bar.ts';
import type { AddonFrame } from '../ui/kit/frame.ts';
import { createAddonFrame } from '../ui/kit/frame.ts';
import type { FrameOpts } from '../ui/kit/frame-chrome.ts';
import type { FrameStateStore } from '../ui/kit/frame-state.ts';
import type { IconUrls } from '../ui/kit/icons.ts';
import type { InjectionSpec } from '../ui/kit/injections.ts';
import type { ToastOpts } from '../ui/kit/toast.ts';
import type { UiKit } from '../ui/mount.ts';

interface MicroButtonOpts {
  id: string;
  label: string;
  onClick: () => void;
  /** Inline SVG markup. Defaults to the loader's own glyph. */
  glyph?: string;
}

interface MenuEntryOpts {
  id: string;
  label: string;
  onClick: () => void;
}

interface UiApi {
  /** A light, content-sized HUD frame: movable, no close button. */
  frame: (opts: FrameOpts) => AddonFrame;
  /** A panel window: movable, resizable, with a title bar and close button. */
  window: (opts: FrameOpts) => AddonFrame;
  toast: (text: string, opts?: ToastOpts) => Teardown;
  /** A centre-screen warning. One slot for the whole loader; a new one replaces it. */
  banner: (text: string, opts?: BannerOpts) => Teardown;
  /** A timer row: icon, label, fill, and a right-aligned figure. */
  bar: (opts?: BarOpts) => Bar;
  /** Where the game's own art lives, so no addon writes a path. */
  icon: IconUrls;
  /** Resolves with the id of the button pressed, or null if dismissed. */
  alert: (opts: AlertOpts) => Promise<string | null>;
  /** A button on the game's own rail. Lands when the HUD does. */
  microButton: (opts: MicroButtonOpts) => Teardown;
  /** An entry in the game menu, below the loader's own "Addons". */
  menuEntry: (opts: MenuEntryOpts) => Teardown;
  tooltip: (el: Element, text: string) => Teardown;
}

interface UiDeps {
  doc: Document;
  kit: UiKit;
  fqid: string;
  bag: DisposalBag;
  /** Null when the addon's storage is unreachable; frames then never persist. */
  frameStore: FrameStateStore | null;
  viewport: () => { w: number; h: number };
  window: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
}

/**
 * Namespace an id the addon chose before it goes into the game's own DOM.
 *
 * Two addons may both call a button 'toggle', and the game's document is one id
 * space shared with the game itself. Prefixing is what stops the second addon's
 * button silently replacing the first's.
 */
function elementId(fqid: string, kind: string, id: string): string {
  return `woc-addon-${kind}-${fqid.replace(/[^a-zA-Z0-9-]/g, '-')}-${id}`;
}

/** Register a teardown so an explicit call also unregisters it from the bag. */
function tracked(bag: DisposalBag, teardown: Teardown): Teardown {
  const drop = bag.add(teardown);
  return () => {
    drop();
    teardown();
  };
}

/** A frame only reaches the store when the addon asked for persistence. */
function storeFor(deps: UiDeps, opts: FrameOpts): FrameStateStore | null {
  if (opts.save === true) {
    return deps.frameStore;
  }
  return null;
}

/**
 * Assigned rather than spread, so an absent glyph never reaches the property at
 * all: exactOptionalPropertyTypes rejects an explicit undefined there, and the
 * button falls back to the loader's own glyph.
 */
function microSpec(fqid: string, opts: MicroButtonOpts): InjectionSpec {
  const spec: InjectionSpec = {
    kind: 'micro',
    id: elementId(fqid, 'micro', opts.id),
    label: opts.label,
    onOpen: opts.onClick,
  };
  if (opts.glyph !== undefined) {
    spec.glyph = opts.glyph;
  }
  return spec;
}

function addonFrame(deps: UiDeps, opts: FrameOpts, chrome: 'frame' | 'window'): AddonFrame {
  const frame = createAddonFrame({
    doc: deps.doc,
    root: deps.kit.root,
    fqid: deps.fqid,
    chrome,
    opts,
    store: storeFor(deps, opts),
    viewport: deps.viewport,
    window: deps.window,
    raise: deps.kit.stacking.raise,
  });
  deps.bag.add(() => {
    frame.destroy();
  });
  return frame;
}

/**
 * A bar whose removal is in the bag.
 *
 * The bag holds the removal rather than only a listener: a bar is DOM the addon
 * appended somewhere of its own, and disable is hot with no page reload, so a row
 * left behind would sit in a frame the loader has already taken down, with nothing
 * left running to update it.
 */
function addonBar(deps: UiDeps, opts: BarOpts | undefined): Bar {
  const bar = createBar(deps.doc, opts);
  deps.bag.add(bar.destroy);
  return bar;
}

function createUi(deps: UiDeps): UiApi {
  const { kit, fqid, bag } = deps;

  return {
    frame: (opts) => addonFrame(deps, opts, 'frame'),
    window: (opts) => addonFrame(deps, opts, 'window'),

    toast: (text, opts) => tracked(bag, kit.toaster.show(text, opts)),

    banner: (text, opts) => tracked(bag, kit.banner.show(text, opts)),

    bar: (opts) => addonBar(deps, opts),

    icon: kit.icons,

    alert: (opts) => {
      const modal = openAlert({ doc: deps.doc, root: kit.root }, opts);
      // The bag closes it if the addon is disabled mid-question, which resolves
      // the promise rather than leaving the addon's await hanging.
      const drop = bag.add(modal.close);
      return modal.answer.finally(drop);
    },

    microButton: (opts) => tracked(bag, kit.injector.add(microSpec(fqid, opts))),

    menuEntry: (opts) =>
      tracked(
        bag,
        kit.injector.add({
          kind: 'menu',
          id: elementId(fqid, 'menu', opts.id),
          label: opts.label,
          onOpen: opts.onClick,
        }),
      ),

    tooltip: (el, text) => tracked(bag, kit.tooltips.attach(el, text)),
  };
}

export type { MenuEntryOpts, MicroButtonOpts, UiApi, UiDeps };
export { createUi, elementId };
