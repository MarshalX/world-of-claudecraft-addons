import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DisposalBag } from '../loader/src/runtime/disposal.ts';
import { eventsFrame, snapFrame } from './fakes/frames.ts';
import { type NetHarness, netHarness } from './fakes/net-harness.ts';

let h: NetHarness;
beforeEach(() => {
  h = netHarness();
});

describe('the disposal bag', () => {
  it('releases every subscription when the addon is disabled', () => {
    const seen = vi.fn();
    h.net.on('snap', seen);
    h.net.onRaw(seen);
    h.net.onEvent('damage', seen);

    h.bag.dispose();
    h.inbound(snapFrame());
    h.inbound(eventsFrame([{ type: 'damage' }]));

    expect(seen).not.toHaveBeenCalled();
  });

  it('does not leave a dead entry behind when the addon unsubscribes itself', () => {
    const off = h.net.on('snap', vi.fn());
    expect(h.bag.size).toBe(1);

    off();

    expect(h.bag.size).toBe(0);
  });

  it('survives an explicit unsubscribe after disposal', () => {
    const off = h.net.on('snap', vi.fn());
    h.bag.dispose();

    expect(() => off()).not.toThrow();
  });
});

describe('the hub', () => {
  it('shares one socket hook across addons', () => {
    const second = new DisposalBag();
    const a = vi.fn();
    const b = vi.fn();
    h.net.on('snap', a);
    h.addonOf(second).on('snap', b);

    h.inbound(snapFrame());

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('disabling one addon leaves the other subscribed', () => {
    const second = new DisposalBag();
    const a = vi.fn();
    const b = vi.fn();
    h.net.on('snap', a);
    h.addonOf(second).on('snap', b);

    h.bag.dispose();
    h.inbound(snapFrame());

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  it('uninstalls the hook on dispose', () => {
    h.hub.dispose();

    expect(h.uninstalled()).toBe(true);
  });

  it('throttles through to the addon surface', () => {
    const seen = vi.fn();
    h.net.on('snap', seen, { throttle: 1000 });

    for (let i = 0; i < 20; i += 1) {
      h.advance(50);
      h.inbound(snapFrame());
    }

    expect(seen.mock.calls.length).toBeLessThan(3);
  });
});

// Freezing walks the whole frame, and a snapshot is large and arrives at 20 Hz, so it is frozen
// only when something subscribes to it. No subscriber may receive an unfrozen frame.
describe('freezing a frame', () => {
  // An undelivered frame has no handler to observe it, so the freeze itself is counted.
  it('does not walk a snapshot when only another topic is subscribed', () => {
    const froze = vi.spyOn(Object, 'freeze');
    h.net.onEvent('damage', vi.fn());
    froze.mockClear();

    h.inbound(snapFrame({ ents: [{ id: 1, auras: [{ id: 'rend' }] }, { id: 2 }] }));

    expect(froze).not.toHaveBeenCalled();
    froze.mockRestore();
  });

  it('walks it once something does subscribe to it', () => {
    const froze = vi.spyOn(Object, 'freeze');
    h.net.on('snap', vi.fn());
    froze.mockClear();

    h.inbound(snapFrame({ ents: [{ id: 1, auras: [{ id: 'rend' }] }, { id: 2 }] }));

    expect(froze).toHaveBeenCalled();
    froze.mockRestore();
  });

  it('freezes a snapshot for a frame subscriber', () => {
    let delivered: unknown = null;
    h.net.on('snap', (frame) => {
      delivered = frame;
    });

    h.inbound(snapFrame());

    expect(Object.isFrozen(delivered)).toBe(true);
  });

  it('freezes a snapshot for a raw subscriber', () => {
    let delivered: unknown = null;
    h.net.onRaw((frame) => {
      delivered = frame;
    });

    h.inbound(snapFrame());

    expect(Object.isFrozen(delivered)).toBe(true);
  });

  // Each event is frozen against its own subscribers.
  it('freezes an event for the kind that asked for it', () => {
    let delivered: unknown = null;
    h.net.onEvent('damage', (event) => {
      delivered = event;
    });

    h.inbound(eventsFrame([{ type: 'damage', amount: 12 }]));

    expect(Object.isFrozen(delivered)).toBe(true);
  });

  it('freezes an event for a wildcard subscriber', () => {
    let delivered: unknown = null;
    h.net.onAnyEvent((event) => {
      delivered = event;
    });

    h.inbound(eventsFrame([{ type: 'heal2', amount: 5 }]));

    expect(Object.isFrozen(delivered)).toBe(true);
  });
});
