// Starting one addon through the real loader, which is the first thing every
// addon's own suite does.
//
// It lives here rather than in an addon directory because it is shared by all of
// them and because it reaches into the loader, which an addon directory must not
// have an opinion about: a third-party marketplace copies `addons/<id>/` and gets
// the addon and its suite, and the suite simply does not run without this repo
// around it.
//
// Three things are deliberate about what it does.
//
// It parses the REAL `addon.json` rather than taking a hand-written object. The
// manifest is validated by the same schema CI runs, so a suite that passes proves
// the shipped manifest is loadable, and a manifest that stops validating fails the
// addon's own suite rather than only the index build.
//
// It seeds settings BEFORE evaluating. The loader hydrates settings and then runs
// the body, and an addon reads `woc.settings` while building its first frame, so a
// value written afterwards is a value the addon never saw.
//
// It hands back ONE `dispose`. The shared services and the addon are separate
// teardowns and forgetting either leaks a listener into the next case, which shows
// up as an unrelated suite failing later.

import { type LoadedAddon, loadAddon } from '../../loader/src/runtime/loader.ts';
import type { InstalledAddon } from '../../loader/src/shared/protocol.ts';
import { type AddonManifest, validateManifest } from '../../loader/src/shared/schema.ts';
import { configNamespace, SETTINGS_KEY } from '../../loader/src/shared/storage-keys.ts';
import { createSharedServices, type SharedHarness, type SharedOptions } from './shared-services.ts';
import { createFakeStorage, type FakeStorage } from './storage.ts';

/** What the official marketplace is called, which is half of every fqid here. */
const DEFAULT_MARKETPLACE = 'official';

interface MountInput {
  /**
   * The addon.json text, imported with `?raw`.
   *
   * Text rather than a parsed object so the manifest goes through the real
   * validator on the way in.
   */
  manifest: string;
  /** The addon body, imported with `?raw`. It is a function BODY, not a module. */
  source: string;
  /**
   * The `__game` handle, resolved when the suite wants a world.
   *
   * Left out entirely for a suite about what an addon does BEFORE world entry,
   * which is where every addon's first line actually runs.
   */
  game?: Promise<unknown>;
  /** Stored settings, seeded before the body is evaluated. */
  settings?: Record<string, unknown>;
  /**
   * Data files as the host's install-time cache holds them: raw TEXT keyed by
   * the path the manifest declared, not a parsed value.
   *
   * Seeded before the body is evaluated, for the same reason `settings` is one
   * line up. An addon carrying a table reads `woc.data` on its first line, and
   * `api/data.ts` drops a REJECTED read from its memo rather than retrying, so a
   * file seeded afterwards is not merely late: nothing ever recovers from it.
   */
  data?: Record<string, string>;
  /** Pass one in to seed other namespaces first, or to assert on it afterwards. */
  storage?: FakeStorage;
  marketplace?: string;
  /**
   * What the loader measures the screen as. Defaults to the fixed fake viewport.
   *
   * Forwarded rather than patched afterwards: `api/bind.ts` copies it by
   * reference when the addon's surface is assembled. See SharedOptions.
   */
  viewport?: () => { w: number; h: number };
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

  // Built up rather than passed as one literal: `exactOptionalPropertyTypes`
  // refuses `{ game: undefined }` for an optional property, so every option is
  // assigned only once it is known to be there.
  const options: SharedOptions = {};
  if (input.game !== undefined) {
    options.game = input.game;
  }
  if (input.viewport !== undefined) {
    options.viewport = input.viewport;
  }
  const shared: SharedHarness = createSharedServices(document, storage, options);
  for (const [name, text] of Object.entries(input.data ?? {})) {
    shared.addonData(row.fqid, name, text);
  }

  let addon: LoadedAddon;
  try {
    addon = await loadAddon({ shared: shared.shared, row, source: input.source });
  } catch (err) {
    // The addon threw while loading, so its own bag is already drained. What is
    // still standing is everything shared, and leaving that up would leak a key
    // listener and a tooltip observer into whatever runs next.
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
