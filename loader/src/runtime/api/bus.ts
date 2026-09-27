// The woc.bus surface, mirroring packages/types/bus.d.ts. Binds the fqid, bags every subscription,
// and silences a disabled addon's emits, which are synchronous calls into other addons.
//
// No request-response, ever: awaiting a reply from an addon that may not answer is a hang with no
// timeout. `follow` asks once and `publish` announces once, so start order does not matter.

import type { BusHub, BusMessage } from '../bus/hub.ts';
import { ANY_SENDER } from '../bus/hub.ts';
import type { DisposalBag, Teardown } from '../disposal.ts';

interface Publication {
  /** Emit now, because what you publish has changed. */
  announce: () => void;
  /** Stop answering. Called for you when your addon is disabled. */
  stop: Teardown;
}

interface BusApi {
  /** Publish to every addon listening for this topic from you. */
  emit: (topic: string, payload?: unknown) => void;
  /** `from` is the publisher's fqid, or `'*'`. You never receive your own messages. */
  on: (from: string, topic: string, handler: (message: BusMessage) => void) => Teardown;
  /**
   * Answer `<topic>:ask` from any sender with `produce()`, and announce when
   * your own value moves. `produce` runs once per ask and once at publish, so it
   * may be called before the addon has finished starting and may return null.
   */
  publish: (topic: string, produce: () => unknown) => Publication;
  /** Subscribe to `topic` from any sender, and ask once for a publisher already running. */
  follow: (topic: string, handler: (payload: unknown, from: string) => void) => Teardown;
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

/** Derived, since topic names are content the loader does not own. */
function askTopic(topic: string): string {
  return `${topic}:ask`;
}

function createPattern(emit: BusApi['emit'], on: BusApi['on']): Pick<BusApi, 'publish' | 'follow'> {
  const publish = (topic: string, produce: () => unknown): Publication => {
    const answer = (): void => {
      emit(topic, produce());
    };
    // Any sender: a hardcoded fqid is right only on the official marketplace.
    const stop = on(ANY_SENDER, askTopic(topic), answer);
    // Subscribed before announcing, so a follower that starts another follow from
    // inside this delivery still finds the ask.
    answer();
    return { announce: answer, stop };
  };

  const follow = (topic: string, handler: (payload: unknown, from: string) => void): Teardown => {
    const off = on(ANY_SENDER, topic, (message) => {
      handler(message.payload, message.from);
    });
    // Subscribed before asking: an answer arrives synchronously inside this emit.
    emit(askTopic(topic));
    return off;
  };

  return { publish, follow };
}

function createBus(deps: BusDeps): BusApi {
  let live = true;
  deps.bag.add(() => {
    live = false;
  });

  const emit = (topic: string, payload?: unknown): void => {
    if (live) {
      deps.hub.emit(deps.fqid, topic, payload);
    }
  };

  const on = (from: string, topic: string, handler: (message: BusMessage) => void): Teardown => {
    const off = deps.hub.subscribe({
      from,
      topic,
      owner: deps.fqid,
      handler,
      onError: (err) => {
        deps.onError(`the bus handler for '${topic}'`, err);
      },
    });
    // An explicit call also drops the bag entry.
    const drop = deps.bag.add(off);
    return () => {
      drop();
      off();
    };
  };

  return { anySender: ANY_SENDER, emit, on, ...createPattern(emit, on) };
}

export type { BusApi, BusDeps, Publication };
export { createBus };
