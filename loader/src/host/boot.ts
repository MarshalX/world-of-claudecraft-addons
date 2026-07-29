// Sandbox bootstrap: build the host services, then hand the runtime a port.

import { expose } from 'comlink';
// biome-ignore lint/correctness/noUnresolvedImports: loader/build-runtime.mjs generates this file and Vite's ?raw suffix is a loader directive, neither of which a static resolver models
import runtimeSource from '../generated/runtime.iife.js?raw';
import { diagError } from '../shared/diag.ts';
import { createNonce, type MessageScope } from '../shared/handshake.ts';
import { isGameHost } from '../shared/hosts.ts';
import { createHostApi } from './api.ts';
import { readGmSource } from './globals.ts';
import { createGmAdapter } from './gm.ts';
import { connectRuntime } from './handshake.ts';
import { createHostStorage } from './storage.ts';

/**
 * The userscript popup entry, and deliberately not localized.
 *
 * It renders in the manager's own chrome rather than in the game, so it is
 * outside the game's language setting either way.
 */
const MENU_COMMAND_LABEL = 'Open the Addons manager';

export interface HostScope extends MessageScope {
  readonly crypto: Pick<Crypto, 'getRandomValues'>;
  readonly document: Document;
  readonly setTimeout: (handler: () => void, ms: number) => number;
  readonly clearTimeout: (id: number) => void;
}

/**
 * The @match list is broader than the origins the loader supports, since a match
 * pattern cannot express the distinction, so the origin is checked again here.
 */
export function bootHost(scope: HostScope): void {
  if (!isGameHost(scope.location.origin)) {
    return;
  }

  const gm = createGmAdapter(readGmSource());
  const services = createHostApi({
    storage: createHostStorage(gm),
    gm,
    setTimer: (handler, ms) => scope.setTimeout(handler, ms),
    clearTimer: (id) => {
      scope.clearTimeout(id);
    },
    now: () => Date.now(),
  });
  const nonce = createNonce(scope.crypto);

  // Registered whether or not the runtime ever connects. This entry is the one
  // route that still works when in-game injection fails, so gating it on the
  // handshake would take the manager away exactly when it is needed. Emitting
  // with nothing subscribed is a harmless no-op.
  gm.registerMenuCommand(MENU_COMMAND_LABEL, () => {
    services.emit({ k: 'ui.open' });
  });

  connectRuntime({
    win: scope,
    doc: scope.document,
    source: runtimeSource,
    payload: { nonce, version: gm.scriptVersion },
  })
    .then((port) => {
      expose(services.api, port);
    })
    .catch((err: unknown) => {
      diagError('runtime handshake failed, addons will not load', err);
    });
}
