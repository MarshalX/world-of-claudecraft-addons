// The two woc.ui surfaces that land INSIDE the game's own DOM.
//
// Everything else an addon builds goes under #woc-addons, a sibling of the game's
// #ui, so a HUD re-render cannot take it away. These two are the exception by
// definition: a button on the game's rail and an entry in the game's menu are
// only those things if they are in the game's markup. They are re-attached by the
// shared watcher rather than by the addon, and they are the pair that has to
// namespace an id, because that document is one id space shared with the game and
// with every other addon.

import type { Teardown } from '../disposal.ts';
import type { InjectionSpec } from '../ui/kit/injections.ts';
import type { UiApi, UiDeps } from './ui.ts';

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

/**
 * Both, tracked: an explicit removal also drops the bag's hold on it.
 *
 * The tracking matters more here than anywhere else in the kit, because these are
 * the only two elements an addon leaves in someone else's subtree. One left
 * behind is a button in the game's rail that opens nothing.
 */
function injectionSurface(
  deps: UiDeps,
  tracked: (off: Teardown) => Teardown,
): Pick<UiApi, 'menuEntry' | 'microButton'> {
  const { kit, fqid } = deps;

  return {
    microButton: (opts) => tracked(kit.injector.add(microSpec(fqid, opts))),

    menuEntry: (opts) =>
      tracked(
        kit.injector.add({
          kind: 'menu',
          id: elementId(fqid, 'menu', opts.id),
          label: opts.label,
          onOpen: opts.onClick,
        }),
      ),
  };
}

export type { MenuEntryOpts, MicroButtonOpts };
export { elementId, injectionSurface };
