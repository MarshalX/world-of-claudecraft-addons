import { describe, expect, it, vi } from 'vitest';

import { type BusDeps, createFrameBus, type FrameBus } from '../loader/src/runtime/net/bus.ts';

interface Harness {
  bus: FrameBus;
  errors: Array<{ topic: string; quarantined: boolean }>;
  advance: (ms: number) => void;
}

function harness(): Harness {
  let clock = 0;
  const errors: Array<{ topic: string; quarantined: boolean }> = [];
  const deps: BusDeps = {
    now: () => clock,
    onError: (topic, _err, quarantined) => errors.push({ topic, quarantined }),
  };
  return {
    bus: createFrameBus(deps),
    errors,
    advance: (ms) => {
      clock += ms;
    },
  };
}

describe('createFrameBus', () => {
  it('delivers to every subscriber of a topic and nobody else', () => {
    const { bus } = harness();
    const onSnap = vi.fn();
    const onHello = vi.fn();
    bus.subscribe('snap', onSnap);
    bus.subscribe('hello', onHello);

    bus.publish('snap', { tick: 1 });

    expect(onSnap).toHaveBeenCalledExactlyOnceWith({ tick: 1 });
    expect(onHello).not.toHaveBeenCalled();
  });

  it('stops delivering after unsubscribe', () => {
    const { bus } = harness();
    const seen = vi.fn();
    bus.subscribe('snap', seen)();

    bus.publish('snap', 1);

    expect(seen).not.toHaveBeenCalled();
  });

  describe('throttle', () => {
    // snap fires 20 times a second.
    it('drops everything inside the window and passes the first after it', () => {
      const { bus, advance } = harness();
      const seen = vi.fn();
      bus.subscribe('snap', seen, { throttle: 100 });

      bus.publish('snap', 'a');
      advance(50);
      bus.publish('snap', 'b');
      advance(60);
      bus.publish('snap', 'c');

      expect(seen.mock.calls.flat()).toEqual(['a', 'c']);
    });

    it('throttles each subscriber on its own clock', () => {
      const { bus, advance } = harness();
      const fast = vi.fn();
      const slow = vi.fn();
      bus.subscribe('snap', fast, { throttle: 10 });
      bus.subscribe('snap', slow, { throttle: 1000 });

      bus.publish('snap', 1);
      advance(20);
      bus.publish('snap', 2);

      expect(fast).toHaveBeenCalledTimes(2);
      expect(slow).toHaveBeenCalledTimes(1);
    });

    it('leaves an unthrottled subscriber alone', () => {
      const { bus } = harness();
      const seen = vi.fn();
      bus.subscribe('snap', seen);

      bus.publish('snap', 1);
      bus.publish('snap', 2);

      expect(seen).toHaveBeenCalledTimes(2);
    });
  });

  describe('once', () => {
    it('delivers a single time and unregisters', () => {
      const { bus } = harness();
      const seen = vi.fn();
      bus.subscribe('hello', seen, { once: true });

      bus.publish('hello', 1);
      bus.publish('hello', 2);

      expect(seen).toHaveBeenCalledExactlyOnceWith(1);
      expect(bus.size).toBe(0);
    });
  });

  describe('a throwing handler', () => {
    it('does not stop the frame reaching the next subscriber', () => {
      const { bus } = harness();
      const after = vi.fn();
      bus.subscribe('snap', () => {
        throw new Error('addon bug');
      });
      bus.subscribe('snap', after);

      bus.publish('snap', 1);

      expect(after).toHaveBeenCalledOnce();
    });

    it('is dropped after five consecutive throws', () => {
      const { bus, errors } = harness();
      const bad = vi.fn(() => {
        throw new Error('addon bug');
      });
      bus.subscribe('snap', bad);

      for (let i = 0; i < 8; i += 1) {
        bus.publish('snap', i);
      }

      expect(bad).toHaveBeenCalledTimes(5);
      expect(bus.size).toBe(0);
      expect(errors.at(-1)?.quarantined).toBe(true);
    });

    it('resets the count on a success', () => {
      const { bus } = harness();
      let calls = 0;
      const flaky = vi.fn(() => {
        calls += 1;
        if (calls % 2 === 1) {
          throw new Error('every other one');
        }
      });
      bus.subscribe('snap', flaky);

      for (let i = 0; i < 20; i += 1) {
        bus.publish('snap', i);
      }

      expect(flaky).toHaveBeenCalledTimes(20);
      expect(bus.size).toBe(1);
    });

    it('reports the throw without quarantining on the way there', () => {
      const { bus, errors } = harness();
      bus.subscribe('snap', () => {
        throw new Error('addon bug');
      });

      bus.publish('snap', 1);

      expect(errors).toEqual([{ topic: 'snap', quarantined: false }]);
    });
  });

  // once, quarantine and unsubscribing handlers all mutate the set mid-dispatch.
  describe('mutation during dispatch', () => {
    it('does not deliver to a subscriber an earlier handler removed', () => {
      const { bus } = harness();
      const second = vi.fn();
      bus.subscribe('snap', () => off2());
      const off2 = bus.subscribe('snap', second);

      bus.publish('snap', 1);

      expect(second).not.toHaveBeenCalled();
    });

    it('delivers to a subscriber added during dispatch only on the next publish', () => {
      const { bus } = harness();
      const late = vi.fn();
      bus.subscribe('snap', () => bus.subscribe('snap', late), { once: true });

      bus.publish('snap', 1);
      expect(late).not.toHaveBeenCalled();

      bus.publish('snap', 2);
      expect(late).toHaveBeenCalledExactlyOnceWith(2);
    });
  });

  describe('size and hasSubscribers', () => {
    // `hasSubscribers` is per topic because the loader subscribes at boot, so a
    // bus-wide count is never zero. `size` pins that unsubscribe leaves nothing behind.
    it('counts across topics and drops back to zero', () => {
      const { bus } = harness();
      const offA = bus.subscribe('snap', vi.fn());
      const offB = bus.subscribe('hello', vi.fn());
      bus.subscribe('hello', vi.fn());
      expect(bus.size).toBe(3);

      offA();
      offB();
      expect(bus.size).toBe(1);
      expect(bus.hasSubscribers('snap')).toBe(false);
      expect(bus.hasSubscribers('hello')).toBe(true);
    });

    it('forgets an emptied topic', () => {
      const { bus } = harness();
      bus.subscribe('snap', vi.fn())();

      expect(bus.hasSubscribers('snap')).toBe(false);
    });

    it('clears everything', () => {
      const { bus } = harness();
      bus.subscribe('snap', vi.fn());
      bus.clear();

      expect(bus.size).toBe(0);
    });
  });
});

// `deliver` runs addon code mid-publish, so a slow handler moves the clock for the
// subscribers after it.
describe('the timestamp a publish is measured at', () => {
  // One timestamp per publish, since every subscriber is told about the same frame.
  it('measures the window from the frame arrival', () => {
    const { bus, advance } = harness();
    const seen = vi.fn();
    // Slow once: a constant cost shifts both readings equally and hides the leak.
    let slow = true;
    bus.subscribe('snap', () => {
      if (slow) {
        slow = false;
        advance(40);
      }
    });
    bus.subscribe('snap', seen, { throttle: 100 });

    bus.publish('snap', 'a');
    advance(80);
    bus.publish('snap', 'b');

    // 120 ms since the delivered frame; stamped after the neighbour it would read 80.
    expect(seen.mock.calls.flat()).toEqual(['a', 'b']);
  });
});
