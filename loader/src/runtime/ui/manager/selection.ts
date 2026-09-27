// Which addon's own page is showing, and whether its stores are ready. Outside the component tree
// so the selection survives a repaint driven from another tab.
//
// A late hydration is dropped if the player has since moved to another page. `refresh` re-checks
// the open page whenever the installed rows land: an addon updated while its page is open would
// otherwise draw the new manifest's controls over the old manifest's stores.

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
  /** Re-check the open page against the rows as they are now. A no-op on the list. */
  refresh: () => void;
  close: () => void;
}

function createSelection(deps: SelectionDeps): AddonSelection {
  let selected: Selected | null = null;

  /** Record where the page is, and repaint only if that moved, so `refresh` is usually free. */
  const settle = (next: Selected): void => {
    if (selected?.fqid === next.fqid && selected.config === next.config) {
      return;
    }
    selected = next;
    deps.repaint();
  };

  const openAddon = (fqid: string): void => {
    const addon = deps.find(fqid);
    const service = deps.config;
    if (addon === null || service === null) {
      return;
    }
    // Paint with the cached stores so a reopen is instant. `peek` refuses a pair the row has
    // outgrown, so an update shows the loading line while its stores rebuild.
    settle({ fqid, config: service.peek(addon) });

    service
      .open(addon)
      .then((ready) => {
        if (selected?.fqid === fqid) {
          settle({ fqid, config: ready });
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
    refresh: () => {
      if (selected !== null) {
        openAddon(selected.fqid);
      }
    },
    close: () => {
      selected = null;
      deps.repaint();
    },
  };
}

export type { AddonSelection, SelectionDeps };
export { createSelection };
