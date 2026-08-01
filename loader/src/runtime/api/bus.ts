// The woc.bus surface handed to addons. Mirrors packages/types/bus.d.ts.
//
// A facade over one hub, doing three things the hub cannot do for itself: it
// binds the addon's fqid so `emit` cannot claim to be somebody else, it puts
// every subscription in the addon's disposal bag so disabling one stops its
// handlers without the addon writing cleanup, and it stops a disabled addon
// emitting at all. The last matters because an emit is a synchronous call into
// other addons' code: a stray timer firing after disable would otherwise wake
// handlers on behalf of an addon that is no longer running.
//
// There is no request-response here and there will not be. An addon awaiting a
// reply from an addon that may be disabled, may never have been installed, or
// may simply not answer is a hang with no timeout anybody chose, and the shape
// invites it: `await bus.ask(...)` looks like it cannot fail. Publish and
// subscribe both ways instead.

import type { BusHub, BusMessage } from '../bus/hub.ts';
import { ANY_SENDER } from '../bus/hub.ts';
import type { DisposalBag, Teardown } from '../disposal.ts';

interface BusApi {
  /** Publish to every addon listening for this topic from you. */
  emit: (topic: string, payload?: unknown) => void;
  /**
   * Listen. `from` is the publishing addon's fqid, or `'*'` for any of them.
   *
   * You never receive your own messages, whichever you pass.
   */
  on: (from: string, topic: string, handler: (message: BusMessage) => void) => Teardown;
  /** The value to pass as `from` when any publisher will do. */
  readonly anySender: string;
}

interface BusDeps {
  hub: BusHub;
  fqid: string;
  bag: DisposalBag;
  /** The addon's own logger, for a throw inside its own handler. */
  onError: (where: string, err: unknown) => void;
}

function createBus(deps: BusDeps): BusApi {
  let live = true;
  deps.bag.add(() => {
    live = false;
  });

  return {
    anySender: ANY_SENDER,

    emit: (topic, payload) => {
      if (live) {
        deps.hub.emit(deps.fqid, topic, payload);
      }
    },

    on: (from, topic, handler) => {
      const off = deps.hub.subscribe({
        from,
        topic,
        owner: deps.fqid,
        handler,
        onError: (err) => {
          deps.onError(`the bus handler for '${topic}'`, err);
        },
      });
      // Both the bag and the addon hold it, so an explicit call drops both and
      // disabling the addon drops it whether or not the addon ever called.
      const drop = deps.bag.add(off);
      return () => {
        drop();
        off();
      };
    },
  };
}

export type { BusApi, BusDeps };
export { createBus };
