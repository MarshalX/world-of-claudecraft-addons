// @vitest-environment happy-dom

// A setting changed in the manager reaching an addon that is already running, end to end. If
// this is green, an addon that misses a change is caching `woc.settings` at load.

import { describe, expect, it } from 'vitest';
import { configNamespace, SETTINGS_KEY } from '../loader/src/shared/storage-keys.ts';
import { mountAddon } from './fakes/addon.ts';
import { createFakeStorage } from './fakes/storage.ts';

const FQID = 'official/probe';

const MANIFEST = JSON.stringify({
  id: 'probe',
  name: 'Probe',
  version: '1.0.0',
  apiVersion: 1,
  apiMinor: 1,
  author: 'MarshalX',
  description: 'Reads a setting at the point of use, as an addon should.',
  entry: 'main.js',
  settings: [
    { id: 'cue', type: 'boolean', label: 'Cue', default: true },
    { id: 'rows', type: 'number', label: 'Rows', default: 5, min: 1, max: 20 },
  ],
});

/** `live()` reads at the point of use; `cached` is read once at load, the addon-side mistake. */
const SOURCE = `
  const seen = [];
  const cached = woc.settings.cue;
  globalThis.__probe = {
    live: () => woc.settings.cue,
    rows: () => woc.settings.rows,
    cached: () => cached,
    seen,
  };
  woc.onSettingsChange((values) => {
    seen.push(values.cue);
  });
`;

interface Probe {
  live: () => unknown;
  rows: () => unknown;
  cached: () => unknown;
  seen: unknown[];
}

function probe(): Probe {
  return (globalThis as unknown as { __probe: Probe }).__probe;
}

async function start() {
  const storage = createFakeStorage();
  const harness = await mountAddon({ manifest: MANIFEST, source: SOURCE, storage });
  return { harness, storage };
}

/** What the manager does when the player moves a control. */
async function managerWrites(
  storage: ReturnType<typeof createFakeStorage>,
  values: Record<string, unknown>,
): Promise<void> {
  await storage.set(configNamespace(FQID), SETTINGS_KEY, values);
}

describe('a setting changed while the addon is running', () => {
  it('reaches a read taken at the point of use', async () => {
    const { harness, storage } = await start();
    try {
      expect(probe().live()).toBe(true);

      await managerWrites(storage, { cue: false });

      expect(probe().live()).toBe(false);
    } finally {
      harness.dispose();
    }
  });

  it('notifies a subscriber', async () => {
    const { harness, storage } = await start();
    try {
      await managerWrites(storage, { cue: false });

      expect(probe().seen).toEqual([false]);
    } finally {
      harness.dispose();
    }
  });

  // A value read once at load looks to the player exactly like a loader that never delivered.
  it('does NOT reach a value the addon read once at load', async () => {
    const { harness, storage } = await start();
    try {
      await managerWrites(storage, { cue: false });

      expect(probe().cached()).toBe(true);
      expect(probe().live()).toBe(false);
    } finally {
      harness.dispose();
    }
  });

  // The store re-hydrates a partial record from the declarations.
  it('leaves an untouched setting at its default rather than undefined', async () => {
    const { harness, storage } = await start();
    try {
      await managerWrites(storage, { cue: false });

      expect(probe().rows()).toBe(5);
    } finally {
      harness.dispose();
    }
  });
});
