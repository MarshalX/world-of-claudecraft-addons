// The runtime's one door to GM storage.
//
// Its whole job is routing: the host reports a change once, as a single event
// carrying a namespace, and something has to turn that into "this addon's
// settings moved". Everything asserted here is about that fan-out and about the
// disconnected case, which must reject rather than answer an empty store.

import { describe, expect, it, vi } from 'vitest';
import { createStorageHub } from '../loader/src/runtime/storage/hub.ts';
import type { StorageApi } from '../loader/src/shared/protocol.ts';

function remote(): StorageApi & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    get: (ns, key) => {
      calls.push(`get ${ns} ${key}`);
      return Promise.resolve('value');
    },
    set: (ns, key) => {
      calls.push(`set ${ns} ${key}`);
      return Promise.resolve();
    },
    delete: (ns, key) => {
      calls.push(`delete ${ns} ${key}`);
      return Promise.resolve();
    },
    keys: (ns) => {
      calls.push(`keys ${ns}`);
      return Promise.resolve(['a']);
    },
  };
}

describe('the storage hub with a bridge', () => {
  it('forwards every call to the host', async () => {
    const api = remote();
    const hub = createStorageHub(api);

    expect(await hub.get('addon:x', 'k')).toBe('value');
    await hub.set('addon:x', 'k', 1);
    await hub.delete('addon:x', 'k');
    expect(await hub.keys('addon:x')).toEqual(['a']);

    expect(api.calls).toEqual([
      'get addon:x k',
      'set addon:x k',
      'delete addon:x k',
      'keys addon:x',
    ]);
    expect(hub.connected).toBe(true);
  });

  it('delivers a change only to handlers on that namespace', () => {
    const hub = createStorageHub(remote());
    const mine = vi.fn();
    const theirs = vi.fn();
    hub.onChange('config:a', mine);
    hub.onChange('config:b', theirs);

    hub.deliver('config:a', 'values', { window: 5 });

    expect(mine).toHaveBeenCalledWith('values', { window: 5 });
    expect(theirs).not.toHaveBeenCalled();
  });

  it('delivers to every handler on one namespace', () => {
    const hub = createStorageHub(remote());
    const first = vi.fn();
    const second = vi.fn();
    hub.onChange('config:a', first);
    hub.onChange('config:a', second);

    hub.deliver('config:a', 'values', 1);

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it('stops delivering after unsubscribe', () => {
    const hub = createStorageHub(remote());
    const handler = vi.fn();
    const off = hub.onChange('config:a', handler);

    off();
    hub.deliver('config:a', 'values', 1);

    expect(handler).not.toHaveBeenCalled();
  });

  // A handler is allowed to unsubscribe itself, which mutating the live set
  // mid-iteration would turn into a skipped neighbour.
  it('delivers to every handler even when one unsubscribes itself', () => {
    const hub = createStorageHub(remote());
    const second = vi.fn();
    const off = hub.onChange('config:a', () => {
      off();
    });
    hub.onChange('config:a', second);

    hub.deliver('config:a', 'values', 1);

    expect(second).toHaveBeenCalledOnce();
  });

  // One addon's throwing handler must not cost every other addon the change.
  it('keeps delivering after a handler throws', () => {
    const hub = createStorageHub(remote());
    const after = vi.fn();
    hub.onChange('config:a', () => {
      throw new Error('addon handler blew up');
    });
    hub.onChange('config:a', after);

    expect(() => {
      hub.deliver('config:a', 'values', 1);
    }).not.toThrow();
    expect(after).toHaveBeenCalledOnce();
  });

  it('ignores a change on a namespace nobody is watching', () => {
    const hub = createStorageHub(remote());

    expect(() => {
      hub.deliver('config:nobody', 'values', 1);
    }).not.toThrow();
  });
});

describe('the storage hub with no bridge', () => {
  // Rejecting, not resolving undefined. An addon that read an empty store would
  // treat it as first-run state and overwrite the player's real data on the
  // next session that does connect.
  it.each([
    ['get', (hub: ReturnType<typeof createStorageHub>) => hub.get('ns', 'k')],
    ['set', (hub: ReturnType<typeof createStorageHub>) => hub.set('ns', 'k', 1)],
    ['delete', (hub: ReturnType<typeof createStorageHub>) => hub.delete('ns', 'k')],
    ['keys', (hub: ReturnType<typeof createStorageHub>) => hub.keys('ns')],
  ])('rejects %s rather than answering an empty store', async (member, call) => {
    const hub = createStorageHub(null);

    await expect(call(hub)).rejects.toThrow(new RegExp(`storage\\.${member}`));
    expect(hub.connected).toBe(false);
  });

  it('says the host is the missing half, not the key', async () => {
    await expect(createStorageHub(null).get('ns', 'k')).rejects.toThrow('never connected');
  });
});
