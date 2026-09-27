// The one place two addons can talk, since an addon is one file with no imports. Page realm only.
//
// A SENDER CANNOT LIE: `from` is stamped here from the fqid the surface was built with.
// A SUBSCRIBER NAMES ITS PUBLISHER, `(from, topic)`, which prevents squatting rather than making
// every subscriber check for it. `'*'` takes any sender; the stamp still says who.
// AN EMIT CANNOT RUN AWAY: delivery is synchronous, so A -> B -> A would hang the tab. Depth is
// capped and the refusal is loud.

import { diagError } from '../../shared/diag.ts';
import type { Teardown } from '../disposal.ts';

/** How deep emits from inside handlers may nest. A real chain is one or two links. */
const MAX_DEPTH = 8;

/** Any publisher, for a subscriber that does not care which addon sent it. */
const ANY_SENDER = '*';

interface BusMessage {
  /** The fqid of the addon that sent it. Stamped here; a sender cannot set it. */
  readonly from: string;
  readonly topic: string;
  readonly payload: unknown;
}

type BusHandler = (message: BusMessage) => void;

interface Subscription {
  /** An fqid, or ANY_SENDER. */
  from: string;
  topic: string;
  /** The subscribing addon, so its own emit is never delivered back to it. */
  owner: string;
  handler: BusHandler;
  /** Where a throw in the handler is reported. The SUBSCRIBER's log, not the sender's. */
  onError: (err: unknown) => void;
}

interface BusHub {
  emit: (from: string, topic: string, payload: unknown) => void;
  subscribe: (sub: Subscription) => Teardown;
  dispose: () => void;
}

function wants(sub: Subscription, message: BusMessage): boolean {
  if (sub.topic !== message.topic) {
    return false;
  }
  // Nobody receives their own messages.
  if (sub.owner === message.from) {
    return false;
  }
  return sub.from === ANY_SENDER || sub.from === message.from;
}

function createBusHub(): BusHub {
  const subs = new Set<Subscription>();
  let depth = 0;

  const deliver = (message: BusMessage): void => {
    // Copied, since a handler may unsubscribe mid-delivery, and re-checked against the live set so
    // a subscriber dropped by an earlier handler is not called.
    for (const sub of [...subs]) {
      if (subs.has(sub) && wants(sub, message)) {
        try {
          sub.handler(message);
        } catch (err) {
          // Reported to the subscriber, who wrote the handler, not the sender.
          sub.onError(err);
        }
      }
    }
  };

  return {
    emit: (from, topic, payload) => {
      if (depth >= MAX_DEPTH) {
        diagError(
          `bus: '${from}' emitted '${topic}' ${String(MAX_DEPTH)} levels deep, which is a cycle ` +
            'between addons rather than a chain. The message was dropped.',
          new Error('bus emit depth exceeded'),
        );
        return;
      }
      depth += 1;
      try {
        deliver(Object.freeze({ from, topic, payload }));
      } finally {
        // In a finally, or one escaped throw would leave the bus muted for the session.
        depth -= 1;
      }
    },

    subscribe: (sub) => {
      subs.add(sub);
      return () => {
        subs.delete(sub);
      };
    },

    dispose: () => {
      subs.clear();
    },
  };
}

export type { BusHandler, BusHub, BusMessage, Subscription };
export { ANY_SENDER, createBusHub, MAX_DEPTH };
