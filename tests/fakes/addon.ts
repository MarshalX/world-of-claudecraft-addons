// Starts one addon through the real loader; every addon's own suite begins here. It parses the
// real `addon.json` through the CI schema, seeds settings before evaluating (the body reads
// `woc.settings` while building its first frame), and hands back one `dispose` for both teardowns.

import { type LoadedAddon, loadAddon } from '../../loader/src/runtime/loader.ts';
import type { InstalledAddon } from '../../loader/src/shared/protocol.ts';
import { type AddonManifest, validateManifest } from '../../loader/src/shared/schema.ts';
import { configNamespace, SETTINGS_KEY } from '../../loader/src/shared/storage-keys.ts';
import { createSharedServices, type SharedHarness, type SharedOptions } from './shared-services.ts';
import { createFakeStorage, type FakeStorage } from './storage.ts';

/** What the official marketplace is called, which is half of every fqid here. */
const DEFAULT_MARKETPLACE = 'official';

interface MountInput {
  /** The addon.json text, imported with `?raw`, so it goes through the real validator. */
  manifest: string;
  /** The addon body, imported with `?raw`. It is a function BODY, not a module. */
  source: string;
  /** The `__game` handle. Omit it to test what the addon does before world entry. */
  game?: Promise<unknown>;
  /** Stored settings, seeded before the body is evaluated. */
  settings?: Record<string, unknown>;
  /**
   * Data files as raw text keyed by declared path, seeded before evaluation: `api/data.ts` never
   * retries a rejected read, so a file seeded afterwards is never seen.
   */
  data?: Record<string, string>;
  /** Pass one in to seed other namespaces first, or to assert on it afterwards. */
  storage?: FakeStorage;
  marketplace?: string;
  /** What the loader measures the screen as. See SharedOptions for why it is not patchable. */
  viewport?: () => { w: number; h: number };
  /** The camera: where a world point lands, and where a unit is. See SharedOptions. */
  project?: SharedOptions['project'];
  unitPoint?: SharedOptions['unitPoint'];
  /** How the art manifests are read. Defaults to a promise that never settles. */
  fetchJson?: SharedOptions['fetchJson'];
  /** The game's minimap label, which `world.zone` answers. Defaults to null. */
  zoneName?: SharedOptions['zoneName'];
}

interface AddonHarness extends SharedHarness {
  addon: LoadedAddon;
  /** `<marketplace>/<id>`, which is the storage namespace and the keybind scope. */
  fqid: string;
  /** The validated manifest, so a suite can assert against what it declares. */
  manifest: AddonManifest;
}

/** The manifest as the loader would accept it, or a failure naming what is wrong. */
function parseManifest(text: string): AddonManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`addon.json is not valid JSON: ${String(err)}`, { cause: err });
  }
  const result = validateManifest(parsed);
  if (!result.ok) {
    throw new Error(`addon.json is invalid: ${JSON.stringify(result.issues)}`);
  }
  return result.value;
}

function installedRow(manifest: AddonManifest, marketplace: string): InstalledAddon {
  return {
    fqid: `${marketplace}/${manifest.id}`,
    marketplace,
    manifest,
    enabled: true,
    pin: null,
  };
}

/**
 * Evaluate one addon against real shared services, in a happy-dom document.
 *
 * The suite that calls this declares `// @vitest-environment happy-dom`, since
 * everything below needs a document.
 *
 * ```ts
 * const harness = await mountAddon({ manifest: MANIFEST, source: SOURCE, game });
 * try {
 *   harness.shared.world.watcher.poll();
 *   expect(document.querySelectorAll('.woc-bar')).toHaveLength(3);
 * } finally {
 *   harness.dispose();
 * }
 * ```
 */
async function mountAddon(input: MountInput): Promise<AddonHarness> {
  const manifest = parseManifest(input.manifest);
  const marketplace = input.marketplace ?? DEFAULT_MARKETPLACE;
  const row = installedRow(manifest, marketplace);
  const storage = input.storage ?? createFakeStorage();
  if (input.settings !== undefined) {
    await storage.set(configNamespace(row.fqid), SETTINGS_KEY, input.settings);
  }

  // Assigned one at a time: `exactOptionalPropertyTypes` refuses `{ game: undefined }`.
  const options: SharedOptions = {};
  if (input.game !== undefined) {
    options.game = input.game;
  }
  if (input.viewport !== undefined) {
    options.viewport = input.viewport;
  }
  if (input.project !== undefined) {
    options.project = input.project;
  }
  if (input.unitPoint !== undefined) {
    options.unitPoint = input.unitPoint;
  }
  if (input.fetchJson !== undefined) {
    options.fetchJson = input.fetchJson;
  }
  if (input.zoneName !== undefined) {
    options.zoneName = input.zoneName;
  }
  const shared: SharedHarness = createSharedServices(document, storage, options);
  for (const [name, text] of Object.entries(input.data ?? {})) {
    shared.addonData(row.fqid, name, text);
  }

  let addon: LoadedAddon;
  try {
    addon = await loadAddon({ shared: shared.shared, row, source: input.source });
  } catch (err) {
    // The addon's bag is already drained; tear down the shared services so nothing leaks.
    shared.dispose();
    throw err;
  }

  return {
    ...shared,
    addon,
    fqid: row.fqid,
    manifest,
    // The addon first, so its frames are gone before the root they sit in is.
    dispose: () => {
      addon.dispose();
      shared.dispose();
    },
  };
}

export type { AddonHarness, MountInput };
export { mountAddon, parseManifest };
