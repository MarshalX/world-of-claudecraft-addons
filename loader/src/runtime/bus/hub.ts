// The one place two addons can talk to each other.
//
// An addon is ONE FILE, deliberately and permanently: there are no shared
// libraries and no imports between addons. That decision is what gives this hub
// its value rather than making it a convenience. A meter that publishes its
// per-ability totals lets somebody else write the display without forking the
// meter, and a boss addon that publishes a phase lets three cosmetic addons
// react to it, and neither of those is expressible any other way.
//
// Page realm only. Nothing here crosses the bridge: this is addons talking to
// each other inside one document, not a message channel to the host.
//
// THREE RULES, each closing a failure this shape is prone to.
//
// A SENDER CANNOT LIE ABOUT ITSELF. `from` is stamped here from the fqid the
// surface was built with, so it is not a field an addon fills in and not one it
// can overwrite. A subscriber deciding what to trust needs the sender's identity
// to be worth something.
//
// A SUBSCRIBER NAMES ITS PUBLISHER. Listening is `(from, topic)`, not `topic`,
// so two addons that both publish `totals` cannot be confused for each other and
// nobody can take a name by publishing under it first. `'*'` is available for the
// case where any publisher will do, and the stamp is on every message, so a
// wildcard subscriber can still tell who sent what. Squatting is the failure this
// prevents, and prevention is the point: detecting it afterwards would mean every
// subscriber has to remember to check.
//
// AN EMIT CANNOT RUN AWAY. Delivery is synchronous, which makes A -> B -> A a
// possible cycle even though nobody receives their own messages. Synchronous
// recursion with no floor is a hung tab, and a hung tab in a game is not a bug
// report, it is a wipe. So depth is capped and the refusal is loud.

import { diagError } from '../../shared/diag.ts';
import type { Teardown } from '../disposal.ts';

/**
 * How deep a chain of emits made from inside handlers may go.
 *
 * A real chain is one or two links: a meter emits, a display redraws and emits
 * that it did. Anything past this is a cycle, and the only useful thing to do
 * with a cycle is to stop it somewhere and say where.
 */
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
  // Nobody receives their own messages. An addon that both publishes and listens
  // on a topic would otherwise answer itself, and it does not need a bus to talk
  // to its own code.
  if (sub.owner === message.from) {
    return false;
  }
  return sub.from === ANY_SENDER || sub.from === message.from;
}

function createBusHub(): BusHub {
  const subs = new Set<Subscription>();
  let depth = 0;

  const deliver = (message: BusMessage): void => {
    // Snapshotted before delivery, and re-checked against the live set inside
    // it. The copy is because a handler may unsubscribe during delivery and
    // mutating a Set mid-iteration silently skips whoever moved; the re-check is
    // because the copy then still holds a subscriber another handler has since
    // dropped, and calling into an addon that has just been torn down is the
    // failure the drop was for.
    for (const sub of [...subs]) {
      if (subs.has(sub) && wants(sub, message)) {
        try {
          sub.handler(message);
        } catch (err) {
          // One subscriber throwing must not cost the others the message. It is
          // reported to the addon that WROTE the handler, since the addon that
          // sent the message has nothing it could do about it.
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
        // In a finally, or one throw that escaped every guard above would leave
        // the depth raised for the rest of the session and mute the bus.
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
