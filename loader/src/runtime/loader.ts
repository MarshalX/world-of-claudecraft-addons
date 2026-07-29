// Per-addon lifecycle: build the API, hydrate it, evaluate the source, and hand
// back the one function that undoes all of it.
//
// Addon source is a function BODY, not a module. There is no export to call and
// no registration step: the file runs top to bottom with `woc` in scope, and
// everything it creates through that object is already registered in this
// addon's disposal bag by the time the last line runs. That is what makes
// disable hot, and it is why an addon needs no cleanup code of its own.
//
// Settings and keybinds are hydrated BEFORE evaluation, so `woc.settings.window`
// on the addon's first line is the player's stored value rather than the default
// it would briefly be if hydration raced the code.

import { describeError } from '../shared/diag.ts';
import type { InstalledAddon } from '../shared/protocol.ts';
import { type AddonApi, createAddonApi, type SharedServices } from './api/index.ts';
import { DisposalBag } from './disposal.ts';
import { createShadows } from './shadow.ts';

/**
 * Makes the addon show up in devtools and in stack traces under its own name
 * rather than as `<anonymous>`, which is otherwise what a `new Function` body is
 * called in every trace an addon author will ever be sent.
 */
function sourceUrl(fqid: string): string {
  return `\n//# sourceURL=woc-addon://${fqid}`;
}

/**
 * Compile the body.
 *
 * Strict mode is prepended rather than left to the author. A sloppy-mode
 * function body turns an undeclared assignment into a property of the page's
 * global object, which is one addon's typo becoming another addon's mystery
 * variable, and the game's page is shared with the game.
 *
 * A syntax error surfaces here, at compile, with the addon's own name attached.
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

/**
 * Evaluate one addon.
 *
 * Rejects with a described error if the source does not compile or throws while
 * running, and drains the bag before it does, so a partially-constructed addon
 * never leaves a frame or a keybind behind. The caller decides what a failure
 * means for the enable flag; this function only guarantees it leaves nothing
 * running.
 */
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
