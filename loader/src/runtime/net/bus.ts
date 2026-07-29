// Topic subscription for socket traffic.
//
// One bus serves every addon, so a handler that throws must not stop the frame
// reaching the next one, and a handler that keeps throwing must not keep costing
// 20 dispatches a second forever.

/** Consecutive throws before a handler is dropped. A success resets the count. */
const QUARANTINE_AFTER = 5;

type Handler = (value: unknown) => void;

type Unsubscribe = () => void;

interface SubscribeOpts {
  /**
   * Leading edge: the first call in each window runs and the rest are dropped.
   *
   * Dropping rather than deferring keeps this timer-free, and on a 20 Hz topic
   * the next frame is 50 ms away, so a deferred one would be stale on arrival.
   */
  throttle?: number;
  once?: boolean;
}

interface Subscription {
  handler: Handler;
  throttle: number;
  once: boolean;
  lastAt: number;
  failures: number;
}

interface BusDeps {
  now: () => number;
  onError: (topic: string, err: unknown, quarantined: boolean) => void;
}

interface BusState {
  topics: Map<string, Set<Subscription>>;
  deps: BusDeps;
}

function newSubscription(handler: Handler, opts: SubscribeOpts | undefined): Subscription {
  return {
    handler,
    throttle: opts?.throttle ?? 0,
    once: opts?.once ?? false,
    lastAt: Number.NEGATIVE_INFINITY,
    failures: 0,
  };
}

function forget(bus: BusState, topic: string, sub: Subscription): void {
  const subs = bus.topics.get(topic);
  if (subs === undefined) {
    return;
  }
  subs.delete(sub);
  if (subs.size === 0) {
    bus.topics.delete(topic);
  }
}

/** False while the subscription is inside its throttle window. Stamps it when true. */
function due(sub: Subscription, at: number): boolean {
  if (sub.throttle > 0 && at - sub.lastAt < sub.throttle) {
    return false;
  }
  sub.lastAt = at;
  return true;
}

function deliver(bus: BusState, topic: string, sub: Subscription, value: unknown): void {
  try {
    sub.handler(value);
    sub.failures = 0;
  } catch (err) {
    sub.failures += 1;
    const quarantined = sub.failures >= QUARANTINE_AFTER;
    if (quarantined) {
      forget(bus, topic, sub);
    }
    bus.deps.onError(topic, err, quarantined);
  }
}

function publishTo(bus: BusState, topic: string, value: unknown): void {
  const subs = bus.topics.get(topic);
  if (subs === undefined) {
    return;
  }
  // Iterate a copy: a once handler, a quarantine, or a handler that unsubscribes
  // a sibling all mutate the set mid-dispatch.
  for (const sub of [...subs]) {
    if (subs.has(sub) && due(sub, bus.deps.now())) {
      if (sub.once) {
        forget(bus, topic, sub);
      }
      deliver(bus, topic, sub, value);
    }
  }
}

export type { BusDeps, Handler, SubscribeOpts, Unsubscribe };

export interface FrameBus {
  subscribe: (topic: string, handler: Handler, opts?: SubscribeOpts) => Unsubscribe;
  publish: (topic: string, value: unknown) => void;
  hasSubscribers: (topic: string) => boolean;
  /** Total subscriptions across every topic. */
  readonly size: number;
  clear: () => void;
}

export function createFrameBus(deps: BusDeps): FrameBus {
  const bus: BusState = { topics: new Map(), deps };

  return {
    subscribe: (topic, handler, opts) => {
      const sub = newSubscription(handler, opts);
      const subs = bus.topics.get(topic) ?? new Set<Subscription>();
      subs.add(sub);
      bus.topics.set(topic, subs);
      return () => forget(bus, topic, sub);
    },

    publish: (topic, value) => publishTo(bus, topic, value),

    hasSubscribers: (topic) => bus.topics.has(topic),

    get size(): number {
      let total = 0;
      for (const subs of bus.topics.values()) {
        total += subs.size;
      }
      return total;
    },

    clear: () => bus.topics.clear(),
  };
}
