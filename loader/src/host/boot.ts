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

/** The userscript popup entry. Not localized: it renders in the manager's chrome, not the game. */
const MENU_COMMAND_LABEL = 'Open the Addons manager';

export interface HostScope extends MessageScope {
  readonly crypto: Pick<Crypto, 'getRandomValues'>;
  readonly document: Document;
  readonly setTimeout: (handler: () => void, ms: number) => number;
  readonly clearTimeout: (id: number) => void;
}

/** @match is broader than the supported origins, which a pattern cannot express, so recheck. */
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

  // Registered whether or not the runtime connects: it is the one route to the manager that
  // survives a failed injection.
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
