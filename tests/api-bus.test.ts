// The inter-addon bus.
//
// An addon is one file with no imports, so this is the only way two of them
// cooperate, and that raises what a hole in it costs: there is no second route
// for two addons to reach each other by if this one is wrong.
//
// Most of what is pinned here is the three refusals rather than the delivery.
// Delivery is a Set and a loop. The refusals (a sender cannot claim to be
// somebody else, a subscriber cannot be handed a squatter's messages, an emit
// cannot recurse forever) are the parts that would each look fine in review and
// only show up in a session with two addons installed.

import { describe, expect, it, vi } from 'vitest';
import { createBus } from '../loader/src/runtime/api/bus.ts';
import { type BusMessage, createBusHub, MAX_DEPTH } from '../loader/src/runtime/bus/hub.ts';
import { DisposalBag } from '../loader/src/runtime/disposal.ts';
import { captureDiag } from './fakes/diag.ts';

const METER = 'official/combat-meter';
const BARS = 'official/cooldown-bars';

/** One hub with as many addons on it as a case needs. */
function bus() {
  const hub = createBusHub();
  const errors: Array<{ where: string; err: unknown }> = [];
  const addon = (fqid: string) => {
    const bag = new DisposalBag();
    return {
      bag,
      api: createBus({
        hub,
        fqid,
        bag,
        onError: (where, err) => {
          errors.push({ where, err });
        },
      }),
    };
  };
  return { hub, addon, errors };
}

describe('publishing', () => {
  it('delivers to an addon listening for that publisher and topic', () => {
    const { addon } = bus();
    const seen: BusMessage[] = [];
    addon(BARS).api.on(METER, 'totals', (message) => seen.push(message));

    addon(METER).api.emit('totals', { dps: 812 });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.payload).toEqual({ dps: 812 });
  });

  it('delivers to every subscriber, not only the first', () => {
    const { addon } = bus();
    const first = vi.fn();
    const second = vi.fn();
    addon(BARS).api.on(METER, 'totals', first);
    addon('third/party').api.on(METER, 'totals', second);

    addon(METER).api.emit('totals');

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not deliver another topic', () => {
    const { addon } = bus();
    const handler = vi.fn();
    addon(BARS).api.on(METER, 'totals', handler);

    addon(METER).api.emit('phase');

    expect(handler).not.toHaveBeenCalled();
  });

  it('carries an undefined payload for a bare announcement', () => {
    const { addon } = bus();
    const seen: BusMessage[] = [];
    addon(BARS).api.on(METER, 'reset', (message) => seen.push(message));

    addon(METER).api.emit('reset');

    expect(seen[0]?.payload).toBeUndefined();
  });
});

// The stamp is what makes a subscriber's trust decision worth anything.
describe('who a message is from', () => {
  it('stamps the sending addon', () => {
    const { addon } = bus();
    const seen: BusMessage[] = [];
    addon(BARS).api.on(METER, 'totals', (message) => seen.push(message));

    addon(METER).api.emit('totals');

    expect(seen[0]?.from).toBe(METER);
  });

  // A sender that could overwrite its own stamp could impersonate any addon a
  // subscriber decided to trust, which is the whole value of the field.
  it('cannot be overwritten by the sender', () => {
    const { addon } = bus();
    const seen: BusMessage[] = [];
    addon(BARS).api.on(METER, 'totals', (message) => seen.push(message));

    addon(METER).api.emit('totals');
    const first = seen[0] as unknown as { from: string };
    expect(() => {
      first.from = BARS;
    }).toThrow();
    expect(seen[0]?.from).toBe(METER);
  });
});

// Naming the publisher is what stops one addon taking a topic name by
// publishing under it first. Detecting it afterwards would mean every
// subscriber has to remember to check, which is the version nobody writes.
describe('naming the publisher', () => {
  it('does not deliver the same topic from a different addon', () => {
    const { addon } = bus();
    const handler = vi.fn();
    addon('third/party').api.on(METER, 'totals', handler);

    addon(BARS).api.emit('totals', 'a squatter');

    expect(handler).not.toHaveBeenCalled();
  });

  it('delivers from anyone for the wildcard, and says who each was', () => {
    const { addon } = bus();
    const listener = addon('third/party');
    const from: string[] = [];
    listener.api.on(listener.api.anySender, 'totals', (message) => from.push(message.from));

    addon(METER).api.emit('totals');
    addon(BARS).api.emit('totals');

    expect(from).toEqual([METER, BARS]);
  });

  // You do not need a bus to call your own code, and self-delivery is how a loop
  // starts: an addon that both publishes and listens would answer itself.
  it('never delivers an addon its own message, even on the wildcard', () => {
    const { addon } = bus();
    const meter = addon(METER);
    const own = vi.fn();
    meter.api.on(meter.api.anySender, 'totals', own);
    meter.api.on(METER, 'totals', own);

    meter.api.emit('totals');

    expect(own).not.toHaveBeenCalled();
  });
});

