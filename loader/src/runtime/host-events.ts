// The one place a host event turns into a runtime action.
//
// Its own module rather than a closure inside boot.ts because it is the seam
// that makes every host-side write visible in the page, and nothing about it
// needs the boot sequence's state: it is a pure mapping from an event to calls
// on four collaborators, which is exactly the shape a Node test can drive.
//
// It carries a load-bearing claim. The registry is the DESIRED set, so every
// write to it is what tells the supervisor to start or stop something, and that
// includes a write made in another tab. This is why the sync hangs off the event
// rather than off the control that caused it, and it is what turns "install
// lands enabled" into "the addon is running": install writes, the host announces
// registry.changed, and the resync here is what starts it.

import type { HostEvent } from '../shared/protocol.ts';

/** What one host event can reach, named by what it does rather than by module. */
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
