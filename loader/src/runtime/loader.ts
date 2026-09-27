// Per-addon lifecycle: build the API, hydrate it, evaluate the source, return the one undo.
// Addon source is a function BODY with `woc` in scope; everything it creates lands in its disposal
// bag, which is what makes disable hot. Hydration precedes evaluation.

import { describeError } from '../shared/diag.ts';
import type { InstalledAddon } from '../shared/protocol.ts';
import { type AddonApi, createAddonApi, type SharedServices } from './api/index.ts';
import { DisposalBag } from './disposal.ts';
import { createShadows } from './shadow.ts';

/** Names the addon in devtools and stack traces instead of `<anonymous>`. */
function sourceUrl(fqid: string): string {
  return `\n//# sourceURL=woc-addon://${fqid}`;
}

/**
 * Strict mode is prepended, or an undeclared assignment becomes a global on the page every addon
 * and the game share.
 */
function compile(
  fqid: string,
  source: string,
  names: readonly string[],
): (...args: unknown[]) => void {
  return new Function(...names, 'woc', `'use strict';\n${source}${sourceUrl(fqid)}`) as (
    ...args: unknown[]
  ) => void;
}

interface LoadedAddon {
  fqid: string;
  api: AddonApi;
  /** Drain the bag. Idempotent, and safe to call on an addon that never ran. */
  dispose: () => void;
}

interface LoadRequest {
  shared: SharedServices;
  row: InstalledAddon;
  source: string;
}

/** Drains the bag before rejecting, so a half-built addon leaves no frame or keybind behind. */
async function loadAddon(request: LoadRequest): Promise<LoadedAddon> {
  const { shared, row, source } = request;
  const bag = new DisposalBag();
  const api = createAddonApi(shared, {
    manifest: row.manifest,
    fqid: row.fqid,
    marketplace: row.marketplace,
    bag,
  });

  const dispose = (): void => {
    bag.dispose();
  };

  try {
    await api.hydrate();
    const shadows = createShadows();
    compile(row.fqid, source, shadows.names)(...shadows.values, api.woc);
  } catch (err) {
    dispose();
    throw new Error(`${row.fqid} failed to load: ${describeError(err)}`, { cause: err });
  }

  return { fqid: row.fqid, api, dispose };
}

export type { LoadedAddon, LoadRequest };
export { loadAddon };
