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

/** Fan a decoded events frame out to the per-kind topics. */
function publishEvents(bus: FrameBus, frame: Frame): void {
  const anySubscribed = bus.hasSubscribers(ANY_EVENT_TOPIC);
  for (const event of fieldArray(frame, 'list')) {
    if (anySubscribed) {
      bus.publish(ANY_EVENT_TOPIC, event);
    }
    const kind = fieldString(event, 'type');
    if (kind !== null) {
      bus.publish(eventTopic(kind), event);
    }
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
      // State is polled through net.state, so it tracks whether or not anything
      // is subscribed. Freezing only isolates handlers from each other, so it is
      // skipped entirely when there are none.
      tracker.noteFrame(frame, now());
      if (bus.size === 0) {
        return;
      }
      deepFreeze(frame);
      bus.publish(RAW_TOPIC, frame);
      bus.publish(frameTopic(frame.t), frame);
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
    dispose: () => {
      uninstall();
      bus.clear();
    },
  };
}
