// Everything the loader puts inside the game's own HUD, behind one watcher.
//
// The loader's manager routes and every addon's `ui.microButton` and
// `ui.menuEntry` land here, for two reasons. The HUD does not exist until world
// entry and can in principle be replaced, so each of them needs the same
// waiting and re-attaching, which is a MutationObserver each if they each own
// one. And an addon enabled while the player is already in the world has to
// attach immediately rather than wait for a HUD mount that already happened.
//
// Registration order is the attach order, so the loader's own button stays
// first on the rail and addon buttons follow in the order they were added.

import type { Teardown } from '../../disposal.ts';
import { mountMenuEntry } from '../esc-inject.ts';
import { type HudWaitDeps, whenHudMounts } from '../hud-mount.ts';
import { type MicroButtonDeps, mountMicroButton } from '../micro-button.ts';

type InjectionKind = 'menu' | 'micro';

interface InjectionSpec {
  kind: InjectionKind;
  /** Unique across every injection, and the element id in the game's DOM. */
  id: string;
  label: string;
  onOpen: () => void;
  /** Inline SVG, for a micro button that wants its own glyph. */
  glyph?: string;
}

interface Mounted {
  dispose: () => void;
}

interface GameInjector {
  /** Register an injection. Attaches now if the HUD is up, and on every remount. */
  add: (spec: InjectionSpec) => Teardown;
  attached: () => boolean;
  dispose: () => void;
}

interface InjectorDeps {
  doc: Document;
  /** Called once per HUD attach, before the injections go in. */
  onHud?: () => void;
  /** Whether the game HUD is in the document, on every change. See hud-mount.ts. */
  onPresence?: (present: boolean) => void;
}

function mountOne(doc: Document, spec: InjectionSpec): Mounted {
  if (spec.kind === 'menu') {
    return mountMenuEntry({ doc, id: spec.id, label: spec.label, onOpen: spec.onOpen });
  }
  // Assigned rather than spread, so an absent glyph never reaches the property
  // at all: exactOptionalPropertyTypes rejects an explicit undefined there, and
  // the button falls back to the loader's own glyph.
  const button: MicroButtonDeps = { doc, id: spec.id, label: spec.label, onOpen: spec.onOpen };
  if (spec.glyph !== undefined) {
    button.glyph = spec.glyph;
  }
  return mountMicroButton(button);
}

function createGameInjector(deps: InjectorDeps): GameInjector {
  // Insertion-ordered, which a Map preserves, so the rail keeps its order.
  const specs = new Map<string, InjectionSpec>();
  const mounted = new Map<string, Mounted>();

  const detachOne = (id: string): void => {
    mounted.get(id)?.dispose();
    mounted.delete(id);
  };

  const hudDeps: HudWaitDeps = {
    doc: deps.doc,
    attach: () => {
      deps.onHud?.();
      for (const [id, spec] of specs) {
        mounted.set(id, mountOne(deps.doc, spec));
      }
    },
    detach: () => {
      for (const id of [...mounted.keys()]) {
        detachOne(id);
      }
    },
  };
  // Assigned rather than spread for the same reason `glyph` is above:
  // exactOptionalPropertyTypes rejects an explicit undefined on an optional.
  if (deps.onPresence !== undefined) {
    hudDeps.onPresence = deps.onPresence;
  }
  const hud = whenHudMounts(hudDeps);

  return {
    add: (spec) => {
      if (specs.has(spec.id)) {
        throw new Error(`a game injection with id '${spec.id}' is already registered`);
      }
      specs.set(spec.id, spec);
      // The HUD may already be up, in which case there is no mount event coming
      // and this is the only chance to attach.
      if (hud.attached()) {
        mounted.set(spec.id, mountOne(deps.doc, spec));
      }
      return () => {
        specs.delete(spec.id);
        detachOne(spec.id);
      };
    },

    attached: hud.attached,

    dispose: () => {
      hud.cancel();
      for (const id of [...mounted.keys()]) {
        detachOne(id);
      }
      specs.clear();
    },
  };
}

export type { GameInjector, InjectionKind, InjectionSpec, InjectorDeps };
export { createGameInjector };
