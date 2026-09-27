// The one place a host event turns into a runtime action. The registry is the DESIRED set, so the
// resync hangs off `registry.changed`, not off the control that wrote it: that is how an install
// or another tab's write starts an addon.

import type { HostEvent } from '../shared/protocol.ts';

/** What one host event can reach. */
interface EventTargets {
  /** The manager window: re-read its stores, or redraw, or open it. */
  manager: {
    open: () => void;
    invalidate: () => void;
    repaint: () => void;
  };
  /** Bring the running set back in step with the registry. */
  resync: () => void;
  /** Re-evaluate one addon whose source changed at its origin. */
  reload: (fqid: string) => void;
  /** Hand a cross-tab storage write to the addons watching that key. */
  deliverStorage: (ns: string, key: string, value: unknown) => void;
}

function createHostEventHandler(targets: EventTargets): (event: HostEvent) => void {
  return (event) => {
    if (event.k === 'ui.open') {
      targets.manager.open();
    } else if (event.k === 'registry.changed') {
      targets.manager.invalidate();
      targets.resync();
    } else if (event.k === 'addon.reload') {
      targets.reload(event.fqid);
    } else if (event.k === 'market.changed' || event.k === 'dev.changed') {
      targets.manager.repaint();
    } else if (event.k === 'storage.changed') {
      targets.deliverStorage(event.ns, event.key, event.value);
    }
  };
}

export type { EventTargets };
export { createHostEventHandler };
