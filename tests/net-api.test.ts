import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AUTH_FRAME, at, eventsFrame, HELLO_FRAME, snapFrame } from './fakes/frames.ts';
import { type NetHarness, netHarness } from './fakes/net-harness.ts';

const TIMED_OUT = /timed out/;

let h: NetHarness;
beforeEach(() => {
  h = netHarness();
});

describe('net.on', () => {
  it('delivers the frame type it subscribed to', () => {
    const seen = vi.fn();
    h.net.on('snap', seen);

    h.inbound(snapFrame());

    expect(seen).toHaveBeenCalledOnce();
  });

  it('does not deliver another type', () => {
    const seen = vi.fn();
    h.net.on('hello', seen);

    h.inbound(snapFrame());

    expect(seen).not.toHaveBeenCalled();
  });

  it('hands over a frozen frame, so one addon cannot edit another"s view', () => {
    const seen = vi.fn();
    h.net.on('snap', seen);

    h.inbound(snapFrame());

    expect(Object.isFrozen(seen.mock.calls[0]?.[0])).toBe(true);
  });

  it('drops a frame that is not JSON without disturbing anything', () => {
    const seen = vi.fn();
    h.net.onRaw(seen);

    expect(() => h.taps.onMessage('not json')).not.toThrow();
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('net.onRaw', () => {
  it('sees every inbound frame whatever its type', () => {
    const seen = vi.fn();
    h.net.onRaw(seen);

    h.inbound(HELLO_FRAME);
    h.inbound(snapFrame());

    expect(seen).toHaveBeenCalledTimes(2);
  });
});

describe('net.onEvent', () => {
  it('decodes one kind out of an events frame', () => {
    const damage = vi.fn();
    h.net.onEvent('damage', damage);

    h.inbound(
      eventsFrame([
        { type: 'damage', amount: 12 },
        { type: 'xp', amount: 40 },
      ]),
    );

    expect(damage).toHaveBeenCalledExactlyOnceWith({ type: 'damage', amount: 12 });
  });

  it('delivers each event in a batch separately', () => {
    const damage = vi.fn();
    h.net.onEvent('damage', damage);

    h.inbound(eventsFrame([{ type: 'damage' }, { type: 'damage' }, { type: 'damage' }]));

    expect(damage).toHaveBeenCalledTimes(3);
  });

  it('sees every kind through onAnyEvent', () => {
    const any = vi.fn();
    h.net.onAnyEvent(any);

    h.inbound(eventsFrame([{ type: 'damage' }, { type: 'death' }, { type: 'loot' }]));

    expect(any).toHaveBeenCalledTimes(3);
  });

  it('ignores an event with no kind rather than inventing one', () => {
    const any = vi.fn();
    const typed = vi.fn();
    h.net.onAnyEvent(any);
    h.net.onEvent('undefined', typed);

    h.inbound(eventsFrame([{ amount: 3 }]));

    expect(any).toHaveBeenCalledOnce();
    expect(typed).not.toHaveBeenCalled();
  });
});

describe('net.onSend', () => {
  it('reports the frames the game sends', () => {
    const seen = vi.fn();
    h.net.onSend(seen);

    h.outbound({ t: 'input', seq: 1 });

    expect(seen).toHaveBeenCalledOnce();
  });

  // The whole reason this path is guarded: the auth frame carries the account
  // bearer token, and it is the first frame on every socket.
  it('never hands an addon the session token', () => {
    const seen = vi.fn();
    h.net.onSend(seen);

    h.outbound(AUTH_FRAME);

    const frame = seen.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(at(frame, 'token')).not.toBe(AUTH_FRAME.token);
    expect(JSON.stringify(frame)).not.toContain(AUTH_FRAME.token);
  });

  it('still reports that the auth frame went out', () => {
    const seen = vi.fn();
    h.net.onSend(seen);

    h.outbound(AUTH_FRAME);

    expect(at(seen.mock.calls[0]?.[0], 't')).toBe('auth-world-3');
  });
});

describe('net.state', () => {
  // State is polled rather than pushed, so it has to track even when no addon
  // has subscribed to anything.
  it('tracks with nothing subscribed', () => {
    h.inbound(HELLO_FRAME);

    expect(h.net.state).toMatchObject({ connected: true, pid: 661 });
  });

  it('reads live rather than being captured once', () => {
    const before = h.net.state;
    h.inbound(HELLO_FRAME);

    expect(before.connected).toBe(false);
    expect(h.net.state.connected).toBe(true);
  });
});

describe('net.waitFor', () => {
  it('resolves on the next frame of the type', async () => {
    const pending = h.net.waitFor('hello');
    h.inbound(HELLO_FRAME);

    await expect(pending).resolves.toMatchObject({ t: 'hello' });
  });

  it('rejects on timeout', async () => {
    const pending = h.net.waitFor('hello', { timeout: 10 });
    h.runTimers();

    await expect(pending).rejects.toThrow(TIMED_OUT);
  });

  it('does not reject after it resolved', async () => {
    const pending = h.net.waitFor('hello', { timeout: 10 });
    h.inbound(HELLO_FRAME);
    h.runTimers();

    await expect(pending).resolves.toBeDefined();
  });

  it('unsubscribes once resolved rather than holding the topic open', async () => {
    const pending = h.net.waitFor('hello');
    h.inbound(HELLO_FRAME);
    await pending;

    expect(h.bag.size).toBe(0);
  });
});
