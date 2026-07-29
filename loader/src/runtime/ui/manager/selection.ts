// Which addon's own page is showing, and whether its stores are ready.
//
// Its own module rather than component state for the same reason store.ts and
// geometry-store.ts are: the page cannot render until the addon's settings and
// keybind stores have hydrated, so the selection has to survive a repaint driven
// from outside the tree. A player who opened an addon must not be sent back to
// the list because another tab changed a setting.
//
// The hydration round trip is re-checked when it lands. A player can go back, or
// open a different addon, while storage is still answering for the first one,
// and the late answer must not redraw the page they left.

import type { InstalledAddon } from '../../../shared/protocol.ts';
import type { AddonConfig, ConfigService } from './config.ts';

interface Selected {
  fqid: string;
  /** Null until the addon's stores have hydrated. */
  config: AddonConfig | null;
}

interface SelectionDeps {
  /** Null when the bridge never connected, which makes every page unopenable. */
  config: ConfigService | null;
  /** Resolve an fqid against the installed rows the manager currently holds. */
  find: (fqid: string) => InstalledAddon | null;
  repaint: () => void;
}

interface AddonSelection {
  /** The addon whose page is open, or null for the list. */
  addon: () => InstalledAddon | null;
  /** Its stores, or null both for the list and while they hydrate. */
  config: () => AddonConfig | null;
  open: (fqid: string) => void;
  close: () => void;
}

function createSelection(deps: SelectionDeps): AddonSelection {
  let selected: Selected | null = null;

  const openAddon = (fqid: string): void => {
    const addon = deps.find(fqid);
    const service = deps.config;
    if (addon === null || service === null) {
      return;
    }
    // Painted with whatever is already cached, so reopening an addon is instant
    // and only a first open shows the loading line.
    selected = { fqid, config: service.peek(fqid) };
    deps.repaint();

    service
      .open(addon)
      .then((ready) => {
        if (selected?.fqid === fqid) {
          selected = { fqid, config: ready };
          deps.repaint();
        }
      })
      .catch(() => undefined);
  };

  return {
    addon: () => {
      if (selected === null) {
        return null;
      }
      return deps.find(selected.fqid);
    },
    config: () => selected?.config ?? null,
    open: openAddon,
    close: () => {
      selected = null;
      deps.repaint();
    },
  };
}

export type { AddonSelection, SelectionDeps };
export { createSelection };