describe('unsubscribing', () => {
  it('stops delivery', () => {
    const { addon } = bus();
    const handler = vi.fn();
    const off = addon(BARS).api.on(METER, 'totals', handler);

    off();
    addon(METER).api.emit('totals');

    expect(handler).not.toHaveBeenCalled();
  });

  it('is done for the addon when it is disabled', () => {
    const { addon } = bus();
    const handler = vi.fn();
    const listener = addon(BARS);
    listener.api.on(METER, 'totals', handler);

    listener.bag.dispose();
    addon(METER).api.emit('totals');

    expect(handler).not.toHaveBeenCalled();
  });

  // A stray timer firing after disable would otherwise wake other addons'
  // handlers on behalf of an addon that is no longer running.
  it('stops a disabled addon emitting at all', () => {
    const { addon } = bus();
    const handler = vi.fn();
    addon(BARS).api.on(METER, 'totals', handler);
    const meter = addon(METER);

    meter.bag.dispose();
    meter.api.emit('totals');

    expect(handler).not.toHaveBeenCalled();
  });

  // A handler that unsubscribes during delivery must not cost the addon after it
  // the message: iterating a Set that is being mutated silently skips whoever moved.
  it('still delivers to the rest when a handler unsubscribes mid-delivery', () => {
    const { addon } = bus();
    const later = vi.fn();
    const first = addon('a/one');
    const off = first.api.on(METER, 'totals', () => off());
    addon('a/two').api.on(METER, 'totals', later);

    addon(METER).api.emit('totals');

    expect(later).toHaveBeenCalledTimes(1);
  });

  // The reverse, and the one a snapshot alone gets wrong: iterating a copy means
  // a subscriber dropped DURING this delivery is still in the copy, so without
  // re-checking the live set an addon torn down mid-emit would be called anyway.
  // Subscribed in this order deliberately, since a Set delivers in insertion
  // order and the dropper has to run first for there to be anything to prove.
  it('does not deliver to a subscriber another handler just dropped', () => {
    const { addon } = bus();
    const dropped = vi.fn();
    let off = (): void => undefined;
    addon('a/one').api.on(METER, 'totals', () => off());
    off = addon('a/two').api.on(METER, 'totals', dropped);

    addon(METER).api.emit('totals');

    expect(dropped).not.toHaveBeenCalled();
  });
});

describe('a handler that throws', () => {
  it('does not stop the message reaching the others', () => {
    const { addon } = bus();
    const after = vi.fn();
    addon('a/one').api.on(METER, 'totals', () => {
      throw new Error('bad handler');
    });
    addon('a/two').api.on(METER, 'totals', after);

    addon(METER).api.emit('totals');

    expect(after).toHaveBeenCalledTimes(1);
  });

  // Reported to whoever WROTE the handler. The addon that sent the message has
  // nothing it could do about somebody else's bug.
  it('is reported against the subscribing addon, not the sender', () => {
    const { addon, errors } = bus();
    addon(BARS).api.on(METER, 'totals', () => {
      throw new Error('bad handler');
    });

    addon(METER).api.emit('totals');

    expect(errors).toHaveLength(1);
    expect(errors[0]?.where).toContain('totals');
  });

  it('does not throw out of the sender emit', () => {
    const { addon } = bus();
    addon(BARS).api.on(METER, 'totals', () => {
      throw new Error('bad handler');
    });
    const meter = addon(METER);

    expect(() => meter.api.emit('totals')).not.toThrow();
  });
});

// Delivery is synchronous, so A -> B -> A is a cycle even though nobody receives
// their own messages. Unbounded synchronous recursion is a hung tab, and a hung
// tab in a game is not a bug report, it is a wipe.
describe('a cycle between two addons', () => {
  it('stops rather than hanging, and says so', () => {
    const diag = captureDiag();
    const { addon } = bus();
    const one = addon('a/one');
    const two = addon('a/two');
    one.api.on('a/two', 'ping', () => one.api.emit('ping'));
    two.api.on('a/one', 'ping', () => two.api.emit('ping'));

    one.api.emit('ping');

    expect(diag.errors().flat().join(' ')).toContain('cycle');
    diag.restore();
  });

  // The depth is restored afterwards, or one cycle would mute the bus for the
  // rest of the session and every addon after it would look broken instead.
  it('leaves the bus working afterwards', () => {
    const diag = captureDiag();
    const { addon } = bus();
    const one = addon('a/one');
    const two = addon('a/two');
    one.api.on('a/two', 'ping', () => one.api.emit('ping'));
    two.api.on('a/one', 'ping', () => two.api.emit('ping'));
    one.api.emit('ping');
    diag.restore();

    const after = vi.fn();
    addon('a/three').api.on('a/one', 'quiet', after);
    one.api.emit('quiet');

    expect(after).toHaveBeenCalledTimes(1);
  });

  // A real chain is one or two links deep: a meter emits, a display redraws and
  // announces that it did. The cap must not be under that.
  it('allows a chain shorter than the cap', () => {
    const { addon } = bus();
    const one = addon('a/one');
    const two = addon('a/two');
    const end = vi.fn();
    two.api.on('a/one', 'start', () => two.api.emit('done'));
    addon('a/three').api.on('a/two', 'done', end);

    one.api.emit('start');

    expect(end).toHaveBeenCalledTimes(1);
    expect(MAX_DEPTH).toBeGreaterThan(2);
  });
});
