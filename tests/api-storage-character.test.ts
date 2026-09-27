// woc.storage.character. An addon's first line runs on the landing page, where there is
// no character and so no key; reads wait for one and writes refuse.

import { describe, expect, it } from 'vitest';
import { createStorage } from '../loader/src/runtime/api/storage.ts';
import { createCharacterStorage } from '../loader/src/runtime/api/storage-character.ts';
import { characterNamespace, perCharacterKey } from '../loader/src/shared/storage-keys.ts';
import { createFakeStorage, type FakeStorage } from './fakes/storage.ts';

const FQID = 'official/combat-meter';
const ME = 'Claudemoon/Marshal';
const ALT = 'Claudemoon/Alt';

/** A world that has already been entered, which is every case but one block. */
function inWorld(hub: FakeStorage, who: string = ME) {
  return createCharacterStorage({
    hub,
    fqid: FQID,
    channel: 'pbe',
    character: () => who,
    known: () => Promise.resolve(),
  });
}

/** The landing page: no character until the test calls `enter`. */
function beforeWorld(hub: FakeStorage) {
  let who: string | null = null;
  let arrive = (): void => undefined;
  const known = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  return {
    storage: createCharacterStorage({
      hub,
      fqid: FQID,
      channel: 'pbe',
      character: () => who,
      known: () => known,
    }),
    enter: (name: string = ME) => {
      who = name;
      arrive();
    },
  };
}

describe('the per-character store', () => {
  it('round-trips a value', async () => {
    const storage = inWorld(createFakeStorage());

    await storage.set('layout', { x: 20 });

    expect(await storage.get('layout')).toEqual({ x: 20 });
  });

  it('answers the fallback for a key this character never wrote', async () => {
    const storage = inWorld(createFakeStorage());

    expect(await storage.get('missing', 'default')).toBe('default');
  });

  it('answers a stored null rather than the fallback', async () => {
    const storage = inWorld(createFakeStorage());
    await storage.set('cleared', null);

    expect(await storage.get('cleared', 'default')).toBeNull();
  });

  it('deletes', async () => {
    const storage = inWorld(createFakeStorage());
    await storage.set('layout', 1);

    await storage.delete('layout');

    expect(await storage.get('layout', 'gone')).toBe('gone');
  });

  // Changing the derivation strands every value already written under the old one.
  it('writes under the channel and character, in its own namespace', async () => {
    const hub = createFakeStorage();

    await inWorld(hub).set('layout', 1);

    expect(Object.keys(hub.dump())).toEqual([
      `${characterNamespace(FQID)}/${perCharacterKey('pbe', ME, 'layout')}`,
    ]);
  });
});

describe('what it is separate from', () => {
  it('keeps two characters on one account apart', async () => {
    const hub = createFakeStorage();

    await inWorld(hub, ME).set('layout', 'mine');
    await inWorld(hub, ALT).set('layout', 'theirs');

    expect(await inWorld(hub, ME).get('layout')).toBe('mine');
    expect(await inWorld(hub, ALT).get('layout')).toBe('theirs');
  });

  it('is a different value from the account-wide key of the same name', async () => {
    const hub = createFakeStorage();
    const storage = createStorage({
      hub,
      fqid: FQID,
      channel: 'pbe',
      character: () => ME,
      known: () => Promise.resolve(),
    });

    await storage.set('layout', 'account');
    await storage.character.set('layout', 'character');

    expect(await storage.get('layout')).toBe('account');
    expect(await storage.character.get('layout')).toBe('character');
  });

  // A raw listing would also leak the names of the account's other characters.
  it("lists this character's keys only, without the derivation", async () => {
    const hub = createFakeStorage();
    await inWorld(hub, ALT).set('theirs', 1);
    const mine = inWorld(hub, ME);
    await mine.set('a', 1);
    await mine.set('b', 2);

    expect([...(await mine.keys())].sort((a, b) => a.localeCompare(b))).toEqual(['a', 'b']);
  });
});

describe('before world entry', () => {
  it('holds a read until there is a character, then answers for them', async () => {
    const hub = createFakeStorage();
    await inWorld(hub, ALT).set('layout', 'the alt');
    const { storage, enter } = beforeWorld(hub);

    const pending = storage.get('layout');
    enter(ALT);

    expect(await pending).toBe('the alt');
  });

  it('holds a listing the same way', async () => {
    const hub = createFakeStorage();
    await inWorld(hub, ME).set('layout', 1);
    const { storage, enter } = beforeWorld(hub);

    const pending = storage.keys();
    enter(ME);

    expect(await pending).toEqual(['layout']);
  });

  // A held write would land a value computed for nobody on whoever logs in next.
  it('refuses a write rather than holding it', async () => {
    const { storage } = beforeWorld(createFakeStorage());

    await expect(storage.set('layout', 1)).rejects.toThrow(/before world entry/);
  });

  it('refuses a delete for the same reason', async () => {
    const { storage } = beforeWorld(createFakeStorage());

    await expect(storage.delete('layout')).rejects.toThrow(/before world entry/);
  });

  it('names the gate to await in the message', async () => {
    const { storage } = beforeWorld(createFakeStorage());

    await expect(storage.set('layout', 1)).rejects.toThrow(/world\.ready/);
  });

  it('rejects rather than throwing where the addon called it', () => {
    const { storage } = beforeWorld(createFakeStorage());

    expect(() => {
      storage.set('layout', 1).catch(() => undefined);
    }).not.toThrow();
  });

  it('writes nothing at all when it refuses', async () => {
    const hub = createFakeStorage();
    const { storage } = beforeWorld(hub);

    await expect(storage.set('layout', 1)).rejects.toThrow();

    expect(hub.dump()).toEqual({});
  });
});
