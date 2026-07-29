// The woc.storage surface.
//
// An addon sees plain keys and never a namespace. That is not tidiness: the
// namespace is what stops one addon reading or overwriting another's data by
// naming its key, and it is bound here rather than passed in so an addon cannot
// choose it.

import { describe, expect, it } from 'vitest';
import { createStorage } from '../loader/src/runtime/api/storage.ts';
import { addonNamespace, configNamespace } from '../loader/src/shared/storage-keys.ts';
import { createFakeStorage } from './fakes/storage.ts';

const FQID = 'official/combat-meter';
const OTHER = 'official/cooldown-bars';

describe('the addon key-value store', () => {
  it('round-trips a value', async () => {
    const hub = createFakeStorage();
    const storage = createStorage(hub, FQID);

    await storage.set('history', [1, 2, 3]);

    expect(await storage.get('history')).toEqual([1, 2, 3]);
  });

  it('namespaces by fqid, so two addons cannot collide on a key', async () => {
    const hub = createFakeStorage();
    const mine = createStorage(hub, FQID);
    const theirs = createStorage(hub, OTHER);

    await mine.set('state', 'mine');
    await theirs.set('state', 'theirs');

    expect(await mine.get('state')).toBe('mine');
    expect(await theirs.get('state')).toBe('theirs');
  });

  it('writes into the addon namespace and nowhere else', async () => {
    const hub = createFakeStorage();

    await createStorage(hub, FQID).set('state', 1);

    expect(Object.keys(hub.dump())).toEqual([`${addonNamespace(FQID)}/state`]);
  });

  it('answers the fallback for a key never written', async () => {
    const storage = createStorage(createFakeStorage(), FQID);

    expect(await storage.get('missing', 'default')).toBe('default');
    expect(await storage.get('missing')).toBeUndefined();
  });

  // A stored null is a value the addon chose. Only an absent key falls back.
  it('answers a stored null rather than the fallback', async () => {
    const storage = createStorage(createFakeStorage(), FQID);
    await storage.set('cleared', null);

    expect(await storage.get('cleared', 'default')).toBeNull();
  });

  it('deletes', async () => {
    const storage = createStorage(createFakeStorage(), FQID);
    await storage.set('state', 1);

    await storage.delete('state');

    expect(await storage.get('state', 'gone')).toBe('gone');
  });

  it("lists this addon's own keys, without the namespace", async () => {
    const storage = createStorage(createFakeStorage(), FQID);
    await storage.set('a', 1);
    await storage.set('b', 2);

    expect([...(await storage.keys())].sort((a, b) => a.localeCompare(b))).toEqual(['a', 'b']);
  });

  // The reason settings and keybinds live in their own namespace: an addon
  // calling storage.set('values', ...) would otherwise become the addon whose
  // settings never persist, and keys() would report loader data as its own.
  it('does not see loader-owned config, and cannot overwrite it', async () => {
    const hub = createFakeStorage();
    await hub.set(configNamespace(FQID), 'values', { window: 5 });
    const storage = createStorage(hub, FQID);

    await storage.set('values', 'addon data');

    expect(await storage.keys()).toEqual(['values']);
    expect(hub.dump()[`${configNamespace(FQID)}/values`]).toEqual({ window: 5 });
  });

  it("does not list another addon's keys", async () => {
    const hub = createFakeStorage();
    await createStorage(hub, OTHER).set('theirs', 1);

    expect(await createStorage(hub, FQID).keys()).toEqual([]);
  });

  it('rejects rather than answering an empty store with no bridge', async () => {
    const storage = createStorage(createFakeStorage({ connected: false }), FQID);

    await expect(storage.get('state')).rejects.toThrow();
    await expect(storage.set('state', 1)).rejects.toThrow();
  });
});
