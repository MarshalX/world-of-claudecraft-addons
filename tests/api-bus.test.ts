// The inter-addon bus. Mostly pins the refusals: a sender cannot claim to be somebody else, a
// subscriber is never handed a squatter's messages, and an emit cannot recurse forever.

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

describe('who a message is from', () => {
  it('stamps the sending addon', () => {
    const { addon } = bus();
    const seen: BusMessage[] = [];
    addon(BARS).api.on(METER, 'totals', (message) => seen.push(message));

    addon(METER).api.emit('totals');

    expect(seen[0]?.from).toBe(METER);
  });

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

// Naming the publisher prevents squatting, instead of every subscriber having to check `from`.
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

  it('stops a disabled addon emitting at all', () => {
    const { addon } = bus();
    const handler = vi.fn();
    addon(BARS).api.on(METER, 'totals', handler);
    const meter = addon(METER);

    meter.bag.dispose();
    meter.api.emit('totals');

    expect(handler).not.toHaveBeenCalled();
  });

  // Iterating a Set that is being mutated silently skips entries.
  it('still delivers to the rest when a handler unsubscribes mid-delivery', () => {
    const { addon } = bus();
    const later = vi.fn();
    const first = addon('a/one');
    const off = first.api.on(METER, 'totals', () => off());
    addon('a/two').api.on(METER, 'totals', later);

    addon(METER).api.emit('totals');

    expect(later).toHaveBeenCalledTimes(1);
  });

  // A snapshot still holds a subscriber dropped mid-delivery, so the live set is re-checked. The
  // dropper subscribes first, since a Set delivers in insertion order.
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

// Delivery is synchronous, so A -> B -> A recurses; unbounded, it hangs the tab.
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

  // Otherwise one cycle mutes the bus for the rest of the session.
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

// The ask-and-answer pattern: `follow` asks once at subscribe and `publish`
// announces once at construction, so neither side has to start first.
describe('publish and follow', () => {
  it('answers an ask from another addon', () => {
    const { addon } = bus();
    const lorebind = addon(METER);
    lorebind.api.publish('prices', () => ({ ore: 4 }));
    const seen: unknown[] = [];
    const listener = addon(BARS);
    listener.api.on(listener.api.anySender, 'prices', (message) => seen.push(message.payload));

    listener.api.emit('prices:ask');

    expect(seen).toEqual([{ ore: 4 }]);
  });

  it('does not answer its own ask', () => {
    const { addon } = bus();
    const publisher = addon(METER);
    const produce = vi.fn(() => ({ ore: 4 }));
    publisher.api.publish('prices', produce);
    // Publishing announces; what is under test is the addon's own ask after that.
    produce.mockClear();
    const heard = vi.fn();
    addon(BARS).api.on(METER, 'prices', heard);

    publisher.api.emit('prices:ask');

    expect(produce).not.toHaveBeenCalled();
    expect(heard).not.toHaveBeenCalled();
  });

  // Answering per subscriber would walk a publisher's whole table once per listener.
  it('runs produce once per ask rather than once per subscriber', () => {
    const { addon } = bus();
    const produce = vi.fn(() => ({ ore: 4 }));
    addon(METER).api.publish('prices', produce);
    // The announce at publish is its own case below.
    produce.mockClear();
    const first = vi.fn();
    const second = vi.fn();
    addon(BARS).api.on(METER, 'prices', first);
    addon('third/party').api.on(METER, 'prices', second);

    addon('a/asker').api.emit('prices:ask');

    expect(produce).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('reaches every follower on announce', () => {
    const { addon } = bus();
    const publication = addon(METER).api.publish('prices', () => ({ ore: 4 }));
    const first = vi.fn();
    const second = vi.fn();
    addon(BARS).api.follow('prices', first);
    addon('third/party').api.follow('prices', second);
    first.mockClear();
    second.mockClear();

    publication.announce();

    expect(first).toHaveBeenCalledWith({ ore: 4 }, METER);
    expect(second).toHaveBeenCalledWith({ ore: 4 }, METER);
  });

  it('asks exactly once when a follower subscribes', () => {
    const { addon } = bus();
    const asks = vi.fn();
    const watcher = addon('a/watcher');
    watcher.api.on(watcher.api.anySender, 'prices:ask', asks);

    addon(BARS).api.follow('prices', vi.fn());

    expect(asks).toHaveBeenCalledTimes(1);
  });

  // The follower's ask went out before the publisher existed.
  it('reaches a follower that started before it, with nobody calling announce', () => {
    const { addon } = bus();
    const heard = vi.fn();
    addon(BARS).api.follow('prices', heard);

    addon(METER).api.publish('prices', () => ({ ore: 4 }));

    expect(heard).toHaveBeenCalledWith({ ore: 4 }, METER);
  });

  it('announces at publish even with nothing to say yet', () => {
    const { addon } = bus();
    const heard = vi.fn();
    addon(BARS).api.follow('prices', heard);

    addon(METER).api.publish('prices', () => null);

    expect(heard).toHaveBeenCalledWith(null, METER);
  });

  it('reaches a follower that started before the publisher', () => {
    const { addon } = bus();
    const heard = vi.fn();
    addon(BARS).api.follow('prices', heard);
    const publication = addon(METER).api.publish('prices', () => ({ ore: 4 }));

    publication.announce();

    expect(heard).toHaveBeenCalledWith({ ore: 4 }, METER);
  });

  it('reaches a follower that started after the publisher, off its own ask', () => {
    const { addon } = bus();
    addon(METER).api.publish('prices', () => ({ ore: 4 }));
    const heard = vi.fn();

    addon(BARS).api.follow('prices', heard);

    expect(heard).toHaveBeenCalledWith({ ore: 4 }, METER);
  });

  it('stops answering when the publication is stopped', () => {
    const { addon } = bus();
    const produce = vi.fn(() => ({ ore: 4 }));
    const publication = addon(METER).api.publish('prices', produce);
    produce.mockClear();

    publication.stop();
    addon(BARS).api.emit('prices:ask');

    expect(produce).not.toHaveBeenCalled();
  });

  it('stops answering when the publishing addon is disabled', () => {
    const { addon } = bus();
    const publisher = addon(METER);
    const produce = vi.fn(() => ({ ore: 4 }));
    publisher.api.publish('prices', produce);
    produce.mockClear();

    publisher.bag.dispose();
    addon(BARS).api.emit('prices:ask');

    expect(produce).not.toHaveBeenCalled();
  });

  it('stops following when the following addon is disabled', () => {
    const { addon } = bus();
    const publication = addon(METER).api.publish('prices', () => ({ ore: 4 }));
    const heard = vi.fn();
    const follower = addon(BARS);
    follower.api.follow('prices', heard);
    heard.mockClear();

    follower.bag.dispose();
    publication.announce();

    expect(heard).not.toHaveBeenCalled();
  });

  it('stops following when the follower drops it', () => {
    const { addon } = bus();
    const publication = addon(METER).api.publish('prices', () => ({ ore: 4 }));
    const heard = vi.fn();
    const off = addon(BARS).api.follow('prices', heard);
    heard.mockClear();

    off();
    publication.announce();

    expect(heard).not.toHaveBeenCalled();
  });
});
