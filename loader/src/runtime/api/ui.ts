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
import type { AddonFrame, FrameOpts } from '../ui/kit/frame.ts';
import { createAddonFrame } from '../ui/kit/frame.ts';
import type { FrameStateStore } from '../ui/kit/frame-state.ts';
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

function createUi(deps: UiDeps): UiApi {
  const { kit, fqid, bag } = deps;

  const makeFrame = (opts: FrameOpts, chrome: 'frame' | 'window'): AddonFrame => {
    const frame = createAddonFrame({
      doc: deps.doc,
      root: kit.root,
      fqid,
      chrome,
      opts,
      store: storeFor(deps, opts),
      viewport: deps.viewport,
      window: deps.window,
    });
    bag.add(() => {
      frame.destroy();
    });
    return frame;
  };

  return {
    frame: (opts) => makeFrame(opts, 'frame'),
    window: (opts) => makeFrame(opts, 'window'),

    toast: (text, opts) => tracked(bag, kit.toaster.show(text, opts)),

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
