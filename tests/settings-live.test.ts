// @vitest-environment happy-dom

// A setting changed in the manager reaching an addon that is already running.
//
// Every part of this path is tested somewhere else: `settings-store.test.ts`
// covers a store taking another tab's write, `manager-config.test.ts` covers the
// pane, and `storage-hub.test.ts` covers the fan-out. What none of them covers is
// the whole path with a real addon on the end of it, which is the only shape a
// player ever meets.
//
// It earned a file when a live session reported that a setting "did not apply".
// The suite exists to answer that question with something other than an opinion:
// if this is green, an addon that misses a change is missing it in its own code,
// and the place to look is whether it reads `woc.settings` at the point of use or
// caches it at load.
//
// The manager writes the whole record to `config:<fqid>`/`values`, which is what
// this drives, so this is the manager's write and not an imitation of it.

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

/**
 * Two readers, deliberately different, because they fail differently.
 *
 * `live()` reads at the point of use, which is what the shipped addons do through
 * their `settingFlag` helpers. `cached` is read once while the body runs, which is
 * the mistake this suite exists to tell apart from a broken loader.
 */
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

  // The failure mode this suite exists to distinguish from a loader defect. An
  // addon that reads once while its body runs holds that value forever, and the
  // symptom a player reports is identical to the loader never delivering.
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

  // A partial record is what the manager writes when only one control moved, and
  // the store re-hydrates from declarations rather than trusting it, so the other
  // setting has to come back as its default rather than as undefined.
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
