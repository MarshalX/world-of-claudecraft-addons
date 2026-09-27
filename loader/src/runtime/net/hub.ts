// The one socket observer every addon shares. No addon can reach the socket or cost another one
// a frame.

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
 * Frozen per event and asked per event, not hoisted: a handler may subscribe to another kind
 * mid-delivery and must not then be handed an unfrozen event.
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
      // The loader reads for itself here at the tap, never by subscribing, which would defeat the
      // freeze gate below.
      tracker.noteFrame(frame, now());
      const topic = frameTopic(frame.t);
      // Freeze only when a handler will be handed the frame: a 20 Hz snapshot is costly to walk.
      // Checked immediately before the publishes, so no subscriber gets it unfrozen.
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
        // Redact before publishing: the auth frame carries the account bearer token.
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
  /** The sim clock in seconds off the snapshot head, or null. Unpublished; see net/state.ts. */
  simNow: () => number | null;
  /** The hello frame's realm. Its own accessor: `state()` allocates and this is read per sample. */
  realm: () => string | null;
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
    realm: () => tracker.realm(),
    dispose: () => {
      uninstall();
      bus.clear();
    },
  };
}
