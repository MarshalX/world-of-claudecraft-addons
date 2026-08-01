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
//
// The open page is also re-checked whenever the installed rows land, through
// `refresh`. An addon can be updated while its page is showing, and the page is
// rendered from the ROW read fresh while its stores were built when it opened, so
// without this the form draws the new manifest's controls over the old manifest's
// stores. That is exactly what was reported: a select the pane refused to accept a
// value for, which reinstalling did not clear because nothing about it was stored.

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

  /**
   * Record where the page is, and repaint only if that moved.
   *
   * The guard is what makes `refresh` free in the ordinary case. Every registry
   * change re-checks the open page, and almost every one of them is about another
   * addon entirely, so a re-check that finds the same stores must cost nothing.
   */
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
    // Painted with whatever is already cached, so reopening an addon is instant
    // and only a first open shows the loading line. A cached pair the row has
    // outgrown does not count as cached, which is what puts the line back up for
    // the moment an update's stores take to rebuild.
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
