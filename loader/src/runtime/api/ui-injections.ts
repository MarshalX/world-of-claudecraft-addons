// The two woc.ui surfaces that land INSIDE the game's DOM: a rail button and a menu entry. The
// shared watcher re-attaches them after a HUD re-render.

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

/** Namespaced, since the document is one id space shared with the game and every addon. */
function elementId(fqid: string, kind: string, id: string): string {
  return `woc-addon-${kind}-${fqid.replace(/[^a-zA-Z0-9-]/g, '-')}-${id}`;
}

/** Assigned, not spread: exactOptionalPropertyTypes rejects an explicit undefined glyph. */
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

/** Tracked: a leftover is a button in the game's own rail that opens nothing. */
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
