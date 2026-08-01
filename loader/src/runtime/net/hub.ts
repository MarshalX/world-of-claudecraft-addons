// The one socket observer every addon shares.
//
// The hook is installed once for the page; addons subscribe here. Nothing an
// addon does can reach the socket, and nothing it does can cost another addon a
// frame.

import { diagError } from '../../shared/diag.ts';
import {
  createFrameBus,
  type FrameBus,
  type Handler,
  type SubscribeOpts,
  type Unsubscribe,
} from './bus.ts';
import {
  deepFreeze,
  type Frame,
  fieldArray,
  fieldString,
  parseFrame,
  redactOutbound,
} from './frames.ts';
import type { SocketTaps } from './hook.ts';
import { createNetStateTracker, type NetState, type NetStateTracker } from './state.ts';

const RAW_TOPIC = 'raw';
const SEND_TOPIC = 'send';
const ANY_EVENT_TOPIC = 'event:*';

function frameTopic(type: string): string {
  return `frame:${type}`;
}

function eventTopic(kind: string): string {
  return `event:${kind}`;
}

function reportHandlerError(topic: string, err: unknown, quarantined: boolean): void {
  if (quarantined) {
    diagError(`an addon handler for ${topic} threw too often, dropping it`, err);
    return;
  }
  diagError(`an addon handler for ${topic} threw`, err);
}

/**
 * One event, frozen against its OWN subscribers and then delivered.
 *
 * Per event rather than freezing the whole frame once for the list, and the question
 * is asked here rather than hoisted out of the loop: a handler that subscribes to
 * another kind while this event is being delivered must not then be handed an
 * unfrozen one.
 */
function publishEvent(bus: FrameBus, event: unknown): void {
  const anySubscribed = bus.hasSubscribers(ANY_EVENT_TOPIC);
  const kind = fieldString(event, 'type');
  if (kind === null) {
    if (anySubscribed) {
      bus.publish(ANY_EVENT_TOPIC, deepFreeze(event));
    }
    return;
  }
  const topic = eventTopic(kind);
  if (anySubscribed || bus.hasSubscribers(topic)) {
    deepFreeze(event);
  }
  if (anySubscribed) {
    bus.publish(ANY_EVENT_TOPIC, event);
  }
  bus.publish(topic, event);
}

/** Fan a decoded events frame out to the per-kind topics. */
function publishEvents(bus: FrameBus, frame: Frame): void {
  for (const event of fieldArray(frame, 'list')) {
    publishEvent(bus, event);
  }
}

function createTaps(bus: FrameBus, tracker: NetStateTracker, now: () => number): SocketTaps {
  return {
    onOpen: () => tracker.noteOpen(),
    onClose: () => tracker.noteClose(),

    onMessage: (data) => {
      const frame = parseFrame(data);
      if (frame === null) {
        return;
      }
      // State is polled through net.state, so it tracks whether or not anything is
      // subscribed. Everything the loader reads for itself is taken HERE, at the
      // tap, and never by subscribing: a loader-owned subscription is
      // indistinguishable from an addon's, and would defeat the gate below.
      tracker.noteFrame(frame, now());
      const topic = frameTopic(frame.t);
      // Freezing only isolates handlers from each other, so it is worth its walk
      // over the whole frame only when a handler will actually be handed one. A
      // snapshot is the frame this matters for: it is the largest thing on the
      // socket and it arrives 20 times a second, and a player running a meter that
      // subscribes to combat EVENTS was paying to freeze every one of them.
      //
      // Read immediately before the publishes it guards, with nothing between, so
      // there is no window in which a subscriber could appear and be handed the
      // frame unfrozen.
      if (bus.hasSubscribers(RAW_TOPIC) || bus.hasSubscribers(topic)) {
        deepFreeze(frame);
      }
      bus.publish(RAW_TOPIC, frame);
      bus.publish(topic, frame);
      if (frame.t === 'events') {
        publishEvents(bus, frame);
      }
    },

    onSend: (data) => {
      const frame = parseFrame(data);
      if (frame === null) {
        return;
      }
      tracker.noteSend(frame, now());
      if (bus.hasSubscribers(SEND_TOPIC)) {
        // Redact before publishing, never after: the auth frame carries the
        // account bearer token and an addon must not be handed it.
        bus.publish(SEND_TOPIC, deepFreeze(redactOutbound(frame)));
      }
    },
  };
}

export interface NetHubDeps {
  /** Injected so the hub owns no global of its own. */
  install: (taps: SocketTaps) => Unsubscribe;
  now: () => number;
}

export interface NetHub {
  onFrame: (type: string, handler: Handler, opts?: SubscribeOpts) => Unsubscribe;
  onRaw: (handler: Handler, opts?: SubscribeOpts) => Unsubscribe;
  onSend: (handler: Handler, opts?: SubscribeOpts) => Unsubscribe;
  onEvent: (kind: string, handler: Handler, opts?: SubscribeOpts) => Unsubscribe;
  onAnyEvent: (handler: Handler, opts?: SubscribeOpts) => Unsubscribe;
  state: () => NetState;
  /**
   * The sim's clock in seconds, or null before the first snapshot.
   *
   * Off the snapshot HEAD, so it is net state rather than world state. Not on
   * `state()`, which is the addon-facing reading: see the note in net/state.ts for
   * why a raw sim time is not something to publish.
   */
  simNow: () => number | null;
  dispose: () => void;
}

export function createNetHub(deps: NetHubDeps): NetHub {
  const bus = createFrameBus({ now: deps.now, onError: reportHandlerError });
  const tracker = createNetStateTracker();
  const uninstall = deps.install(createTaps(bus, tracker, deps.now));

  return {
    onFrame: (type, handler, opts) => bus.subscribe(frameTopic(type), handler, opts),
    onRaw: (handler, opts) => bus.subscribe(RAW_TOPIC, handler, opts),
    onSend: (handler, opts) => bus.subscribe(SEND_TOPIC, handler, opts),
    onEvent: (kind, handler, opts) => bus.subscribe(eventTopic(kind), handler, opts),
    onAnyEvent: (handler, opts) => bus.subscribe(ANY_EVENT_TOPIC, handler, opts),
    state: () => tracker.snapshot(),
    simNow: () => tracker.simNow(),
    dispose: () => {
      uninstall();
      bus.clear();
    },
  };
}
