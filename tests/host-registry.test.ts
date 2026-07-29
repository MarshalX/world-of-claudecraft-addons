// The registry's state half, over a storage stand-in.
//
// The persisted blob is untrusted input: it lives in GM storage, which the
// player can edit and which an older loader may have written differently.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRegistry, type RegistryStorage } from '../loader/src/host/registry.ts';
import type { InstalledAddon } from '../loader/src/shared/protocol.ts';
import { type CapturedDiag, captureDiag } from './fakes/diag.ts';

const NS = 'loader';
const KEY = 'installed';
const FQID = 'official/minimap';
const NOT_INSTALLED = /not installed/;

function addon(overrides: Partial<InstalledAddon> = {}): InstalledAddon {
  return {
    fqid: FQID,
    marketplace: 'official',
    enabled: true,
    pin: null,
    manifest: {
      id: 'minimap',
      name: 'Better Minimap',
      version: '1.2.0',
      apiVersion: 1,
      author: 'MarshalX',
      description: 'A better minimap.',
      entry: 'main.js',
    },
    ...overrides,
  };
}

function memoryStorage(seed?: unknown) {
  const cell = { value: seed };
  const storage: RegistryStorage = {
    get: () => Promise.resolve(cell.value),
    set: (_ns, _key, value) => {
      cell.value = value;
      return Promise.resolve();
    },
  };
  return { storage, cell };
}

// The corrupt-record cases report through the diagnostic channel by design.
let diag: CapturedDiag;

beforeEach(() => {
  diag = captureDiag();
});

afterEach(() => {
  diag.restore();
});

describe('reading the installed set', () => {
  it('reads an unwritten store as empty', async () => {
    const { storage } = memoryStorage();

    await expect(createRegistry({ storage, onChanged: vi.fn() }).list()).resolves.toEqual([]);
  });

  it('round-trips a valid record', async () => {
    const { storage } = memoryStorage([addon()]);

    await expect(createRegistry({ storage, onChanged: vi.fn() }).list()).resolves.toEqual([
      addon(),
    ]);
  });

  // One bad record must not hide every good one, and the loss has to be
  // reported rather than swallowed.
  it('drops an unreadable record and keeps the rest', async () => {
    const good = addon({ fqid: 'official/keeper' });
    const { storage } = memoryStorage([{ fqid: 'official/broken' }, good]);

    const rows = await createRegistry({ storage, onChanged: vi.fn() }).list();

    expect(rows).toEqual([good]);
    expect(diag.errors()).toHaveLength(1);
  });

  // A manifest that no longer parses is as unreadable as a missing one: the
  // manager renders the manifest, so a half-valid row would render blanks.
  it('drops a record whose manifest no longer validates', async () => {
    const { storage } = memoryStorage([addon({ manifest: { name: 'no id' } as never })]);

    await expect(createRegistry({ storage, onChanged: vi.fn() }).list()).resolves.toEqual([]);
  });

  it('reads a store holding something that is not a list as empty', async () => {
    const { storage } = memoryStorage({ notAnArray: true });

    await expect(createRegistry({ storage, onChanged: vi.fn() }).list()).resolves.toEqual([]);
  });
});

describe('setting the enable state', () => {
  it('persists the flip and reports the change', async () => {
    const { storage, cell } = memoryStorage([addon({ enabled: true })]);
    const onChanged = vi.fn();

    await createRegistry({ storage, onChanged }).setEnabled(FQID, false);

    expect(cell.value).toEqual([addon({ enabled: false })]);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  // A no-op write still wakes every other tab through the value-change
  // listener, so the already-in-that-state case must not touch storage.
  it('writes nothing when the state already matches', async () => {
    const { storage } = memoryStorage([addon({ enabled: true })]);
    const set = vi.spyOn(storage, 'set');
    const onChanged = vi.fn();

    await createRegistry({ storage, onChanged }).setEnabled(FQID, true);

    expect(set).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
  });

  // Silently doing nothing would leave the manager showing a toggle that never
  // takes, with no way to tell that from a slow write.
  it('rejects an addon that is not installed', async () => {
    const { storage } = memoryStorage([]);

    await expect(
      createRegistry({ storage, onChanged: vi.fn() }).setEnabled('official/ghost', true),
    ).rejects.toThrow(NOT_INSTALLED);
  });

  it('leaves the other records untouched', async () => {
    const other = addon({ fqid: 'official/other', enabled: true });
    const { storage, cell } = memoryStorage([addon({ enabled: true }), other]);

    await createRegistry({ storage, onChanged: vi.fn() }).setEnabled(FQID, false);

    expect(cell.value).toEqual([addon({ enabled: false }), other]);
  });
});

describe('the members that are not built', () => {
  it.each(['install', 'uninstall', 'update', 'source'] as const)(
    'rejects %s rather than answering emptily',
    async (member) => {
      const { storage } = memoryStorage();
      const registry = createRegistry({ storage, onChanged: vi.fn() });

      await expect(registry[member](FQID)).rejects.toThrow(`not implemented: registry.${member}`);
    },
  );
});

describe('the storage location', () => {
  // Pinned because the key is what an existing install is found under: changing
  // it silently empties every player's registry.
  it('reads and writes the loader namespace', async () => {
    const seen: [string, string][] = [];
    const storage: RegistryStorage = {
      get: (ns, key) => {
        seen.push([ns, key]);
        return Promise.resolve([addon()]);
      },
      set: (ns, key) => {
        seen.push([ns, key]);
        return Promise.resolve();
      },
    };

    await createRegistry({ storage, onChanged: vi.fn() }).setEnabled(FQID, false);

    expect(seen).toEqual([
      [NS, KEY],
      [NS, KEY],
    ]);
  });
});
